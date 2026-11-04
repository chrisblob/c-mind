/**
 * C-Mind 全局状态与 UI 服务（prompt / confirm / contextMenu / toast）
 */
import { reactive } from 'vue'

export const MIND_EXT = '.cmind'

export const store = reactive({
  workspace: '',
  tree: [],
  config: {},
  needWorkspace: false,

  tabs: [],
  activeId: null,

  gitOpen: false,

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
export function uiPrompt(title, label, value = '', placeholder = '') {
  return new Promise(resolve => {
    store.prompt = { title, label, value, placeholder, resolve }
  })
}
export function uiConfirm(title, message, danger = false) {
  return new Promise(resolve => {
    store.confirmBox = { title, message, danger, resolve }
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
  await refreshTree()
  toast('工作区已设置：' + store.workspace)
  return true
}

export async function refreshTree() {
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
  const existing = store.tabs.find(t => t.path === absPath)
  if (existing) {
    if (focus) store.activeId = existing.id
    return existing
  }
  const tab = {
    id: 'tab-' + tabSeq++,
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
export function newMapDoc(rootText = '中心主题') {
  return {
    format: 'c-mind',
    version: 1,
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

export async function createDir(dirPath, name) {
  await api('fs:createDir', dirPath, name)
  await refreshTree()
}

export async function renamePath(p, newName) {
  let n = (newName || '').trim()
  if (!n) return
  if (!p.endsWith(MIND_EXT) || n.endsWith(MIND_EXT)) {
    // 保持扩展名一致
  } else if (p.endsWith(MIND_EXT) && !n.endsWith(MIND_EXT)) {
    n += MIND_EXT
  }
  await api('fs:rename', p, n)
  await refreshTree()
  // 同步已打开的标签
  const oldPath = p
  const newPath = p.slice(0, p.lastIndexOf('/') + 1) + n
  const tab = store.tabs.find(t => t.path === oldPath)
  if (tab) {
    tab.path = newPath
    tab.rel = relOf(newPath)
    tab.name = n.replace(new RegExp(MIND_EXT + '$'), '')
  }
}

export async function movePath(src, destDir) {
  const newPath = await api('fs:move', src, destDir)
  await refreshTree()
  const tab = store.tabs.find(t => t.path === src)
  if (tab) {
    tab.path = newPath
    tab.rel = relOf(newPath)
    tab.name = newPath.split('/').pop().replace(new RegExp(MIND_EXT + '$'), '')
  }
}

export async function deletePath(p, name) {
  const ok = await uiConfirm('删除', `确定将「${name}」移入废纸篓吗？`, true)
  if (!ok) return
  await api('fs:delete', p)
  const tab = store.tabs.find(t => t.path === p)
  if (tab) closeTab(tab.id)
  await refreshTree()
}

/* ---------- cmind:// 内部跳转 ---------- */
export async function handleCmindLink(url) {
  try {
    const u = new URL(url)
    const rel = u.searchParams.get('path')
    if (!rel) { toast('无效的脑图链接', 'error'); return }
    const ws = store.workspace.replace(/\/+$/, '')
    const abs = ws + '/' + decodeURIComponent(rel)
    try {
      await api('fs:read', abs)
    } catch {
      toast('目标脑图不存在：' + rel, 'error')
      return
    }
    await openMap(abs)
    toast('已打开：' + rel, 'ok')
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
    await refreshTree()
  } else {
    store.needWorkspace = true
  }
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
