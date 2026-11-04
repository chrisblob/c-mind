<script setup>
/**
 * 脑图编辑器：基于 simple-mind-map
 * - Xmind 兼容快捷键（库内置：Tab/Enter/Shift+Tab/Del/Cmd+Z/Cmd+C…）
 * - 节点嵌入图片 / 网页链接 / 其他脑图链接（cmind://）
 * - 主题预设、布局切换、缩放适配、导出 PNG/SVG/XMind/JSON、只读查看模式
 * - 自动保存 + ⌘S 手动保存
 */
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import MindMap from 'simple-mind-map'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import Select from 'simple-mind-map/src/plugins/Select.js'
import Export from 'simple-mind-map/src/plugins/Export.js'
import ExportXMind from 'simple-mind-map/src/plugins/ExportXMind.js'
import NodeImgAdjust from 'simple-mind-map/src/plugins/NodeImgAdjust.js'
import KeyboardNavigation from 'simple-mind-map/src/plugins/KeyboardNavigation.js'
import {
  store, api, toast, uiContextMenu, MIND_EXT, syncRenameMap, sanitizeFileName
} from '../store.js'

// 插件只需注册一次
if (!MindMap.__cmindPlugins) {
  MindMap.usePlugin(Drag)
  MindMap.usePlugin(Select)
  MindMap.usePlugin(Export)
  MindMap.usePlugin(ExportXMind)
  MindMap.usePlugin(NodeImgAdjust)
  MindMap.usePlugin(KeyboardNavigation)
  MindMap.__cmindPlugins = true
}

const props = defineProps({ tab: { type: Object, required: true } })

const canvasEl = ref(null)
const scale = ref(1)
const hasActive = ref(false)
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
  loading = true
  let doc
  try {
    const content = await api('fs:read', props.tab.path)
    doc = JSON.parse(content)
  } catch {
    toast('文件读取失败，已创建空白导图', 'error')
    doc = { layout: 'logicalStructure', theme: { template: 'default', config: {} }, root: { data: { text: '中心主题' }, children: [] } }
  }
  layoutName.value = doc.layout || 'logicalStructure'

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
  window.__cmindMap = mindMap // 调试/开发者工具用

  mindMap.on('data_change', () => {
    if (loading) return
    scheduleSave()
  })
  mindMap.on('node_active', (_node, list) => {
    hasActive.value = list.length > 0
  })
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
  const rect = e.target.getBoundingClientRect()
  uiContextMenu(rect.left, rect.bottom + 4, [
    { label: 'PNG 图片', action: () => doExport('png') },
    { label: 'SVG 矢量图', action: () => doExport('svg') },
    { label: 'XMind 文件', action: () => doExport('xmind') },
    { label: 'JSON 数据', action: () => doExport('json') }
  ])
}
async function doExport(type) {
  try {
    toast('正在导出 ' + type.toUpperCase() + ' …')
    await mindMap.export(type, true, props.tab.name)
    toast('导出完成（已在下载弹窗中选择位置）', 'ok')
  } catch (err) {
    toast('导出失败：' + (err.message || err), 'error')
  }
}

