<script setup>
/**
 * 脑图编辑器：基于 simple-mind-map
 * - Xmind 兼容快捷键（库内置：Tab/Enter/Shift+Tab/Del/Cmd+Z/Cmd+C…）
 * - 节点嵌入图片 / 网页链接 / 其他脑图链接（cmind://）
 * - 主题预设、布局切换、缩放适配、导出 PNG/SVG/XMind/JSON/FreeMind/OPML/Markdown、导入 XMind/FreeMind/OPML/Markdown/JSON、只读查看模式
 * - 自动保存 + ⌘S 手动保存
 */
import { ref, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import MindMap from 'simple-mind-map'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import Select from 'simple-mind-map/src/plugins/Select.js'
import Export from 'simple-mind-map/src/plugins/Export.js'
import ExportXMind from 'simple-mind-map/src/plugins/ExportXMind.js'
import KeyboardNavigation from 'simple-mind-map/src/plugins/KeyboardNavigation.js'
import {
  store, api, toast, uiContextMenu, MIND_EXT, syncRenameMap, sanitizeFileName, importMapAsFile
} from '../store.js'
import {
  extToKind, buildFreeMind, buildOpml, buildMarkdown, dataUrlToBase64
} from '../formats.js'

// 插件只需注册一次
if (!MindMap.__cmindPlugins) {
  MindMap.usePlugin(Drag)
  MindMap.usePlugin(Select)
  MindMap.usePlugin(Export)
  MindMap.usePlugin(ExportXMind)
  MindMap.usePlugin(KeyboardNavigation)
  MindMap.__cmindPlugins = true
}

const props = defineProps({ tab: { type: Object, required: true } })

const canvasEl = ref(null)
const scale = ref(1)
const hasActive = ref(false)
const hasImageNode = ref(false)
const showHelp = ref(false)

const dialog = ref(null) // { mode: 'image'|'link'|'note', ... }

let mindMap = null
let resizeObserver = null
let saveTimer = null
let loading = true
let rootTextAtLoad = '' // 加载时的根节点文本，用于判断用户是否修改了根节点

/* ---------- 主题预设 ---------- */
const THEME_PRESETS = {
  '经典蓝': {
    backgroundColor: '#fafafa', lineColor: '#748ffc', lineWidth: 2, lineStyle: 'curve',
    root: { fillColor: '#4c6ef5', color: '#ffffff', fontSize: 16 },
    second: { fillColor: '#e8ecfe', color: '#364fc7', fontSize: 14 },
    node: { fillColor: '#ffffff', color: '#2b2f3a', fontSize: 13 }
  },
  '青竹绿': {
    backgroundColor: '#fafaf5', lineColor: '#69db7c', lineWidth: 2, lineStyle: 'curve',
    root: { fillColor: '#2f9e44', color: '#ffffff', fontSize: 16 },
    second: { fillColor: '#d3f9d8', color: '#2b8a3e', fontSize: 14 },
    node: { fillColor: '#ffffff', color: '#2b2f3a', fontSize: 13 }
  },
  '暖阳橙': {
    backgroundColor: '#fffdf9', lineColor: '#ffa94d', lineWidth: 2, lineStyle: 'curve',
    root: { fillColor: '#f76707', color: '#ffffff', fontSize: 16 },
    second: { fillColor: '#ffe8cc', color: '#e8590c', fontSize: 14 },
    node: { fillColor: '#ffffff', color: '#2b2f3a', fontSize: 13 }
  },
  '暗夜紫': {
    backgroundColor: '#16181d', lineColor: '#6741d9', lineWidth: 2, lineStyle: 'curve',
    root: { fillColor: '#7950f2', color: '#ffffff', fontSize: 16 },
    second: { fillColor: '#343a40', color: '#ced4da', fontSize: 14 },
    node: { fillColor: '#212529', color: '#dee2e6', fontSize: 13 }
  }
}
const themeName = ref('经典蓝')

const LAYOUTS = [
  ['logicalStructure', '逻辑结构图'],
  ['logicalStructureLeft', '向左逻辑图'],
  ['mindMap', '思维导图（左右）'],
  ['organizationStructure', '组织结构图'],
  ['catalogOrganization', '目录组织图'],
  ['fishbone', '鱼骨图'],
  ['timeline', '时间轴']
]
const layoutName = ref('logicalStructure')

/* ---------- 保存 ---------- */
function scheduleSave() {
  if (props.tab.readonly) return
  props.tab.dirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 900)
}

