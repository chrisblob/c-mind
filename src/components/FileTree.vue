<script setup>
/**
 * 侧栏文件树：文件/文件夹管理模式
 * 支持：新建脑图/文件夹、重命名、移动（拖拽或菜单）、删除、更换工作区、Git 入口
 */
import { computed, ref } from 'vue'
import TreeNode from './TreeNode.vue'
import { store, chooseWorkspace, createMap, createDir, uiPrompt } from '../store.js'

const wsName = computed(() => store.workspace.split('/').filter(Boolean).pop() || '未设置工作区')

async function onNewMap() {
  const name = await uiPrompt('新建脑图（根目录）', '名称', '未命名')
  if (name === null) return
  await createMap(store.workspace, name)
}
async function onNewFolder() {
  const name = await uiPrompt('新建文件夹（根目录）', '名称', '')
  if (!name) return
  await createDir(store.workspace, name)
}
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
      <span class="ws-name" :title="store.workspace">{{ wsName }}</span>
      <button class="icon-btn" title="更换工作区" @click="chooseWorkspace()">📂</button>
      <button
        class="icon-btn" title="Git 仓库管理"
        :class="{ 'btn-toggled': store.gitOpen }"
        @click="store.gitOpen = !store.gitOpen"
      >Git</button>
    </div>

    <div class="filetree">
      <div v-if="!store.tree.length" class="tree-empty">
        <div>工作区还是空的</div>
        <div>
          <button class="primary" @click="onNewMap">＋ 新建第一张脑图</button>
        </div>
      </div>
      <TreeNode v-for="n in store.tree" :key="n.path" :node="n" :depth="0" />
      <div v-if="store.tree.length" style="padding:10px 8px; display:flex; gap:6px">
        <button style="flex:1" @click="onNewMap">＋ 脑图</button>
        <button style="flex:1" @click="onNewFolder">＋ 文件夹</button>
      </div>
    </div>
  </aside>
</template>
