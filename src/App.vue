<script setup>
/**
 * C-Mind 应用外壳：布局、全局快捷键、链接路由、通用弹层
 */
import { onMounted, onBeforeUnmount } from 'vue'
import TabBar from './components/TabBar.vue'
import FileTree from './components/FileTree.vue'
import GitPanel from './components/GitPanel.vue'
import MindMapEditor from './components/MindMapEditor.vue'
import {
  store, api, initStore, chooseWorkspace, handleCmindLink, closeContextMenu,
  activeTab, createMap, closeTab, uiPrompt, toast
} from './store.js'

/* 让脚本/插件里 window.open 的调用也走统一分流：
   cmind:// → 应用内新标签；http(s) → 系统浏览器 */
function patchWindowOpen() {
  window.open = (url) => {
    if (!url) return null
    if (url.startsWith('cmind://')) handleCmindLink(url)
    else api('os:openExternal', url).catch(() => {})
    return null
  }
}

async function createMapPrompt() {
  const name = await uiPrompt('新建脑图', '名称（将作为根节点与文件名）', '', '例如：产品规划', true)
  if (name === null) return
  await createMap(store.workspace, name)
}

/* 弹框确定：必填项校验 */
function submitPrompt() {
  const p = store.prompt
  if (!p) return
  const v = String(p.value || '').trim()
  if (p.required && !v) {
    toast('请输入名称', 'error')
    return
  }
  p.resolve(v)
}
function cancelPrompt() {
  store.prompt && store.prompt.resolve(null)
}

/* 全局快捷键：Cmd+S 保存 / Cmd+N 新建脑图 / Cmd+W 关闭标签 */
function onKeydown(e) {
  if (e.key === 'Escape') {
    if (store.prompt) { cancelPrompt(); return }
    if (store.confirmBox) { store.confirmBox.resolve(false); return }
    if (store.contextMenu) { closeContextMenu(); return }
  }
  if (!(e.metaKey || e.ctrlKey)) return
  const key = e.key.toLowerCase()
  if (key === 's') {
    e.preventDefault()
    if (typeof store.requestSave === 'function') store.requestSave()
  } else if (key === 'n') {
    e.preventDefault()
    createMapPrompt()
  } else if (key === 'w') {
    e.preventDefault()
    const t = activeTab()
    if (t) closeTab(t.id)
  }
}

onMounted(async () => {
  patchWindowOpen()
  // <a target=_blank> 等触发的窗口请求由主进程转发到这里
  window.cmind.onOpenLink((url) => handleCmindLink(url))
  window.addEventListener('keydown', onKeydown)
  await initStore()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="app-shell" @click="closeContextMenu()" @contextmenu="closeContextMenu()">
    <FileTree />
    <div class="main">
      <TabBar />
      <MindMapEditor v-if="activeTab()" :key="activeTab().id" :tab="activeTab()" />
      <div v-else class="empty-state">
        <div class="big">🧠</div>
        <div>在左侧点击打开脑图，或按 <kbd>⌘N</kbd> / 点击标签栏的 <b>＋</b> 新建</div>
        <div class="hint">Tab 添加子节点 · Enter 添加同级节点 · 双击编辑文字</div>
      </div>
    </div>

    <GitPanel v-if="store.gitOpen" />

    <!-- 首次使用：选择工作区 -->
    <div v-if="store.needWorkspace" class="overlay">
      <div class="modal">
        <div class="modal-head">欢迎使用 C-Mind 心图 👋</div>
        <div class="modal-body">
          <p class="hint" style="margin-bottom:12px">
            C-Mind 把脑图以 <b>.cmind</b> 文件保存在你电脑的一个「工作区文件夹」里，
            文件夹结构就是脑图库的结构，可以随时绑定 GitHub 仓库同步。
          </p>
          <button class="primary" @click="chooseWorkspace()">选择 / 新建工作区文件夹</button>
        </div>
      </div>
    </div>

    <!-- 输入对话框 -->
    <div v-if="store.prompt" class="overlay" @click.self="cancelPrompt()">
      <div class="modal">
        <div class="modal-head">{{ store.prompt.title }}</div>
        <div class="modal-body">
          <div class="form-row">
            <label>{{ store.prompt.label }}<span v-if="store.prompt.required" style="color:var(--danger)"> *</span></label>
            <input
              type="text" v-model="store.prompt.value" :placeholder="store.prompt.placeholder"
              v-focus
              @keydown.enter="submitPrompt"
            />
          </div>
        </div>
        <div class="modal-foot">
          <button @click="cancelPrompt()">取消</button>
          <button class="primary" @click="submitPrompt">确定</button>
        </div>
      </div>
    </div>

    <!-- 确认对话框 -->
    <div v-if="store.confirmBox" class="overlay" @click.self="store.confirmBox.resolve(false)">
      <div class="modal">
        <div class="modal-head">{{ store.confirmBox.title }}</div>
        <div class="modal-body"><p style="line-height:1.7">{{ store.confirmBox.message }}</p></div>
        <div class="modal-foot">
          <button @click="store.confirmBox.resolve(false)">取消</button>
          <button :class="store.confirmBox.danger ? 'danger' : 'primary'" @click="store.confirmBox.resolve(true)">
            {{ store.confirmBox.danger ? '删除' : '确定' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="store.contextMenu" class="context-menu"
      :style="{ left: store.contextMenu.x + 'px', top: store.contextMenu.y + 'px' }"
      @click.stop
    >
      <div
        v-for="(item, i) in store.contextMenu.items" :key="i"
        class="mi" :class="{ danger: item.danger }"
        @click.stop="closeContextMenu(); item.action()"
      >{{ item.label }}</div>
    </div>

    <!-- toast -->
    <div class="toasts">
      <div v-for="t in store.toasts" :key="t.id" class="toast" :class="t.type">{{ t.text }}</div>
    </div>
  </div>
</template>