async function saveNow() {
  clearTimeout(saveTimer)
  if (!mindMap || props.tab.readonly) return
  try {
    const gd = mindMap.getData(true) // { layout, root, theme, view }
    const rootText = gd.root && gd.root.data ? gd.root.data.text : ''
    // 根节点文本被修改 → 同步重命名磁盘文件（文件名 = 根节点名称）
    if (rootTextAtLoad && rootText && rootText !== rootTextAtLoad) {
      const renamed = await syncRenameMap(props.tab, rootText)
      rootTextAtLoad = rootText
      if (renamed) toast('文件名已同步为：' + sanitizeFileName(rootText) + MIND_EXT, 'ok')
    }
    const doc = { format: 'c-mind', version: 1, ...gd }
    await api('fs:write', props.tab.path, JSON.stringify(doc, null, 2))
    props.tab.dirty = false
  } catch (e) {
    toast('保存失败：' + (e.message || e), 'error')
  }
}

/* ---------- 初始化 ---------- */
onMounted(async () => {
  window.addEventListener('keydown', onEditKeydown, true)
  loading = true
  let doc
  try {
    const content = await api('fs:read', props.tab.path)
    doc = JSON.parse(content)
  } catch (e) {
    console.error('[cmind] 文件读取/解析失败:', props.tab.path, e && e.message)
    toast('文件读取失败，已创建空白导图', 'error')
    doc = { layout: 'logicalStructure', theme: { template: 'default', config: {} }, root: { data: { text: '中心主题' }, children: [] } }
  }
  layoutName.value = doc.layout || 'logicalStructure'
  // 兼容其他工具产出的文件：补齐图片尺寸
  let repairedImages = 0
  try { repairedImages = await repairImageSizes(doc.root) } catch {}
  let cleanedMediaTexts = 0
  try { cleanedMediaTexts = cleanDocMediaTexts(doc.root) } catch {}

  mindMap = new MindMap({
    el: canvasEl.value,
    data: doc.root || { data: { text: '中心主题' }, children: [] },
    layout: doc.layout || 'logicalStructure',
    theme: doc.theme?.template || 'default',
    themeConfig: doc.theme?.config || {},
    viewData: doc.view || null,
    readonly: !!props.tab.readonly,
    initRootNodeCenter: true,
    enableAutoEnterTextEditWhenKeydown: true,
    mousewheelAction: 'zoom' // 与 Xmind 一致：滚轮缩放
  })
  if (doc.view) { try { mindMap.view.setTransformData(doc.view) } catch {} }
  rootTextAtLoad = (mindMap.getData().data || {}).text || ''
  if (repairedImages > 0 || cleanedMediaTexts > 0) {
    saveNow() // 把修复后的图片尺寸/文本写回文件
  }
  window.__cmindMap = mindMap // 调试/开发者工具用

  mindMap.on('data_change', () => {
    if (loading) return
    scheduleSave()
  })
  mindMap.on('node_active', (_node, list) => {
    hasActive.value = list.length > 0
    hasImageNode.value = list.length === 1 && !!list[0].getData('image')
  })
  // 节点右键菜单（与 Xmind 一致：插入/编辑/删除）
  mindMap.on('node_contextmenu', (e, node) => {
    if (!node) return
    e.preventDefault && e.preventDefault()
    e.stopPropagation && e.stopPropagation() // 阻止冒泡到 App 根元素（否则菜单刚打开就被全局关闭）
    const items = []
    if (!node.isRoot) {
      items.push(
        { label: '插入同级节点 (Enter)', action: () => mindMap.execCommand('INSERT_NODE', false, [node]) },
        { label: '插入上级节点 (⇧Tab)', action: () => mindMap.execCommand('INSERT_PARENT_NODE', false, [node]) }
      )
    }
    items.push(
      { label: (node.isRoot ? '插入一级节点' : '插入子节点') + ' (Tab)', action: () => mindMap.execCommand('INSERT_CHILD_NODE', true, [node]) },
      { label: '编辑节点（双击同效）', action: () => { node.active(); mindMap.renderer.textEdit.show({ node }) } },
      { label: '复制节点文本', action: () => { navigator.clipboard.writeText(node.getData('text') || ''); toast('已复制节点文本', 'ok') } }
    )
    if (node.getData('image')) {
      items.push(
        { type: 'sep' },
        { label: '查看图片大图（可缩放）', action: () => openImageViewer(node) },
        { label: '图片：重置为缩略图', action: () => resetNodeImageThumb(node) }
      )
    }
    if (!node.isRoot) {
      items.push({ label: '删除节点 (⌫)', danger: true, action: () => mindMap.execCommand('REMOVE_NODE', [node]) })
    }
    uiContextMenu(e.clientX || 0, e.clientY || 0, items)
  })
  // 点击节点里的图片 → 直接弹窗看大图（可缩放）
  mindMap.on('node_img_click', (node) => { openImageViewer(node) })
  mindMap.on('node_img_dblclick', (node) => { openImageViewer(node) })
  mindMap.on('scale', (s) => { scale.value = s })
  mindMap.on('node_tree_render_end', () => { loading = false })
  setTimeout(() => { loading = false }, 1500)

  resizeObserver = new ResizeObserver(() => {
    try { mindMap && mindMap.resize() } catch {}
  })
  resizeObserver.observe(canvasEl.value)

  store.requestSave = () => { saveNow(); toast('已保存', 'ok') }
  // 主题预设名称回显
  themeName.value = closestPreset(mindMap.getCustomThemeConfig())
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEditKeydown, true)
  clearTimeout(saveTimer)
  try { if (props.tab.dirty) saveNow() } catch {}
  store.requestSave = null
  resizeObserver && resizeObserver.disconnect()
  try { mindMap && mindMap.destroy() } catch {}
  mindMap = null
})

