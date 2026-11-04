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
    if (e.isDirectory()) {
      out.push({
        name: e.name, path: abs, rel: r, type: 'dir',
        children: await readTree(abs, r)
      })
    } else if (e.isFile()) {
      out.push({
        name: e.name, path: abs, rel: r, type: 'file',
        isMap: e.name.endsWith(MIND_EXT)
      })
    }
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
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
  ipcMain.handle('fs:createFile', async (_e, dir, rawName, content = '') => {
    const d = safePath(dir)
    let name = String(rawName || '').trim()
    if (!name) throw new Error('名称不能为空')
    if (!name.endsWith(MIND_EXT)) name += MIND_EXT
    let abs = path.join(d, name)
    let i = 1
    while (fs.existsSync(abs)) {
      abs = path.join(d, name.replace(new RegExp(MIND_EXT + '$'), '') + '-' + i + MIND_EXT)
      i++
    }
    await fsp.writeFile(abs, content, 'utf-8')
    return abs
  })
  ipcMain.handle('fs:createDir', async (_e, dir, rawName) => {
    const d = safePath(dir)
    const name = String(rawName || '').trim()
    if (!name) throw new Error('名称不能为空')
    let abs = path.join(d, name)
    let i = 1
    while (fs.existsSync(abs)) { abs = path.join(d, `${name}-${i}`); i++ }
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

function registerGitIpc() {
  ipcMain.handle('git:bind', async (_e, { url, user, token }) => {
    const cfg = loadConfig()
    if (!cfg.workspaceDir) throw new Error('请先设置工作区目录')
    if (!/^https?:\/\/|^git@/i.test(url || '')) throw new Error('仓库地址需为 https:// 或 git@ 形式')
    const git = getGit()
    const isRepo = await git.checkIsRepo().catch(() => false)
    if (!isRepo) await git.init()
    const remotes = await git.getRemotes(true)
    const hasOrigin = remotes.some(r => r.name === 'origin')
    if (hasOrigin) await git.remote(['set-url', 'origin', url])
    else await git.addRemote('origin', url)
    const newCfg = { ...cfg, git: { remote: url, user: user || '', token: token || '' } }
    saveConfig(newCfg)
    // 尝试同步一次远程信息，校验地址/凭据（失败不阻断绑定）
    let authOk = true
    let authMsg = ''
    try { await git.fetch(['origin', '--quiet']) } catch (err) { authOk = false; authMsg = String(err && err.message || err).split('\n')[0] }
    return { ok: true, authOk, authMsg }
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
    const isRepo = await getGit().checkIsRepo().catch(() => false)
    if (!isRepo) return { isRepo: false, bound: !!cfg.git }
    const s = await getGit().status()
    return {
      isRepo: true,
      bound: !!cfg.git,
      branch: s.current,
      ahead: s.ahead,
      behind: s.behind,
      tracking: s.tracking,
      changed: s.files.map(f => ({ path: f.path, flag: f.index === '?' ? 'untracked' : (f.index || f.working_dir) }))
    }
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
    const branch = (await git.status()).current || 'main'
    await git.push([tokenUrl(cfg, cfg.git.remote), `HEAD:refs/heads/${branch}`])
    return { ok: true, branch }
  })
  ipcMain.handle('git:pull', async () => {
    const cfg = loadConfig()
    if (!cfg.git) throw new Error('尚未绑定远程仓库')
    const git = getGit()
    const branch = (await git.status()).current || 'main'
    await git.pull([tokenUrl(cfg, cfg.git.remote), branch, '--no-rebase'])
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
    width: 1440,
    height: 920,
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
