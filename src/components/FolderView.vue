<script setup>
/**
 * 文件夹视图：点击左侧文件夹时，右侧展示该文件夹下的文件与文件夹。
 * 支持列表 / 平铺两种展示；点击子文件夹原地进入，点击脑图打开新标签。
 * 排序与左侧文件树一致（名称排序 + 拖拽自定义顺序）。
 */
import { ref, computed } from 'vue'
import { store, openMap, openRawFile, dirLabel } from '../store.js'

const props = defineProps({
  tab: { type: Object, required: true }
})

const viewMode = ref(localStorage.getItem('cmind-dir-view') || 'list')
function setMode(m) {
  viewMode.value = m
  localStorage.setItem('cmind-dir-view', m)
}

function findNode(path, list = store.tree) {
  for (const n of list) {
    if (n.path === path) return n
    if (n.children) {
      const r = findNode(path, n.children)
      if (r) return r
    }
  }
  return null
}

const node = computed(() => findNode(props.tab.path))
const items = computed(() => (node.value && node.value.children) || [])

function navigate(n) {
  if (n.type === 'dir') {
    // 原地进入子文件夹（同一标签内导航）
    props.tab.path = n.path
    props.tab.rel = n.rel
    props.tab.name = n.name
    store.currentDir = n.path
  } else if (n.isMap) {
    openMap(n.path)
  } else {
    openRawFile(n.path)
  }
}

function iconOf(n) {
  return n.type === 'dir' ? '📁' : (n.isMap ? '🧠' : '📄')
}
function typeLabel(n) {
  return n.type === 'dir' ? '文件夹' : (n.isMap ? '脑图' : '文件')
}
</script>

<template>
  <div class="folder-view">
    <div class="fv-head">
      <div class="fv-title">📁 {{ tab.name }}</div>
      <div class="fv-sub">{{ dirLabel(tab.path) }} · {{ items.length }} 项</div>
      <div style="flex:1"></div>
      <div class="fv-modes">
        <button class="mini-btn" :class="{ 'btn-toggled': viewMode === 'list' }" data-view="list" data-tip="列表" @click="setMode('list')">☰ 列表</button>
        <button class="mini-btn" :class="{ 'btn-toggled': viewMode === 'grid' }" data-view="grid" data-tip="平铺" @click="setMode('grid')">▦ 平铺</button>
      </div>
    </div>

    <div v-if="!items.length" class="fv-empty">这个文件夹还是空的</div>

    <div v-else-if="viewMode === 'list'" class="fv-list">
      <div
        v-for="n in items" :key="n.path"
        class="fv-row folder-item"
        @click="navigate(n)"
      >
        <span class="fv-icon">{{ iconOf(n) }}</span>
        <span class="fv-name">{{ n.name }}</span>
        <span class="fv-type">{{ typeLabel(n) }}</span>
      </div>
    </div>

    <div v-else class="fv-grid-wrap">
      <div
        v-for="n in items" :key="n.path"
        class="fv-tile folder-item"
        @click="navigate(n)"
      >
        <div class="fv-tile-icon">{{ iconOf(n) }}</div>
        <div class="fv-tile-name">{{ n.name }}</div>
        <div class="fv-tile-type">{{ typeLabel(n) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.folder-view { display: flex; flex-direction: column; height: 100%; padding: 14px 18px; overflow: auto; }
.fv-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.fv-title { font-size: 16px; font-weight: 600; color: var(--text); }
.fv-sub { font-size: 12px; color: var(--text-dim); }
.fv-modes { display: flex; gap: 6px; }
.fv-empty { margin-top: 40px; text-align: center; color: var(--text-dim); }
.fv-list { display: flex; flex-direction: column; gap: 2px; }
.fv-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.fv-row:hover { background: var(--bg-hover, rgba(0,0,0,.05)); }
.fv-icon { width: 22px; text-align: center; }
.fv-name { flex: 1; color: var(--text); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fv-type { font-size: 11px; color: var(--text-dim); }
.fv-grid-wrap { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
.fv-tile { display: flex; flex-direction: column; align-items: center; padding: 14px 8px; border-radius: 12px; cursor: pointer; border: 1px solid var(--border, rgba(0,0,0,.08)); }
.fv-tile:hover { background: var(--bg-hover, rgba(0,0,0,.05)); }
.fv-tile-icon { font-size: 30px; margin-bottom: 8px; }
.fv-tile-name { font-size: 12px; color: var(--text); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fv-tile-type { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
</style>