function closestPreset(cfg) {
  for (const [name, preset] of Object.entries(THEME_PRESETS)) {
    if (JSON.stringify(preset.root?.fillColor) === JSON.stringify(cfg?.root?.fillColor)) return name
  }
  return '自定义'
}

/* ---------- 命令 ---------- */
function activeNode() {
  const list = mindMap.renderer.activeNodeList || []
  return list[list.length - 1] || null
}
function exec(cmd, ...args) {
  try { mindMap.execCommand(cmd, ...args) } catch (e) { toast('操作失败：' + (e.message || e), 'error') }
}

const undo = () => exec('BACK')
const redo = () => exec('FORWARD')
const addChild = () => exec('INSERT_CHILD_NODE')
const addSibling = () => exec('INSERT_NODE')
const addParent = () => exec('INSERT_PARENT_NODE')
const removeNode = () => exec('REMOVE_NODE')

function zoomIn() { mindMap && mindMap.view.enlarge() }
function zoomOut() { mindMap && mindMap.view.narrow() }
function zoomFit() { try { mindMap.view.fit() } catch {} }
function zoomReset() { try { mindMap.view.reset() } catch {} }

function onThemeChange() {
  const preset = THEME_PRESETS[themeName.value]
  if (preset) mindMap.setThemeConfig(JSON.parse(JSON.stringify(preset)))
}
function onLayoutChange() {
  mindMap.setLayout(layoutName.value)
  scheduleSave()
}

function toggleReadonly() {
  props.tab.readonly = !props.tab.readonly
  mindMap.setMode(props.tab.readonly ? 'readonly' : 'edit')
  toast(props.tab.readonly ? '已切换为查看（只读）模式' : '已切换为编辑模式')
}

/* ---------- 导出 ---------- */
function exportMenu(e) {
  e.stopPropagation() // 阻止冒泡到 .app-shell 的同一次 click，否则菜单刚打开就被关闭
  const rect = e.target.getBoundingClientRect()
  uiContextMenu(rect.left, rect.bottom + 4, [
    { label: 'PNG 图片', action: () => doExport('png') },
    { label: 'SVG 矢量图', action: () => doExport('svg') },
    { type: 'sep' },
    { label: 'XMind 文件（可导入 XMind）', action: () => doExport('xmind') },
    { label: 'FreeMind 文件 .mm（可导入 FreeMind / Xmind）', action: () => doExportInterop('freemind') },
    { label: 'OPML 大纲（可导入幕布 / Workflowy）', action: () => doExportInterop('opml') },
    { label: 'Markdown 大纲 .md', action: () => doExportInterop('markdown') },
    { label: 'JSON 数据', action: () => doExport('json') }
  ])
}

/* 内置导出：png / svg / xmind / json（simple-mind-map 提供），保存到指定位置 */
async function doExport(type) {
  try {
    const extMap = { png: 'png', svg: 'svg', xmind: 'xmind', json: 'json' }
    toast('正在导出 ' + type.toUpperCase() + ' …')
    let data = await mindMap.export(type, false, props.tab.name)
    let content
    if (typeof data === 'string' && data.startsWith('data:')) {
      content = { base64: (dataUrlToBase64(data) || {}).base64 || '' }
    } else {
      content = String(data)
    }
    const saved = await api('export:save', {
      defaultName: props.tab.name + '.' + extMap[type],
      filters: [{ name: type.toUpperCase(), extensions: [extMap[type]] }],
      content
    })
    if (saved) toast('已导出：' + saved, 'ok')
  } catch (err) {
    toast('导出失败：' + (err.message || err), 'error')
  }
}

