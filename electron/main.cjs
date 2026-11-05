/**
 * C-Mind 主进程
 * - 窗口创建与链接拦截（cmind:// 内部跳转 / http(s) 外部浏览器）
 * - 工作区文件系统 IPC：树、读写、新建、重命名、移动、删除
 * - Git IPC：绑定仓库、状态、提交、推送、拉取、历史（simple-git）
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const AdmZip = require('adm-zip')

// 开发（未打包）时把 userData 放到项目内，避免污染系统目录，也便于冒烟测试
if (!app.isPackaged) {
  app.setPath('userData', path.join(__dirname, '..', '.userdata'))
}

const MIND_EXT = '.cmind'
const IGNORED = new Set(['.git', 'node_modules', '.DS_Store', '.userdata', 'release', 'dist'])

let mainWindow = null

/* ---------------- 配置 ---------------- */
function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf-8'))
  } catch {
    return {}
  }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8')
}

function getWorkspace() {
  return loadConfig().workspaceDir || ''
}

/** 校验路径必须位于工作区内，防止越权访问 */
function safePath(p) {
  const root = getWorkspace()
  if (!root) throw new Error('尚未设置工作区目录')
  const abs = path.resolve(p)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('路径超出工作区范围: ' + abs)
  }
  return abs
}

/* ---------------- 文件系统 ---------------- */
async function readTree(dir, rel = '') {
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  const out = []
  for (const e of entries) {
    if (e.name.startsWith('.') || IGNORED.has(e.name)) continue
    const abs = path.join(dir, e.name)
    const r = rel ? rel + '/' + e.name : e.name
    let born = 0
    try { born = (await fsp.stat(abs)).birthtimeMs || 0 } catch {}
    if (e.isDirectory()) {
      out.push({
        name: e.name, path: abs, rel: r, type: 'dir', born,
        children: await readTree(abs, r)
      })
    } else if (e.isFile()) {
      out.push({
        name: e.name, path: abs, rel: r, type: 'file', born,
        isMap: e.name.endsWith(MIND_EXT)
      })
    }
  }
  // 默认排序：文件夹在前，其余按名称自然排序（自定义拖拽顺序由前端叠加）
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  })
  return out
}

async function listMaps() {
  const root = getWorkspace()
  if (!root) return []
  const result = []
  async function walk(dir, rel) {
    let entries
    try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || IGNORED.has(e.name)) continue
      const abs = path.join(dir, e.name)
      const r = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) await walk(abs, r)
      else if (e.name.endsWith(MIND_EXT)) result.push({ rel: r, name: e.name, path: abs })
    }
  }
  await walk(root, '')
  return result
}

