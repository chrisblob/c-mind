/**
 * C-Mind 全局状态与 UI 服务（prompt / confirm / contextMenu / toast）
 */
import { reactive } from 'vue'
import { parseImportText } from './formats.js'

export const MIND_EXT = '.cmind'

export const store = reactive({
  workspace: '',
  tree: [],
  config: {},
  needWorkspace: false,

  tabs: [],
  activeId: null,
  currentDir: '', // 当前操作的文件夹（新建脑图/文件夹的默认位置）

  gitOpen: false,
  uuidIndex: null, // uuid → 绝对路径 索引（refreshTree 时失效，按需重建）

  // UI 服务状态
  requestSave: null, // 编辑器注册的保存函数（Cmd+S）
  prompt: null,    // { title, label, value, placeholder, resolve }
  confirmBox: null, // { title, message, danger, resolve }
  contextMenu: null, // { x, y, items: [{label, action, danger}] }
  toasts: [],      // { id, text, type }
})

export function api(channel, ...args) {
  return window.cmind.invoke(channel, ...args)
}

/* ---------- toast ---------- */
let toastSeq = 1
export function toast(text, type = 'info') {
  const id = toastSeq++
  store.toasts.push({ id, text, type })
  setTimeout(() => {
    const i = store.toasts.findIndex(t => t.id === id)
    if (i >= 0) store.toasts.splice(i, 1)
  }, 2600)
}

/* ---------- UI 服务 ---------- */
export function uiPrompt(title, label, value = '', placeholder = '', required = false) {
  return new Promise(resolve => {
    const done = (v) => {
      store.prompt = null
      resolve(v)
    }
    store.prompt = { title, label, value, placeholder, required, resolve: done }
  })
}
export function uiConfirm(title, message, danger = false) {
  return new Promise(resolve => {
    const done = (v) => {
      store.confirmBox = null
      resolve(v)
    }
    store.confirmBox = { title, message, danger, resolve: done }
  })
}
export function uiContextMenu(x, y, items) {
  store.contextMenu = { x, y, items }
}
export function closeContextMenu() {
  store.contextMenu = null
}

/* ---------- 工作区 ---------- */
export async function chooseWorkspace() {
  const dir = await api('workspace:choose')
  if (!dir) return false
  store.workspace = await api('workspace:set', dir)
  store.needWorkspace = false
  store.currentDir = store.workspace
  await refreshTree()
  toast('工作区已设置：' + store.workspace)
  return true
}

export async function refreshTree() {
  store.uuidIndex = null
  try {
    store.tree = await api('fs:tree')
  } catch (e) {
    store.tree = []
  }
}

/* ---------- 标签页 ---------- */
let tabSeq = 1

export function relOf(absPath) {
  const ws = store.workspace.replace(/\/+$/, '')
  return absPath.startsWith(ws + '/') ? absPath.slice(ws.length + 1) : absPath
}

export function activeTab() {
  return store.tabs.find(t => t.id === store.activeId) || null
}

export async function openMap(absPath, focus = true) {
  // 当前操作目录 = 所打开脑图所在文件夹
  store.currentDir = absPath.slice(0, absPath.lastIndexOf('/')) || store.workspace
  const existing = store.tabs.find(t => t.path === absPath)
  if (existing) {
    if (focus) store.activeId = existing.id
    return existing
  }
  const tab = {
    id: 'tab-' + tabSeq++,
    type: 'map',
    path: absPath,
    rel: relOf(absPath),
    name: absPath.split('/').pop().replace(new RegExp(MIND_EXT + '$'), ''),
    dirty: false,
    readonly: false
  }
  store.tabs.push(tab)
  if (focus) store.activeId = tab.id
  return tab
}

/** 打开文件夹视图标签：右侧展示该文件夹下的文件与文件夹 */
export async function openDir(absPath, focus = true) {
  const existing = store.tabs.find(t => t.type === 'dir' && t.path === absPath)
  if (existing) {
    if (focus) store.activeId = existing.id
    return existing
  }
  const tab = {
    id: 'tab-' + tabSeq++,
    type: 'dir',
    path: absPath,
    rel: relOf(absPath),
    name: absPath.split('/').pop(),
    dirty: false,
    readonly: false
  }
  store.tabs.push(tab)
  if (focus) store.activeId = tab.id
  return tab
}