/* 互操作导出：FreeMind / OPML / Markdown（由数据树构建，其他平台可直接导入） */
async function doExportInterop(kind) {
  try {
    const root = mindMap.getData()
    let content, ext, label
    if (kind === 'freemind') { content = buildFreeMind(root); ext = 'mm'; label = 'FreeMind' }
    else if (kind === 'opml') { content = buildOpml(root); ext = 'opml'; label = 'OPML' }
    else { content = buildMarkdown(root); ext = 'md'; label = 'Markdown' }
    const saved = await api('export:save', {
      defaultName: props.tab.name + '.' + ext,
      filters: [{ name: label, extensions: [ext] }],
      content
    })
    if (saved) toast('已导出：' + saved, 'ok')
  } catch (err) {
    toast('导出失败：' + (err.message || err), 'error')
  }
}

/* ---------- 节点图片：画布内只显示缩略图，点击「放大」弹窗查看大图 ---------- */
const THUMB_MAX_W = 200
const THUMB_MAX_H = 100
const IMG_VIEW_SCALE_MIN = 0.1
const IMG_VIEW_SCALE_MAX = 8

const imageViewer = ref(null) // { url, title, scale, x, y, natW, natH }

function thumbSize(nat, fallbackW, fallbackH) {
  const w = Math.max(1, nat ? nat.w : fallbackW || THUMB_MAX_W)
  const h = Math.max(1, nat ? nat.h : fallbackH || THUMB_MAX_H)
  const r = Math.min(THUMB_MAX_W / w, THUMB_MAX_H / h, 1)
  return { width: Math.max(1, Math.round(w * r)), height: Math.max(1, Math.round(h * r)) }
}

async function openImageViewer(node) {
  const d = node && typeof node.getData === 'function' ? node.getData() : null
  if (!d || !d.image) { toast('当前节点没有图片', 'error'); return }
  // 先取到原始尺寸再显示，避免出现「先 100% 再跳成适合窗口」的闪动
  const nat = await probeImageSize(d.image)
  const v = {
    url: d.image,
    title: d.imageTitle || d.text || '',
    scale: 1, x: 0, y: 0, px: 0, py: 0,
    natW: nat ? nat.w : 1200,
    natH: nat ? nat.h : 800
  }
  imageViewer.value = v
  await nextTick()
  viewerFit()
}
function closeImageViewer() { imageViewer.value = null }
function viewerZoom(delta) {
  const v = imageViewer.value
  if (!v) return
  v.scale = Math.min(IMG_VIEW_SCALE_MAX, Math.max(IMG_VIEW_SCALE_MIN, +(v.scale + delta).toFixed(3)))
}
function viewerFit() {
  // 铺满弹窗：等比缩放到刚好占满可用区域（小图会放大、大图会缩小）
  const v = imageViewer.value
  if (!v || !v.natW) return
  const st = document.querySelector('.img-viewer .viewer-stage')
  const sw = (st ? st.clientWidth : window.innerWidth * 0.7) * 0.96
  const sh = (st ? st.clientHeight : window.innerHeight * 0.6) * 0.96
  v.scale = Math.max(IMG_VIEW_SCALE_MIN, Math.min(IMG_VIEW_SCALE_MAX, Math.min(sw / v.natW, sh / v.natH)))
  v.x = 0
  v.y = 0
}