function registerFsIpc() {
  ipcMain.handle('config:get', () => loadConfig())
  ipcMain.handle('config:set', (_e, patch) => {
    const cfg = { ...loadConfig(), ...patch }
    saveConfig(cfg)
    return cfg
  })

  ipcMain.handle('workspace:choose', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '选择（或新建后选择）脑图工作区文件夹',
      defaultPath: path.join(app.getPath('documents'), 'C-Mind'),
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || !filePaths[0]) return null
    return filePaths[0]
  })
  ipcMain.handle('workspace:set', async (_e, dir) => {
    if (!dir) throw new Error('目录不能为空')
    await fsp.mkdir(dir, { recursive: true })
    saveConfig({ ...loadConfig(), workspaceDir: dir })
    return dir
  })

  ipcMain.handle('fs:tree', async () => {
    const root = getWorkspace()
    if (!root) return []
    return readTree(root)
  })
  ipcMain.handle('fs:read', async (_e, p) => {
    return fsp.readFile(safePath(p), 'utf-8')
  })
  ipcMain.handle('fs:write', async (_e, p, content) => {
    const abs = safePath(p)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content, 'utf-8')
    return true
  })
  /* ---------- 导入 / 导出 ---------- */
  const IMPORT_FILTERS = [
    { name: '脑图文件', extensions: ['cmind', 'xmind', 'mm', 'opml', 'md', 'markdown', 'json', 'txt'] },
    { name: '所有文件', extensions: ['*'] }
  ]
  ipcMain.handle('import:open', async () => {
    const cfg = loadConfig()
    let abs
    if (process.env.CMIND_IMPORT_FILE) {
      abs = process.env.CMIND_IMPORT_FILE
    } else {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: '导入脑图文件',
        defaultPath: cfg.workspaceDir || undefined,
        properties: ['openFile'],
        filters: IMPORT_FILTERS
      })
      if (res.canceled || !res.filePaths.length) return null
      abs = res.filePaths[0]
    }
    const name = path.basename(abs).replace(/\.[^.]+$/, '')
    const ext = (abs.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase()

    if (ext === 'xmind') {
      // .xmind 是 zip 包：优先新版 content.json，回退旧版 content.xml
      const zip = new AdmZip(abs)
      const entries = zip.getEntries()
      // 内嵌图片 → dataURL（正文里的 xap:resources/... 引用原样替换，图片随 .cmind 保存）
      const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' }
      const resourceMap = {}
      for (const e of entries) {
        if (e.isDirectory) continue
        if (!/^resources\//i.test(e.entryName) && !/^attachments\//i.test(e.entryName)) continue
        const base = e.entryName.split('/').pop().toLowerCase()
        const extm = (base.match(/\.([a-z0-9]+)$/) || [])[1] || ''
        const mime = IMG_MIME[extm]
        if (!mime) continue
        try { resourceMap[base] = `data:${mime};base64,${e.getData().toString('base64')}` } catch (_) { /* 忽略损坏资源 */ }
      }
      const swapResources = (t) => t.replace(/xap:([^"'\s<>)]+)/g, (m, p1) => {
        const base = decodeURIComponent(p1).split('/').pop().toLowerCase()
        return resourceMap[base] || m
      })
      const jsonEntry = entries.find(e => e.entryName === 'content.json')
        || entries.find(e => e.entryName.endsWith('/content.json'))
      if (jsonEntry) {
        return { path: abs, name, ext, kind: 'xmind', sub: 'json', text: swapResources(jsonEntry.getData().toString('utf-8')) }
      }
      const xmlEntry = entries.find(e => e.entryName === 'content.xml')
        || entries.find(e => e.entryName.endsWith('/content.xml'))
      if (xmlEntry) {
        return { path: abs, name, ext, kind: 'xmind', sub: 'xml', text: swapResources(xmlEntry.getData().toString('utf-8')) }
      }
      throw new Error('该 .xmind 文件中未找到 content.json / content.xml')
    }

    if (ext === 'cmind' || ext === 'json' || ext === 'mm' || ext === 'opml' || ext === 'md' || ext === 'markdown' || ext === 'txt') {
      const text = await fsp.readFile(abs, 'utf-8')
      // 归一化 kind：扩展名 → 解析器名称（md/markdown/txt → markdown；mm → freemind）
      const KIND_MAP = { md: 'markdown', markdown: 'markdown', txt: 'markdown', mm: 'freemind' }
      return { path: abs, name, ext, kind: ext === 'cmind' ? 'json' : (KIND_MAP[ext] || ext), text }
    }
    throw new Error('暂不支持该格式的导入：.' + ext)
  })

  ipcMain.handle('export:save', async (_e, { defaultName, filters, content }) => {
    const cfg = loadConfig()
    // 自动化测试用：设置 CMIND_EXPORT_DIR 时跳过系统保存对话框，直接写入该目录
    if (process.env.CMIND_EXPORT_DIR) {
      const absTest = path.join(process.env.CMIND_EXPORT_DIR, String(defaultName || 'export.bin'))
      await fsp.mkdir(process.env.CMIND_EXPORT_DIR, { recursive: true })
      if (content && typeof content === 'object' && content.base64 !== undefined) {
        await fsp.writeFile(absTest, Buffer.from(content.base64, 'base64'))
      } else {
        await fsp.writeFile(absTest, String(content == null ? '' : content), 'utf-8')
      }
      return absTest
    }
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '导出脑图',
      defaultPath: path.join(cfg.workspaceDir || app.getPath('documents'), String(defaultName || '导图')),
      filters: filters || [{ name: '所有文件', extensions: ['*'] }]
    })
    if (res.canceled || !res.filePath) return null
    const abs = res.filePath
    if (content && typeof content === 'object' && content.base64 !== undefined) {
      await fsp.writeFile(abs, Buffer.from(content.base64, 'base64'))
    } else {
      await fsp.writeFile(abs, String(content == null ? '' : content), 'utf-8')
    }
    return abs
  })

  ipcMain.handle('fs:createFile', async (_e, dir, rawName, content = '') => {
    const d = safePath(dir)
    let name = String(rawName || '').trim()
    if (!name) throw new Error('名称不能为空')
    if (!name.endsWith(MIND_EXT)) name += MIND_EXT
    const abs = path.join(d, name)
    if (fs.existsSync(abs)) throw new Error('同名文件已存在：' + name)
    await fsp.writeFile(abs, content, 'utf-8')
    return abs
  })
  // 新建普通文件（保留用户输入的完整文件名与扩展名）
  ipcMain.handle('fs:createRaw', async (_e, dir, rawName, content = '') => {
    const d = safePath(dir)
    const name = String(rawName || '').trim()
    if (!name) throw new Error('名称不能为空')
    if (/[\\/:*?"<>|]/.test(name)) throw new Error('文件名不能包含 \\ / : * ? " < > |')
    const abs = path.join(d, name)
    if (fs.existsSync(abs)) throw new Error('同名文件已存在：' + name)
    await fsp.writeFile(abs, content, 'utf-8')
    return abs
  })
  ipcMain.handle('fs:createDir', async (_e, dir, rawName) => {
    const d = safePath(dir)
    const name = String(rawName || '').trim()
    if (!name) throw new Error('名称不能为空')
    const abs = path.join(d, name)
    if (fs.existsSync(abs)) throw new Error('同名文件夹已存在：' + name)
    await fsp.mkdir(abs, { recursive: true })
    return abs
  })
  ipcMain.handle('fs:rename', async (_e, p, newName) => {
    const abs = safePath(p)
    const target = path.join(path.dirname(abs), String(newName).trim())
    if (!target.startsWith(getWorkspace() + path.sep)) throw new Error('路径超出工作区范围')
    if (fs.existsSync(target)) throw new Error('同名文件已存在')
    await fsp.rename(abs, target)
    return target
  })
  ipcMain.handle('fs:move', async (_e, src, destDir) => {
    const s = safePath(src)
    const d = safePath(destDir)
    const target = path.join(d, path.basename(s))
    if (fs.existsSync(target)) throw new Error('目标位置存在同名文件')
    if (s === target || target.startsWith(s + path.sep)) throw new Error('非法的移动目标')
    await fsp.rename(s, target)
    return target
  })
  // 删除：移入 macOS 废纸篓，可恢复
  ipcMain.handle('fs:delete', async (_e, p) => {
    const abs = safePath(p)
    return shell.trashItem(abs)
  })
  ipcMain.handle('fs:listMaps', () => listMaps())

  ipcMain.handle('os:openExternal', (_e, url) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('仅允许打开 http(s) 链接')
    return shell.openExternal(url)
  })
  ipcMain.handle('os:openPath', (_e, p) => shell.showItemInFolder(safePath(p)))
  // 用系统默认程序打开工作区内的普通文件
  ipcMain.handle('os:openItem', async (_e, p) => {
    const abs = safePath(p)
    const err = await shell.openPath(abs)
    if (err) throw new Error(err)
    return true
  })
}

