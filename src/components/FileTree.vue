<script setup>
/**
 * 侧栏文件树：文件/文件夹管理模式
 * 支持：新建脑图/文件夹、重命名、移动（拖拽或菜单）、删除、更换工作区、Git 入口
 */
import { computed } from 'vue'
import TreeNode from './TreeNode.vue'
import { store, chooseWorkspace, createMap, createDir, doImport, reorderSibling, movePath, uiPrompt, dirLabel } from '../store.js'

const wsName = computed(() => store.workspace.split('/').filter(Boolean).pop() || '未设置工作区')

const targetDir = () => store.currentDir || store.workspace

async function onNewMap() {
  const name = await uiPrompt(`新建脑图（${dirLabel(targetDir())}）`, '名称（将作为根节点与文件名）', '', '例如：产品规划', true)
  if (!name) return
  await createMap(targetDir(), name)
}
async function onNewFolder() {
  const name = await uiPrompt(`新建文件夹（${dirLabel(targetDir())}）`, '文件夹名称', '', '例如：项目资料', true)
  if (!name) return
  await createDir(targetDir(), name)
}
window.__cmindImport = doImport // 自检钩子
window.__cmindReorder = reorderSibling
window.__cmindMove = movePath
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <svg class="app-logo" viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#4c6ef5"/><stop offset="1" stop-color="#22b8cf"/>
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="11" fill="url(#lg)"/>
        <circle cx="20" cy="24" r="5.5" fill="#fff"/>
        <path d="M26 21 L36 13" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
        <circle cx="38" cy="12" r="3" fill="#fff"/>
        <path d="M26 24 L37 24" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
        <circle cx="39" cy="24" r="3" fill="#fff"/>
        <path d="M26 27 L36 35" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
        <circle cx="38" cy="36" r="3" fill="#fff"/>
      </svg>
      <span class="ws-name" :data-tip="store.workspace">{{ wsName }}</span>
      <button class="icon-btn" data-tip="更换工作区" @click="chooseWorkspace()">📂</button>
      <button
        class="icon-btn" data-tip="Git 仓库管理"
        :class="{ 'btn-toggled': store.gitOpen }"
        @click="store.gitOpen = !store.gitOpen"
      >Git</button>
    </div>

    <div class="filetree">
      <!-- 文件区标题行：新建操作固定在顶部，树很长也不会被滚走 -->
      <div class="tree-toolbar">
        <span class="tree-title">文件</span>
        <span class="flex-1"></span>
        <button class="mini-btn" data-tip="新建脑图（在当前目录）" data-key="⌘N" @click="onNewMap">🧠＋</button>
        <button class="mini-btn" data-tip="新建文件夹（在当前目录）" @click="onNewFolder">📁＋</button>
        <button class="mini-btn" data-tip="导入（XMind / FreeMind / OPML / Markdown / JSON）" @click="doImport">📥</button>
      </div>
      <div class="tree-hint" :data-tip="'新建位置：' + dirLabel(store.currentDir)">
        <span class="hint-label">新建于</span>
        <span class="hint-dir">{{ dirLabel(store.currentDir) }}</span>
      </div>
      <div v-if="!store.tree.length" class="tree-empty">
        <div>工作区还是空的</div>
        <div style="display:flex; flex-direction:column; gap:6px; align-items:stretch">
          <button class="primary" @click="onNewMap">＋ 新建脑图</button>
          <button @click="onNewFolder">＋ 新建文件夹</button>
        </div>
      </div>
      <TreeNode v-for="n in store.tree" :key="n.path" :node="n" :depth="0" />
    </div>
  </aside>
</template>