/* 拖动标题栏移动悬浮弹窗 */
let panelDrag = null
function viewerPanelDown(e) {
  if (e.target.closest && e.target.closest('button')) return
  const v = imageViewer.value
  if (!v) return
  panelDrag = { sx: e.clientX, sy: e.clientY, ox: v.px || 0, oy: v.py || 0 }
  window.addEventListener('mousemove', panelMove)
  window.addEventListener('mouseup', panelUp)
}
function panelMove(e) {
  const v = imageViewer.value
  if (!panelDrag || !v) return
  v.px = panelDrag.ox + e.clientX - panelDrag.sx
  v.py = panelDrag.oy + e.clientY - panelDrag.sy
}
function panelUp() {
  panelDrag = null
  window.removeEventListener('mousemove', panelMove)
  window.removeEventListener('mouseup', panelUp)
}
function onViewerWheel(e) {
  const v = imageViewer.value
  if (!v) return
  e.preventDefault()
  const k = e.deltaY > 0 ? 0.9 : 1.111
  v.scale = Math.min(IMG_VIEW_SCALE_MAX, Math.max(IMG_VIEW_SCALE_MIN, +(v.scale * k).toFixed(3)))
}
let viewerDrag = null
function viewerDown(e) {
  if (!imageViewer.value) return
  viewerDrag = { sx: e.clientX, sy: e.clientY, ox: imageViewer.value.x, oy: imageViewer.value.y }
  window.addEventListener('mousemove', viewerMove)
  window.addEventListener('mouseup', viewerUp)
}
function viewerMove(e) {
  if (!viewerDrag || !imageViewer.value) return
  imageViewer.value.x = viewerDrag.ox + e.clientX - viewerDrag.sx
  imageViewer.value.y = viewerDrag.oy + e.clientY - viewerDrag.sy
}
function viewerUp() {
  viewerDrag = null
  window.removeEventListener('mousemove', viewerMove)
  window.removeEventListener('mouseup', viewerUp)
}

/* 把某节点图片恢复为缩略图尺寸（右键菜单用） */
async function resetNodeImageThumb(node) {
  const d = node.getData()
  if (!d.image) return
  const nat = await probeImageSize(d.image)
  const sz = thumbSize(nat, (d.imageSize || {}).width, (d.imageSize || {}).height)
  mindMap.execCommand('SET_NODE_IMAGE', node, { url: d.image, title: d.imageTitle || '', width: sz.width, height: sz.height, custom: false })
  scheduleSave()
  toast('图片已重置为缩略图', 'ok')
}

/* ---------- 空白清理：带图片/链接的节点不应带纯空白文本 ---------- */
function cleanMediaNodeText(node) {
  if (!node) return false
  const d = node.getData()
  if (!d.image && !d.hyperlink) return false
  const t = String(d.text == null ? '' : d.text)
  const cleaned = t.trim()
  if (cleaned === t) return false
  mindMap.execCommand('SET_NODE_TEXT', node, cleaned)
  return true
}
function cleanDocMediaTexts(root) {
  let fixed = 0
  const walk = (n) => {
    if (!n) return
    const d = n.data || {}
    if ((d.image || d.hyperlink) && d.text != null && String(d.text).trim() !== String(d.text)) {
      d.text = String(d.text).trim()
      fixed++
    }
    ;(n.children || []).forEach(walk)
  }
  walk(root)
  return fixed
}

/* ---------- 导入：XMind / FreeMind / OPML / Markdown / JSON ---------- */

/* ---------- 插入图片 / 链接 / 备注 ---------- */
function openImageDialog() {
  if (!requireNode()) return
  dialog.value = { mode: 'image', imgUrl: '', dataUrl: '', fileName: '' }
}
function openLinkDialog() {
  if (!requireNode()) return
  dialog.value = { mode: 'link', linkType: 'web', webUrl: '', webTitle: '', selMap: null }
}

/* 脑图链接候选列表：按工作区目录结构层级展开（文件夹作为分组，不可选） */
const linkRows = computed(() => {
  if (!dialog.value || dialog.value.mode !== 'link') return []
  const rows = []
  const walk = (list, depth) => {
    for (const n of list) {
      if (n.type === 'dir') {
        rows.push({ type: 'dir', name: n.name, depth })
        walk(n.children || [], depth + 1)
      } else if (n.isMap && n.path !== props.tab.path) {
        rows.push({ type: 'map', name: n.name.replace(/\.cmind$/, ''), rel: n.rel, path: n.path, depth })
      }
    }
  }
  walk(store.tree, 0)
  return rows
})
function openNoteDialog() {
  if (!requireNode()) return
  dialog.value = { mode: 'note', note: activeNode()?.getData('note') || '' }
}
function requireNode() {
  if (!hasActive.value) { toast('请先选中一个节点', 'error'); return false }
  return true
}

function onPickImageFile(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    dialog.value.dataUrl = reader.result
    dialog.value.fileName = file.name
  }
  reader.readAsDataURL(file)
}