/* ---------- 插入图片 / 链接 / 备注 ---------- */
function openImageDialog() {
  if (!requireNode()) return
  dialog.value = { mode: 'image', imgUrl: '', dataUrl: '', fileName: '' }
}
function openLinkDialog() {
  if (!requireNode()) return
  dialog.value = { mode: 'link', linkType: 'web', webUrl: '', webTitle: '', maps: [], selMap: null }
  api('fs:listMaps').then(maps => {
    if (dialog.value && dialog.value.mode === 'link') {
      dialog.value.maps = maps.filter(m => m.path !== props.tab.path)
    }
  })
}
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
      exec('SET_NODE_IMAGE', node, { url, title: d.fileName || '' })
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
    dialog.value = null
    scheduleSave()
  } catch (err) {
    toast('设置失败：' + (err.message || err), 'error')
  }
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
      <button class="icon-btn" title="撤销 (⌘Z)" @click="undo">↩︎</button>
      <button class="icon-btn" title="重做 (⌘Y)" @click="redo">↪︎</button>
      <div class="sep"></div>
      <button class="icon-btn" title="添加子节点 (Tab)" @click="addChild">＋子节点</button>
      <button class="icon-btn" title="添加同级节点 (Enter)" @click="addSibling">＋同级</button>
      <button class="icon-btn" title="添加上级节点 (⇧Tab)" @click="addParent">＋上级</button>
      <button class="icon-btn" title="删除节点 (⌫)" @click="removeNode">🗑</button>
      <div class="sep"></div>
      <button class="icon-btn" title="插入图片" @click="openImageDialog">🖼</button>
      <button class="icon-btn" title="插入链接（网页/其他脑图）" @click="openLinkDialog">🔗</button>
      <button class="icon-btn" title="插入备注" @click="openNoteDialog">📝</button>
      <div class="sep"></div>
      <select v-model="layoutName" title="切换布局" @change="onLayoutChange">
        <option v-for="[v, label] in LAYOUTS" :key="v" :value="v">{{ label }}</option>
      </select>
      <select v-model="themeName" title="主题配色" @change="onThemeChange">
        <option v-for="name in Object.keys(THEME_PRESETS)" :key="name" :value="name">{{ name }}</option>
        <option disabled>自定义</option>
      </select>
      <div class="sep"></div>
      <button class="icon-btn" title="缩小" @click="zoomOut">－</button>
      <span class="zoom-label">{{ scalePercent }}</span>
      <button class="icon-btn" title="放大" @click="zoomIn">＋</button>
      <button class="icon-btn" title="适配画布" @click="zoomFit">⤢</button>
      <button class="icon-btn" title="回到中心" @click="zoomReset">◎</button>
      <div class="spacer"></div>
      <button :class="['icon-btn', { 'btn-toggled': tab.readonly }]" title="查看/编辑模式切换" @click="toggleReadonly">
        {{ tab.readonly ? '👁 查看' : '✏️ 编辑' }}
      </button>
      <button class="icon-btn" title="导出" @click="exportMenu">导出 ▾</button>
      <button class="icon-btn" title="快捷键说明" @click="showHelp = true">⌘?</button>
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
                v-for="m in dialog.maps" :key="m.path"
                class="item" :class="{ sel: dialog.selMap && dialog.selMap.path === m.path }"
                @click="dialog.selMap = m"
              >🧠 {{ m.name.replace('.cmind','') }} <span class="rel">{{ m.rel }}</span></div>
              <div v-if="!dialog.maps.length" class="hint" style="padding:10px">
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
            <tr><td><kbd>⌘Z</kbd> / <kbd>⌘Y</kbd></td><td>撤销 / 重做</td></tr>
            <tr><td><kbd>⌘C</kbd> / <kbd>⌘X</kbd> / <kbd>⌘V</kbd></td><td>复制 / 剪切 / 粘贴节点</td></tr>
            <tr><td><kbd>⌘↑</kbd> / <kbd>⌘↓</kbd></td><td>节点上移 / 下移</td></tr>
            <tr><td><kbd>⌘A</kbd></td><td>全选节点</td></tr>
            <tr><td><kbd>/</kbd></td><td>展开 / 收起节点</td></tr>
            <tr><td><kbd>⌘G</kbd></td><td>添加概要</td></tr>
            <tr><td>触控板 / 滚轮</td><td>缩放画布</td></tr>
            <tr><td><kbd>⌘S</kbd> / <kbd>⌘N</kbd> / <kbd>⌘W</kbd></td><td>保存 / 新建脑图 / 关闭标签</td></tr>
            <tr><td>点击 🔗 图标</td><td>打开节点链接（网页 → 浏览器，脑图 → 新标签页）</td></tr>
          </table>
        </div>
        <div class="modal-foot">
          <button class="primary" @click="showHelp = false">知道了</button>
        </div>
      </div>
    </div>
  </div>
</template>