export function closeTab(id) {
  const i = store.tabs.findIndex(t => t.id === id)
  if (i < 0) return
  store.tabs.splice(i, 1)
  if (store.activeId === id) {
    const next = store.tabs[Math.min(i, store.tabs.length - 1)]
    store.activeId = next ? next.id : null
  }
}

/* ---------- 脑图文件 ---------- */
export function genUuid() {
  return (window.crypto && window.crypto.randomUUID)
    ? window.crypto.randomUUID()
    : 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

export function newMapDoc(rootText = '中心主题') {
  return {
    format: 'c-mind',
    version: 1,
    uuid: genUuid(), // 脑图唯一身份：cmind:// 链接优先按 uuid 解析，移动/重命名后依然有效
    layout: 'logicalStructure',
    theme: { template: 'default', config: {} },
    view: null,
    root: { data: { text: rootText }, children: [] }
  }
}

export async function createMap(dirPath, name) {
  let n = (name || '').trim() || '未命名'
  if (!n.endsWith(MIND_EXT)) n += MIND_EXT
  const abs = await api('fs:createFile', dirPath, n, JSON.stringify(newMapDoc(n.replace(new RegExp(MIND_EXT + '$'), '')), null, 2))
  await refreshTree()
  await openMap(abs)
  return abs
}

/** 把导入的节点树作为新脑图文件写入目录（fs:createFile 自动重名加 -1/-2），并打开 */
export async function importMapAsFile(dirPath, name, tree) {
  const title = (tree && tree.data && tree.data.text) || name || '导入脑图'
  const doc = newMapDoc(title)
  doc.root = tree
  const abs = await api('fs:createFile', dirPath, sanitizeFileName(name || title), JSON.stringify(doc, null, 2))
  await refreshTree()
  await openMap(abs)
  return abs
}

/** 导入外部文件 → 在「当前选定文件夹」（或选中脑图所在文件夹）新建一张脑图并打开 */
export async function doImport() {
  try {
    const res = await api('import:open')
    if (!res) return
    const tree = parseImportText(res.kind, res.text)
    if (tree.data && !String(tree.data.text || '').trim()) tree.data.text = res.name || '导入脑图'
    // 位置规则与“新建于”一致：选中文件夹 → 该文件夹；选中脑图 → 其所在文件夹；都没有 → 根目录
    const dir = store.currentDir || store.workspace
    const name = String((tree.data && tree.data.text) || '').trim() || res.name || '导入脑图'
    const abs = await importMapAsFile(dir, name, tree)
    const dirLabel = dir === store.workspace ? '根目录' : dir.replace(/\\/g, '/').split('/').pop()
    toast(`已导入到「${dirLabel}」：${abs.replace(/\\/g, '/').split('/').pop()}（已在新标签打开）`, 'ok')
  } catch (err) {
    toast('导入失败：' + (err.message || err), 'error')
  }
}

export async function createDir(dirPath, name) {
  await api('fs:createDir', dirPath, name)
  await refreshTree()
}

/** 用系统默认程序打开普通文件 */
export async function openRawFile(absPath) {
  try {
    await api('os:openItem', absPath)
  } catch (e) {
    toast('打开失败：' + (e.message || e), 'error')
  }
}

/** 文件名中的非法字符替换 */
export function sanitizeFileName(text) {
  return String(text || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/**
 * 脑图根节点文本变化后，同步重命名磁盘文件
 * @returns {Promise<boolean>} 是否发生了改名
 */
export async function syncRenameMap(tab, newBase) {
  const base = sanitizeFileName(newBase)
  if (!base || base === tab.name) return false
  try {
    const oldPath = tab.path
    const newPath = await api('fs:rename', oldPath, base + MIND_EXT)
    tab.path = newPath
    tab.rel = relOf(newPath)
    tab.name = base
    await refreshTree() // 先刷新树，再重写互链（其他脑图指向旧文件名的链接）
    await rewriteLinksAfterMove(relOf(oldPath), relOf(newPath))
    syncTabsAfterPathChange(oldPath, newPath)
    return true
  } catch (e) {
    toast('文件名同步失败：' + (e.message || e), 'error')
    return false
  }
}

function walkMaps(list) {
  return (list || []).flatMap(item =>
    item.type === 'dir' ? walkMaps(item.children) : (item.isMap ? [item] : [])
  )
}

/**
 * 移动/重命名后，重写全工作区 .cmind 文件里指向旧路径的 cmind:// 链接，保证脑图互链不失效。
 * 支持文件夹整体移动（前缀匹配）；打开中且有未保存改动的文件跳过（避免覆盖用户编辑）。
 * @returns {number} 被更新的文件数
 */
async function rewriteLinksAfterMove(oldRel, newRel) {
  const dirtyOpen = new Set(store.tabs.filter(t => t.dirty).map(t => t.path))
  let fixed = 0
  for (const m of walkMaps(store.tree)) {
    try {
      if (dirtyOpen.has(m.path)) continue
      const raw = String(await api('fs:read', m.path))
      if (!raw.includes('cmind://open?path=')) continue
      let changed = false
      const out = raw.replace(/cmind:\/\/open\?path=([^"'\s<>)]+)/g, (whole, enc) => {
        let target
        try { target = decodeURIComponent(enc) } catch { return whole }
        let next = null
        if (target === oldRel) next = newRel
        else if (target.startsWith(oldRel + '/')) next = newRel + target.slice(oldRel.length)
        if (!next) return whole
        changed = true
        return 'cmind://open?path=' + encodeURIComponent(next).replace(/%2F/g, '/')
      })
      if (changed) { await api('fs:write', m.path, out); fixed++ }
    } catch { /* 单个文件读取失败不中断其余文件的重写 */ }
  }
  // 打开中且有未保存改动的脑图：同步修正内存里的链接，交由自动保存落盘
  try {
    const t = store.tabs.find(x => x.id === store.activeId)
    const M = window.__cmindMap
    if (t && t.type === 'map' && t.dirty && M && dirtyOpen.has(t.path)) {
      const fix = (u) => {
        if (typeof u !== 'string' || !u.startsWith('cmind://open?path=')) return u
        let target
        try { target = decodeURIComponent(u.slice('cmind://open?path='.length)) } catch { return u }
        let next = null
        if (target === oldRel) next = newRel
        else if (target.startsWith(oldRel + '/')) next = newRel + target.slice(oldRel.length)
        return next ? 'cmind://open?path=' + encodeURIComponent(next).replace(/%2F/g, '/') : u
      }
      const doc = M.getData(true)
      let count = 0
      const w2 = (n) => {
        if (n.data && n.data.hyperlink) {
          const u2 = fix(n.data.hyperlink)
          if (u2 !== n.data.hyperlink) { n.data.hyperlink = u2; count++ }
        }
        ;(n.children || []).forEach(w2)
      }
      w2(doc.root)
      if (count) { M.setData(doc); fixed++ }
    }
  } catch { /* 内存修正失败不影响磁盘重写结果 */ }
  return fixed
}

export async function renamePath(p, newName) {
  let n = (newName || '').trim()
  if (!n) return
  // 脑图文件保持 .cmind 扩展名
  if (p.endsWith(MIND_EXT) && !n.endsWith(MIND_EXT)) n += MIND_EXT
  const oldPath = p
  const newPath = p.slice(0, p.lastIndexOf('/') + 1) + n
  await api('fs:rename', oldPath, n)
  await refreshTree() // 先刷新树（store.tree 里已是新路径），再做链接重写
  const fixed = await rewriteLinksAfterMove(relOf(oldPath), relOf(newPath))
  if (fixed) toast(`已同步更新 ${fixed} 个文件里的脑图链接`, 'ok')
  syncTabsAfterPathChange(oldPath, newPath)
}

/** 文件/文件夹路径变化后，更新所有受影响标签页的路径信息 */
function syncTabsAfterPathChange(oldPath, newPath) {
  for (const t of store.tabs) {
    if (t.path === oldPath) {
      t.path = newPath
      t.rel = relOf(newPath)
      if (newPath.endsWith(MIND_EXT)) t.name = newPath.split('/').pop().replace(new RegExp(MIND_EXT + '$'), '')
    } else if (t.path.startsWith(oldPath + '/')) {
      t.path = newPath + t.path.slice(oldPath.length)
      t.rel = relOf(t.path)
    }
  }
}

export async function movePath(src, destDir) {
  const newPath = await api('fs:move', src, destDir)
  await refreshTree() // 先刷新树，再做链接重写
  const fixed = await rewriteLinksAfterMove(relOf(src), relOf(newPath))
  if (fixed) toast(`已同步更新 ${fixed} 个文件里的脑图链接`, 'ok')
  syncTabsAfterPathChange(src, newPath)
}

export async function deletePath(p, name) {
  const ok = await uiConfirm('删除', `确定将「${name}」移入废纸篓吗？`, true)
  if (!ok) return
  await api('fs:delete', p)
  // 关闭被删除文件（或其目录下所有文件）对应的标签
  const affected = store.tabs.filter(t => t.path === p || t.path.startsWith(p + '/'))
  affected.forEach(t => closeTab(t.id))
  await refreshTree()
}

/* ---------- cmind:// 内部跳转 ---------- */
/** 扫描全工作区 .cmind 构建 uuid → 路径索引；发现缺 uuid 的旧文件就地回填（打开中且有未保存改动的跳过） */
async function buildUuidIndex() {
  const idx = {}
  const dirtyOpen = new Set(store.tabs.filter(t => t.dirty).map(t => t.path))
  for (const m of walkMaps(store.tree)) {
    try {
      if (dirtyOpen.has(m.path)) continue
      const raw = String(await api('fs:read', m.path))
      const doc = JSON.parse(raw)
      if (doc.uuid) { idx[doc.uuid] = m.path; continue }
      // 旧文件回填 uuid
      doc.uuid = genUuid()
      idx[doc.uuid] = m.path
      await api('fs:write', m.path, JSON.stringify(doc, null, 2))
    } catch { /* 单个文件失败不中断索引构建 */ }
  }
  store.uuidIndex = idx
  return idx
}

/** 按 uuid 解析脑图绝对路径（索引懒构建） */
export async function resolveMapByUuid(uuid) {
  if (!uuid) return null
  if (!store.uuidIndex) await buildUuidIndex()
  return store.uuidIndex[uuid] || null
}

export async function handleCmindLink(url) {
  try {
    const u = new URL(url)
    const uuid = u.searchParams.get('uuid')
    const rel = u.searchParams.get('path')
    // 1) uuid 优先：文件被移动/重命名后依然有效
    if (uuid) {
      const abs = await resolveMapByUuid(uuid)
      if (abs) {
        await openMap(abs)
        toast('已打开：' + abs.replace(/\\/g, '/').split('/').pop(), 'ok')
        return
      }
      // uuid 失效（文件被删/未入库）→ 继续按 path 兜底
    }
    if (!rel) { toast('无效的脑图链接', 'error'); return }
    const ws = store.workspace.replace(/\/+$/, '')
    const abs = ws + '/' + decodeURIComponent(rel)
    try {
      await api('fs:read', abs)
    } catch {
      toast('目标脑图不存在：' + decodeURIComponent(rel), 'error')
      return
    }
    await openMap(abs)
    toast('已打开：' + decodeURIComponent(rel), 'ok')
  } catch (e) {
    toast('打开脑图链接失败', 'error')
  }
}

/* ---------- 初始化 ---------- */
export async function initStore() {
  const cfg = await api('config:get')
  store.config = cfg
  if (cfg.workspaceDir) {
    store.workspace = cfg.workspaceDir
    store.currentDir = store.workspace
    await refreshTree()
  } else {
    store.needWorkspace = true
  }
}

/** 展示用目录名 */
export function dirLabel(absDir) {
  const ws = store.workspace.replace(/\/+$/, '')
  if (!absDir || absDir === ws) return '根目录'
  return absDir.slice(ws.length + 1) || '根目录'
}

/* ---------- 收集所有文件夹（用于移动对话框） ---------- */
export function collectDirs(nodes = store.tree, prefix = '') {
  const out = [{ rel: '', name: '（根目录）' }]
  function walk(list, base) {
    for (const n of list) {
      if (n.type !== 'dir') continue
      const rel = base ? base + '/' + n.name : n.name
      out.push({ rel, name: rel })
      walk(n.children || [], rel)
    }
  }
  walk(nodes, prefix)
  return out
}