async function applyDialog() {
  const d = dialog.value
  const node = activeNode()
  if (!d || !node) return
  try {
    if (d.mode === 'image') {
      const url = d.dataUrl || d.imgUrl.trim()
      if (!url) { toast('请选择本地图片或填写图片地址', 'error'); return }
      const size = await probeImageSize(url)
      const sz = thumbSize(size)
      exec('SET_NODE_IMAGE', node, { url, title: d.fileName || '', width: sz.width, height: sz.height, custom: false })
    } else if (d.mode === 'link') {
      if (d.linkType === 'web') {
        const url = d.webUrl.trim()
        if (!/^https?:\/\//i.test(url)) { toast('网页链接需以 http(s):// 开头', 'error'); return }
        exec('SET_NODE_HYPERLINK', node, url, d.webTitle.trim())
      } else {
        if (!d.selMap) { toast('请选择一个目标脑图', 'error'); return }
        const link = 'cmind://open?path=' + encodeURIComponent(d.selMap.rel)
        exec('SET_NODE_HYPERLINK', node, link, d.selMap.name.replace(new RegExp(MIND_EXT + '$'), ''))
      }
    } else if (d.mode === 'note') {
      exec('SET_NODE_NOTE', node, d.note.trim())
    }
    if (d.mode === 'image' || d.mode === 'link') cleanMediaNodeText(node)
    dialog.value = null
    scheduleSave()
  } catch (err) {
    toast('设置失败：' + (err.message || err), 'error')
  }
}

/* 图片统一按缩略图展示（≤200×100 等比），缺失尺寸/自定义超大尺寸一并收拢，保证版面美观 */
async function repairImageSizes(root) {
  let fixed = 0
  const list = []
  const walk = (n) => {
    if (!n) return
    if (n.data && n.data.image) list.push(n)
    ;(n.children || []).forEach(walk)
  }
  walk(root)
  for (const n of list) {
    const d = n.data
    const sz = d.imageSize || {}
    const needFix = !sz.width || !sz.height || sz.custom ||
      sz.width > THUMB_MAX_W + 0.5 || sz.height > THUMB_MAX_H + 0.5
    if (!needFix) continue
    let nat = null
    try { nat = await probeImageSize(d.image) } catch {}
    const t = thumbSize(nat, sz.width, sz.height)
    d.imageSize = { width: t.width, height: t.height, custom: false }
    fixed++
  }
  return fixed
}

/* 编辑时 Shift+Enter：节点内换行（sm-m 的 Enter 是保存并新建同级节点） */
function onEditKeydown(e) {
  if (e.key === 'Escape' && imageViewer.value) { closeImageViewer(); return }
  if (e.key !== 'Enter' || !e.shiftKey) return
  const isEdit = (x) => x && x.classList && x.classList.contains('smm-node-edit-wrap')
  const el = isEdit(e.target) ? e.target : (isEdit(document.activeElement) ? document.activeElement : null)
  if (!el) return
  e.preventDefault()
  e.stopPropagation()
  const before = el.innerHTML
  try { document.execCommand('insertLineBreak') } catch {}
  if (el.innerHTML === before) {
    // 兜底：手动在光标处插入 <br>
    const sel = window.getSelection()
    if (sel && sel.rangeCount && el.contains(sel.getRangeAt(0).startContainer)) {
      const r = sel.getRangeAt(0)
      r.deleteContents()
      const br = document.createElement('br')
      r.insertNode(br)
      r.setStartAfter(br)
      r.collapse(true)
      sel.removeAllRanges()
      sel.addRange(r)
    } else {
      el.appendChild(document.createElement('br'))
    }
  }
}

function probeImageSize(url) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || 200, h: img.naturalHeight || 100 })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/* 清除所选节点的图片/链接/备注 */
function clearNodeExtra(kind) {
  const node = activeNode()
  if (!node) return
  if (kind === 'image') exec('SET_NODE_IMAGE', node, { url: null })
  else if (kind === 'link') exec('SET_NODE_HYPERLINK', node, null, null)
  else if (kind === 'note') exec('SET_NODE_NOTE', node, '')
  scheduleSave()
}

const scalePercent = computed(() => Math.round(scale.value * 100) + '%')
</script>