/* ---------------- Git ---------------- */
function tokenUrl(cfg, url) {
  if (!cfg.git || !cfg.git.token) return url
  try {
    const u = new URL(url)
    const user = cfg.git.user || u.username || 'oauth2'
    u.username = encodeURIComponent(user)
    u.password = encodeURIComponent(cfg.git.token)
    return u.toString()
  } catch {
    return url
  }
}
function getGit() {
  // 惰性加载，避免未使用时的开销
  const { simpleGit } = require('simple-git')
  const root = getWorkspace()
  if (!root) throw new Error('尚未设置工作区目录')
  return simpleGit({ baseDir: root })
}

function friendlyGitError(err) {
  const msg = [String(err && err.message || err), ...((err && err.rejected) || []).map(r => r && r.message || '')].join('\n')
  if (/non-fast-forward|behind its remote counterpart|fetch first/i.test(msg))
    return new Error('远程分支有新提交，请先点击「拉取」合并后再推送')
  if (/Permission denied|publickey/i.test(msg))
    return new Error('SSH 认证失败：请确认本机已配置可写该仓库的 SSH Key（ssh -T git@github.com 验证）')
  if (/Path with spaces|dubious ownership/i.test(msg))
    return new Error(msg)
  return err
}

function registerGitIpc() {
  ipcMain.handle('git:bind', async (_e, { url, user, token }) => {
    const cfg = loadConfig()
    if (!cfg.workspaceDir) throw new Error('请先设置工作区目录')
    if (!/^https?:\/\/|^git@/i.test(url || '')) throw new Error('仓库地址需为 https:// 或 git@ 形式')
    const git = getGit()

    // 仅当工作区本身不是仓库、或它嵌套在其它仓库内时，才在工作区执行 init
    let toplevel = ''
    try { toplevel = (await git.revparse(['--show-toplevel'])).trim() } catch {}
    if (toplevel !== cfg.workspaceDir) {
      try { await git.init(['-b', 'main']) } catch { await git.init() }
    }

    const remotes = await git.getRemotes(true)
    const hasOrigin = remotes.some(r => r.name === 'origin')
    if (hasOrigin) await git.remote(['set-url', 'origin', url])
    else await git.addRemote('origin', url)

    // 补齐提交者身份（否则 commit 会报 "Please tell me who you are"）
    try {
      const name = await git.getConfig('user.name')
      if (!name.value) await git.addConfig('user.name', user || 'C-Mind User')
      const email = await git.getConfig('user.email')
      if (!email.value) await git.addConfig('user.email', (user || 'cmind') + '@users.noreply.github.com')
    } catch {}

    const newCfg = { ...cfg, git: { remote: url, user: user || '', token: token || '' } }
    saveConfig(newCfg)
    // 尝试同步一次远程信息，校验地址/凭据（失败不阻断绑定）
    let authOk = true
    let authMsg = ''
    try {
      await git.fetch(['origin', '--quiet'])
    } catch (err) {
      const msg = String(err && err.message || err)
      if (/couldn't find remote ref|does not appear to be a git repo/i.test(msg)) {
        // 空远程仓库：fetch 无 refs，属正常
      } else {
        authOk = false
        authMsg = msg.split('\n')[0]
      }
    }
    // 本地尚无任何提交而远程已有内容 → 拉取远程作为基线，避免 push 被拒（non-fast-forward）
    let baseMsg = ''
    if (authOk) {
      let pulled = false
      try {
        await git.raw(['rev-parse', '--verify', 'HEAD'])
        pulled = true // 已有提交，无需基线
      } catch {}
      if (!pulled) {
        try {
          const show = await git.raw(['remote', 'show', 'origin'])
          const m = show.match(/HEAD branch:\s*(\S+)/)
          if (m) { await git.pull(['origin', m[1]]); pulled = true }
        } catch (e) { baseMsg = String(e.message || e).split('\n')[0] }
      }
      if (!pulled) {
        // 本地未提交内容与远程同名文件冲突：先提交本地，再合并远程历史
        try {
          const s0 = await git.status()
          if (s0.files.length) {
            await git.add('-A')
            await git.commit('本地内容（绑定远程仓库时自动提交）')
            await git.pull(['origin', 'main', '--allow-unrelated-histories', '--no-rebase'])
            pulled = true
          }
        } catch (e2) {
          // 合并冲突：立即终止合并，保留本地文件版本，绝不把冲突标记写进 .cmind 等文件
          try { await git.raw(['merge', '--abort']) } catch {}
          try {
            const s2 = await git.status()
            if ((s2.conflicted || []).length) {
              await git.checkout(['--ours', '.'])
              await git.add('-A')
              await git.commit('保留本地版本（远端存在同名差异，绑定已中止合并）')
            }
          } catch {}
          baseMsg = '远端与本地存在同名文件差异，已保留本地文件（未覆盖）。可稍后在 Git 面板手动处理'
        }
      }
    }
    return { ok: true, authOk, authMsg, baseMsg }
  })
  ipcMain.handle('git:unbind', async () => {
    const cfg = loadConfig()
    try { await getGit().removeRemote('origin') } catch {}
    saveConfig({ ...cfg, git: null })
    return true
  })
  ipcMain.handle('git:status', async () => {
    const cfg = loadConfig()
    const root = getWorkspace()
    if (!root) throw new Error('尚未设置工作区目录')
    let toplevel = ''
    const git = getGit()
    try { toplevel = (await git.revparse(['--show-toplevel'])).trim() } catch {}
    if (!toplevel) return { isRepo: false, bound: !!cfg.git }
    const s = await git.status()
    let branches = []
    try { branches = (await git.branchLocal()).all } catch {}
    return {
      isRepo: true,
      ownRepo: toplevel === root, // 是否为工作区自身的仓库（而非嵌套在外部仓库中）
      bound: !!cfg.git,
      branch: s.current,
      ahead: s.ahead,
      behind: s.behind,
      tracking: s.tracking,
      branches,
      changed: s.files.map(f => ({ path: f.path, flag: f.index === '?' ? 'untracked' : (f.index || f.working_dir) }))
    }
  })
  ipcMain.handle('git:branches', async () => {
    const git = getGit()
    const local = await git.branchLocal()
    return { current: local.current, all: local.all }
  })
  ipcMain.handle('git:deleteBranch', async (_e, branch) => {
    if (!branch || branch === 'main') throw new Error('该分支不允许删除')
    await getGit().branch(['-D', branch])
    return { ok: true }
  })
  ipcMain.handle('git:checkout', async (_e, branch) => {
    if (!branch) throw new Error('分支名不能为空')
    await getGit().checkout(branch)
    return { ok: true, branch }
  })
  ipcMain.handle('git:createBranch', async (_e, name) => {
    const branch = String(name || '').trim()
    if (!branch) throw new Error('分支名不能为空')
    if (/[\s~^:?*[\\]/.test(branch)) throw new Error('分支名包含非法字符')
    await getGit().checkout(['-b', branch])
    return { ok: true, branch }
  })
  ipcMain.handle('git:commit', async (_e, message) => {
    const msg = String(message || '').trim()
    if (!msg) throw new Error('请填写提交说明')
    const git = getGit()
    await git.add('-A')
    const res = await git.commit(msg)
    return { committed: res.commit.length ? res.commit : null, summary: res.summary }
  })
  ipcMain.handle('git:push', async () => {
    const cfg = loadConfig()
    if (!cfg.git) throw new Error('尚未绑定远程仓库')
    const git = getGit()
    const s = await git.status()
    const branch = s.current || 'main'
    if (s.ahead === 0 && s.tracking) {
      throw new Error('本地没有待推送的提交（远程已同步）。请先在上方填写说明并「提交」，再「推送」')
    }
    try {
      // 形式：git push <remote> <branch>（不要把 -u 插在 remote 之后，git 会把 origin 当 refspec）
      await git.push([tokenUrl(cfg, cfg.git.remote), branch])
      // 首次推送（无上游分支）推送后补设跟踪，否则之后 git push 会报 no upstream branch
      if (!s.tracking) {
        try {
          await git.fetch(['origin', branch])
          await git.branch([`--set-upstream-to=origin/${branch}`, branch])
        } catch {}
      }
    } catch (err) {
      throw friendlyGitError(err)
    }
    return { ok: true, branch, ahead: s.ahead || 0 }
  })
  ipcMain.handle('git:pull', async () => {
    const cfg = loadConfig()
    if (!cfg.git) throw new Error('尚未绑定远程仓库')
    const git = getGit()
    const branch = (await git.status()).current || 'main'
    try {
      await git.pull([tokenUrl(cfg, cfg.git.remote), branch, '--no-rebase'])
    } catch (err) {
      throw friendlyGitError(err)
    }
    return { ok: true, branch }
  })
  ipcMain.handle('git:log', async () => {
    const git = getGit()
    const isRepo = await git.checkIsRepo().catch(() => false)
    if (!isRepo) return []
    try {
      const log = await git.log({ maxCount: 20 })
      return log.all.map(c => ({ hash: c.hash.slice(0, 7), message: c.message, date: c.date, author: c.author_name }))
    } catch {
      // 仓库存在但还没有任何提交
      return []
    }
  })
}

/* ---------------- 窗口 ---------------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: Number(process.env.CMIND_WIN_W) || 1440,
    height: Number(process.env.CMIND_WIN_H) || 920,
    minWidth: 960,
    minHeight: 640,
    title: 'C-Mind',
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 拦截所有“新窗口”请求：<a target=_blank> 等
  // cmind:// → 通知渲染层开新标签；http(s) → 系统浏览器；其余拒绝
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('cmind://')) {
      mainWindow.webContents.send('open-link', url)
    } else if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[c-mind] renderer loaded, userData =', app.getPath('userData'))
  })
  // UI 自动化走查（仅开发验证用）
  if (process.env.CMIND_UITEST) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 1800))
      try {
        // 安全默认：自动化自检永不触碰真实 Git 远程，除非显式 CMIND_UITEST_GIT=1
        const mode = process.env.CMIND_UITEST_MODE || (process.env.CMIND_UITEST_GIT === '1' ? '' : 'skipgit')
        const result = await mainWindow.webContents.executeJavaScript('window.__cmindUITest(' + (mode ? JSON.stringify(mode) : '') + ')')
        console.log('[uitest] RESULT ' + JSON.stringify(result, null, 2))
        if (process.env.CMIND_SHOT) {
          try {
            const img = await mainWindow.webContents.capturePage()
            require('fs').writeFileSync(process.env.CMIND_SHOT, img.toPNG())
            console.log('[uitest] SHOT saved ' + process.env.CMIND_SHOT)
          } catch (e) { console.log('[uitest] SHOT fail ' + e.message) }
        }
      } catch (e) {
        console.error('[uitest] failed:', e)
      }
      setTimeout(() => app.quit(), 500)
    })
  }
  // 图片查看器截图（仅开发验证用）
  if (process.env.CMIND_SMOKE_VIEWER) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 1500))
      try {
        const r = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms))
            const rows = [...document.querySelectorAll('.tree-row')]
            const t = rows.find(x => x.textContent.includes('产品路线图'))
            if (t) t.click()
            await sleep(2600)
            const M = window.__cmindMap
            if (!M) return 'no map'
            const root = M.renderer.root
            const c = document.createElement('canvas'); c.width = 640; c.height = 400
            const g = c.getContext('2d')
            g.fillStyle = '#eef2ff'; g.fillRect(0, 0, 640, 400)
            g.strokeStyle = '#4a7dff'; g.lineWidth = 6; g.strokeRect(20, 20, 600, 360)
            g.fillStyle = '#334155'; g.font = 'bold 30px sans-serif'
            g.fillText('图片大图预览示例', 60, 110)
            g.font = '20px sans-serif'; g.fillStyle = '#64748b'
            g.fillText('＋/－ 按钮 · 滚轮缩放 · 拖动平移 · 适合窗口', 60, 170)
            const url = c.toDataURL('image/png')
            const node = root.children[0]
            node.active(); await sleep(300)
            M.execCommand('SET_NODE_IMAGE', node, { url, title: '示例图片', width: 132, height: 83, custom: false })
            await sleep(500)
            node.active(); await sleep(400)
            const imgEl = node.group.node.querySelector('image')
            if (!imgEl) return 'no img el'
            imgEl.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 700, clientY: 400 }))
            await sleep(1200)
            const vw = document.querySelector('.img-viewer')
            if (!vw) return 'viewer not open'
            const panel = vw.querySelector('.viewer-panel')
            const stage = vw.querySelector('.viewer-stage')
            const dbg = {
              win: window.innerWidth + 'x' + window.innerHeight,
              panel: panel ? panel.clientWidth + 'x' + panel.clientHeight : 'none',
              stage: stage ? stage.clientWidth + 'x' + stage.clientHeight : 'none',
              pct: (vw.querySelector('.vpct') || {}).textContent,
              transform: (vw.querySelector('.viewer-stage img') || { style: {} }).style.transform
            }
            return JSON.stringify(dbg)
            const plus = [...document.querySelectorAll('.img-viewer .viewer-bar button')].find(x => x.textContent.trim() === '＋')
            plus && plus.click(); await sleep(300)
            return 'ok'
          })()`)
        console.log('[smoke-viewer]', r)
        const img = await mainWindow.webContents.capturePage()
        fs.writeFileSync(path.join(__dirname, '..', 'build', 'screenshot-viewer.png'), img.toPNG())
        console.log('[smoke-viewer] saved')
      } catch (e) { console.error('[smoke-viewer] failed:', e) }
      setTimeout(() => app.quit(), 500)
    })
  }
  // 冒烟截图（仅开发验证用）
  if (process.env.CMIND_SMOKE_SHOT) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 1500))
      try {
        const clicked = await mainWindow.webContents.executeJavaScript(`
          (() => {
            const rows = [...document.querySelectorAll('.tree-row')]
            const target = rows.find(r => r.textContent.includes('产品路线图'))
            if (target) { target.click(); return true }
            return false
          })()`)
        console.log('[smoke] open first map:', clicked)
        await new Promise(r => setTimeout(r, 2800))
        const img = await mainWindow.webContents.capturePage()
        fs.writeFileSync(path.join(__dirname, '..', 'build', 'screenshot-editor.png'), img.toPNG())
        // 附加：Git 面板截图
        await mainWindow.webContents.executeJavaScript(`
          (() => {
            const btns = [...document.querySelectorAll('button')]
            const git = btns.find(b => b.textContent.trim() === 'Git')
            if (git) git.click()
            return !!git
          })()`)
        await new Promise(r => setTimeout(r, 900))
        const img2 = await mainWindow.webContents.capturePage()
        fs.writeFileSync(path.join(__dirname, '..', 'build', 'screenshot-git.png'), img2.toPNG())
        console.log('[smoke] screenshots saved')
      } catch (e) {
        console.error('[smoke] failed:', e)
      }
      setTimeout(() => app.quit(), 600)
    })
  }
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[c-mind] renderer gone:', details.reason)
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ]))
    registerFsIpc()
    registerGitIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
