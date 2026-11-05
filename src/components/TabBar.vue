<script setup>
/**
 * 标签栏：查看模式的核心 —— 每张打开的脑图一个标签，
 * 点击节点里的 cmind:// 脑图链接会在这里新开标签页
 */
import { store, activeTab, closeTab, createMap, uiPrompt } from '../store.js'

async function onAdd() {
  const name = await uiPrompt('新建脑图', '名称（将作为根节点与文件名）', '', '例如：产品规划', true)
  if (!name) return
  await createMap(store.workspace, name)
}
</script>

<template>
  <div class="tabbar">
    <div
      v-for="t in store.tabs" :key="t.id"
      class="tab" :class="{ active: t.id === store.activeId }"
      @click="store.activeId = t.id"
      @click.middle="closeTab(t.id)"
      :data-tip="t.rel"
    >
      <span class="tname">{{ t.type === 'dir' ? '📁 ' : '' }}{{ t.name }}</span>
      <span v-if="t.dirty" class="dot">•</span>
      <span class="close" @click.stop="closeTab(t.id)">✕</span>
    </div>
    <button class="icon-btn tab-add" data-tip="新建脑图" data-key="⌘N" @click="onAdd">＋</button>
    <div style="flex:1"></div>
    <div v-if="activeTab()" class="tabbar-rel" :title="activeTab().rel">
      {{ activeTab().rel }}
    </div>
  </div>
</template>