<template>
  <div class="editor-root">
    <!-- 工具栏 -->
    <div class="toolbar">
      <button class="icon-btn" data-tip="撤销" data-key="⌘Z" @click="undo">↩︎</button>
      <button class="icon-btn" data-tip="重做" data-key="⌘Y" @click="redo">↪︎</button>
      <div class="sep"></div>
      <button class="icon-btn" data-tip="添加子节点" data-key="Tab" @click="addChild">＋子节点</button>
      <button class="icon-btn" data-tip="添加同级节点" data-key="Enter" @click="addSibling">＋同级</button>
      <button class="icon-btn" data-tip="添加上级节点" data-key="⇧Tab" @click="addParent">＋上级</button>
      <button class="icon-btn" data-tip="删除节点" data-key="⌫" @click="removeNode">🗑</button>
      <div class="sep"></div>
      <button class="icon-btn" data-tip="插入图片" @click="openImageDialog">🖼</button>
      <button class="icon-btn" data-tip="查看图片大图（可缩放）" :disabled="!hasImageNode" @click="openImageViewer(mindMap && mindMap.renderer.activeNodeList[0])">🔍</button>
      <button class="icon-btn" data-tip="插入链接（网页/其他脑图）" @click="openLinkDialog">🔗</button>
      <button class="icon-btn" data-tip="插入备注" @click="openNoteDialog">📝</button>
      <div class="sep"></div>
      <select v-model="layoutName" data-tip="切换布局" @change="onLayoutChange">
        <option v-for="[v, label] in LAYOUTS" :key="v" :value="v">{{ label }}</option>
      </select>
      <select v-model="themeName" data-tip="主题配色" @change="onThemeChange">
        <option v-for="name in Object.keys(THEME_PRESETS)" :key="name" :value="name">{{ name }}</option>
        <option disabled>自定义</option>
      </select>
      <div class="sep"></div>
      <button class="icon-btn" data-tip="缩小" @click="zoomOut">－</button>
      <span class="zoom-label">{{ scalePercent }}</span>
      <button class="icon-btn" data-tip="放大" @click="zoomIn">＋</button>
      <button class="icon-btn" data-tip="适配画布" @click="zoomFit">⤢</button>
      <button class="icon-btn" data-tip="回到中心" @click="zoomReset">◎</button>
      <div class="spacer"></div>
      <button :class="['icon-btn', { 'btn-toggled': tab.readonly }]" data-tip="查看/编辑模式切换" @click="toggleReadonly">
        {{ tab.readonly ? '👁 查看' : '✏️ 编辑' }}
      </button>
      <button class="icon-btn" data-tip="导出" @click="exportMenu">导出 ▾</button>
      <button class="icon-btn" data-tip="快捷键说明" @click="showHelp = true">⌘?</button>
    </div>

    <!-- 画布 -->
    <div ref="canvasEl" class="canvas-holder"></div>

    <!-- 插入对话框 -->
    <div v-if="dialog" class="overlay" @click.self="dialog = null">
      <div class="modal">
        <div class="modal-head">
          {{ dialog.mode === 'image' ? '🖼 插入图片' : dialog.mode === 'link' ? '🔗 插入链接' : '📝 节点备注' }}
        </div>

        <div class="modal-body" v-if="dialog.mode === 'image'">
          <div class="form-row">
            <label>本地图片（以 base64 内嵌，随文件走）</label>
            <input type="file" accept="image/*" @change="onPickImageFile" />
            <div v-if="dialog.fileName" class="hint" style="margin-top:4px">已选择：{{ dialog.fileName }}</div>
          </div>
          <div class="form-row">
            <label>或图片网络地址</label>
            <input type="url" v-model="dialog.imgUrl" placeholder="https://…" :disabled="!!dialog.dataUrl" />
          </div>
        </div>

        <div class="modal-body" v-if="dialog.mode === 'link'">
          <label class="form-check">
            <input type="radio" value="web" v-model="dialog.linkType" /> 网页链接
          </label>
          <label class="form-check">
            <input type="radio" value="map" v-model="dialog.linkType" /> 脑图链接（点击后在本应用打开新标签页）
          </label>

          <div v-if="dialog.linkType === 'web'" style="margin-top:10px">
            <div class="form-row">
              <label>链接地址</label>
              <input type="url" v-model="dialog.webUrl" placeholder="https://…" />
            </div>
            <div class="form-row">
              <label>备注名（可选）</label>
              <input type="text" v-model="dialog.webTitle" placeholder="显示在链接提示里" />
            </div>
          </div>

          <div v-else style="margin-top:10px">
            <div class="map-list">
              <div
                v-for="(r, i) in linkRows" :key="i"
                class="item" :class="{ sel: r.type === 'map' && dialog.selMap && dialog.selMap.path === r.path, dir: r.type === 'dir' }"
                :style="{ paddingLeft: 10 + r.depth * 16 + 'px' }"
                @click="r.type === 'map' && (dialog.selMap = r)"
              >
                <span v-if="r.type === 'dir'">📁 <b>{{ r.name }}</b></span>
                <span v-else>🧠 {{ r.name }} <span class="rel">{{ r.rel }}</span></span>
              </div>
              <div v-if="!linkRows.some(r => r.type === 'map')" class="hint" style="padding:10px">
                工作区里还没有其它脑图文件
              </div>
            </div>
          </div>
        </div>

        <div class="modal-body" v-if="dialog.mode === 'note'">
          <textarea v-model="dialog.note" v-focus rows="6" placeholder="为选中节点添加备注…"></textarea>
        </div>

        <div class="modal-foot">
          <button v-if="dialog.mode !== 'link'" class="danger" @click="clearNodeExtra(dialog.mode); dialog = null">
            清除已有内容
          </button>
          <button @click="dialog = null">取消</button>
          <button class="primary" @click="applyDialog">确定</button>
        </div>
      </div>
    </div>

    <!-- 图片大图查看（悬浮弹窗，可放大/缩小、可拖动） -->
    <div v-if="imageViewer" class="overlay img-viewer" @click.self="closeImageViewer">
      <div class="viewer-panel" :style="{ transform: `translate(${imageViewer.px || 0}px, ${imageViewer.py || 0}px)` }">
        <div class="viewer-bar" @mousedown.prevent="viewerPanelDown">
          <span class="vname" :title="imageViewer.title">{{ imageViewer.title || '图片预览' }}</span>
          <span class="vspace"></span>
          <button @click="viewerZoom(-0.25)">－</button>
          <span class="vpct">{{ Math.round(imageViewer.scale * 100) }}%</span>
          <button @click="viewerZoom(0.25)">＋</button>
          <button @click="viewerFit">适合窗口</button>
          <button @click="imageViewer.scale = 1; imageViewer.x = 0; imageViewer.y = 0">100%</button>
          <button class="primary" @click="closeImageViewer">关闭</button>
        </div>
        <div class="viewer-stage" @wheel.prevent="onViewerWheel" @mousedown.prevent="viewerDown" @dblclick="viewerFit">
          <img :src="imageViewer.url" draggable="false"
               :style="{ transform: `translate(${imageViewer.x}px, ${imageViewer.y}px) scale(${imageViewer.scale})` }" />
        </div>
      </div>
    </div>

    <!-- 快捷键说明 -->
    <div v-if="showHelp" class="overlay" @click.self="showHelp = false">
      <div class="modal wide">
        <div class="modal-head">快捷键（与 Xmind 一致）</div>
        <div class="modal-body">
          <table class="shortcut-table">
            <tr><th>按键</th><th>功能</th></tr>
            <tr><td><kbd>Tab</kbd></td><td>添加子节点</td></tr>
            <tr><td><kbd>Enter</kbd></td><td>添加同级节点</td></tr>
            <tr><td><kbd>⇧Tab</kbd></td><td>添加上级（父）节点</td></tr>
            <tr><td><kbd>⌫</kbd> / <kbd>Del</kbd></td><td>删除节点</td></tr>
            <tr><td>直接输入文字</td><td>进入文本编辑</td></tr>
            <tr><td><kbd>⇧Enter</kbd></td><td>节点内换行（编辑时，Enter 为保存并新建同级）</td></tr>
            <tr><td><kbd>⌘Z</kbd> / <kbd>⌘Y</kbd></td><td>撤销 / 重做</td></tr>
            <tr><td><kbd>⌘C</kbd> / <kbd>⌘X</kbd> / <kbd>⌘V</kbd></td><td>复制 / 剪切 / 粘贴节点</td></tr>
            <tr><td><kbd>⌘↑</kbd> / <kbd>⌘↓</kbd></td><td>节点上移 / 下移</td></tr>
            <tr><td><kbd>⌘A</kbd></td><td>全选节点</td></tr>
            <tr><td><kbd>/</kbd></td><td>展开 / 收起节点</td></tr>
            <tr><td><kbd>⌘G</kbd></td><td>添加概要</td></tr>
            <tr><td>触控板 / 滚轮</td><td>缩放画布</td></tr>
            <tr><td><kbd>⌘S</kbd> / <kbd>⌘N</kbd> / <kbd>⌘W</kbd></td><td>保存 / 新建脑图 / 关闭标签</td></tr>
            <tr><td>点击 🔗 图标</td><td>打开节点链接（网页 → 浏览器，脑图 → 新标签页）</td></tr>
            <tr><td>点击节点中的图片</td><td>弹窗查看图片大图（可放大 / 缩小 / 拖动）</td></tr>
          </table>
        </div>
        <div class="modal-foot">
          <button class="primary" @click="showHelp = false">知道了</button>
        </div>
      </div>
    </div>
  </div>
</template>
