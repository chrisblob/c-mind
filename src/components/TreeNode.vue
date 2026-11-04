<script setup>
/**
 * 文件树节点（递归组件）
 * 目录节点 / 脑图文件 / 普通文件，均支持右键新建、重命名、移动、删除
 */
import { ref, computed } from 'vue'
import {
  store, api, openMap, createMap, createDir, openRawFile,
  renamePath, movePath, deletePath, uiPrompt, uiContextMenu, collectDirs, toast
} from '../store.js'

const props = defineProps({
  node: { type: Object, required: true },
  depth: { type: Number, default: 0 }
})

const expanded = ref(props.depth === 0)
const dropTarget = ref(false)

const isActive = () => store.tabs.some(t => t.path === props.node.path && t.id === store.activeId)
const parentDir = computed(() =>
  props.node.type === 'dir' ? props.node.path : props.node.path.slice(0, props.node.path.lastIndexOf('/'))
)

function onClick() {
  if (props.node.type === 'dir') {
    store.currentDir = props.node.path // 标记当前操作文件夹
    expanded.value = !expanded.value
  } else if (props.node.isMap) {
    openMap(props.node.path)
  } else {
    openRawFile(props.node.path)
  }
}

/* ---------- 新建（可用于当前目录 / 当前文件的同级目录） ---------- */
async function newMapIn(dir) {
  const name = await uiPrompt(`新建脑图（${nameOf(dir)}）`, '名称（将作为根节点与文件名）', '', '例如：产品规划', true)
  if (!name) return
  const abs = await createMap(dir, name)
  if (dir !== props.node.path) toast('已创建：' + abs.split('/').pop(), 'ok')
  if (props.node.type === 'dir') expanded.value = true
}
async function newFolderIn(dir) {
  const name = await uiPrompt(`新建文件夹（${nameOf(dir)}）`, '文件夹名称', '', '例如：项目资料', true)
  if (!name) return
  await createDir(dir, name)
  if (props.node.type === 'dir') expanded.value = true
}
function nameOf(dir) {
  const ws = store.workspace.replace(/\/+$/, '')
  return dir === ws ? '根目录' : dir.split('/').pop()
}

async function menuRename() {
  const name = await uiPrompt('重命名', '新名称', props.node.name, '', true)
  if (!name) return
  await renamePath(props.node.path, name)
}

async function menuMove() {
  const dirs = collectDirs().filter(d => {
    const selfRel = props.node.rel.slice(0, props.node.rel.lastIndexOf('/'))
    return d.rel !== selfRel && !props.node.rel.startsWith(d.rel + '/')
  })
  const choice = await uiPickDir(dirs)
  if (choice === null) return
  const destAbs = choice ? store.workspace.replace(/\/+$/, '') + '/' + choice : store.workspace
  await movePath(props.node.path, destAbs)
}

/* 轻量目录选择对话框 */
const pickState = ref(null)
function uiPickDir(dirs) {
  return new Promise(resolve => {
    pickState.value = { dirs, sel: null, resolve }
  })
}
function confirmPick() {
  const sel = pickState.value.sel
  pickState.value.resolve(sel === null ? null : (sel || ''))
  pickState.value = null
}

function menuItems() {
  const items = []
  const target = parentDir.value
  if (props.node.type === 'dir') {
    items.push(
      { label: '＋ 新建脑图', action: () => newMapIn(target) },
      { label: '＋ 新建文件夹', action: () => newFolderIn(target) }
    )
  } else {
    items.push({ label: props.node.isMap ? '打开脑图' : '用默认程序打开', action: onClick })
    items.push({ label: '＋ 新建同级脑图', action: () => newMapIn(target) })
    items.push({ label: '＋ 新建同级文件夹', action: () => newFolderIn(target) })
  }
  items.push(
    { label: '重命名', action: menuRename },
    { label: '移动到…', action: menuMove },
    { label: '在 Finder 中显示', action: () => api('os:openPath', props.node.path) },
    { label: '删除', danger: true, action: () => deletePath(props.node.path, props.node.name) }
  )
  return items
}

function onContextMenu(e) {
  uiContextMenu(e.clientX, e.clientY, menuItems())
}

/* ---------- 拖拽移动 ---------- */
function onDragStart(e) {
  e.dataTransfer.setData('text/cmind-path', props.node.path)
  e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(e) {
  if (props.node.type !== 'dir') return
  e.preventDefault()
  dropTarget.value = true
}
function onDragLeave() { dropTarget.value = false }
async function onDrop(e) {
  dropTarget.value = false
  if (props.node.type !== 'dir') return
  const src = e.dataTransfer.getData('text/cmind-path')
  if (!src || src === props.node.path) return
  if (props.node.path.startsWith(src + '/')) return
  try {
    await movePath(src, props.node.path)
    expanded.value = true
    toast('已移动到 ' + props.node.name, 'ok')
  } catch (err) {
    toast('移动失败：' + (err.message || err), 'error')
  }
}
</script>

<template>
  <div>
    <div
      class="tree-row"
      :class="{ active: isActive(), 'drop-target': dropTarget }"
      :style="{ paddingLeft: 8 + depth * 16 + 'px' }"
      draggable="true"
      @click="onClick"
      @contextmenu.prevent.stop="onContextMenu"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <span v-if="node.type === 'dir'" class="arrow" :class="{ open: expanded }">▶</span>
      <span v-else style="width:14px;flex:none"></span>
      <span class="ficon">{{ node.type === 'dir' ? (expanded ? '📂' : '📁') : (node.isMap ? '🧠' : '📄') }}</span>
      <span class="fname" :class="{ 'dirty-dot': node.isMap && store.tabs.some(t => t.path === node.path && t.dirty) }">
        {{ node.name }}
      </span>
    </div>
    <template v-if="node.type === 'dir' && expanded">
      <TreeNode v-for="c in node.children" :key="c.path" :node="c" :depth="depth + 1" />
    </template>

    <!-- 移动到… 目录选择 -->
    <div v-if="pickState" class="overlay" @click.self="pickState.resolve(null); pickState = null">
      <div class="modal">
        <div class="modal-head">移动「{{ node.name }}」到…</div>
        <div class="modal-body">
          <div class="map-list">
            <div
              v-for="d in pickState.dirs" :key="d.rel"
              class="item" :class="{ sel: pickState.sel === d.rel }"
              @click="pickState.sel = d.rel"
            >📁 {{ d.name }}</div>
          </div>
        </div>
        <div class="modal-foot">
          <button @click="pickState.resolve(null); pickState = null">取消</button>
          <button class="primary" @click="confirmPick">移动</button>
        </div>
      </div>
    </div>
  </div>
</template>
