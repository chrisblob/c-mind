import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { store } from './store.js'
import './uitest.js'
import { installTooltip } from './tooltip.js'

installTooltip()

// 开发者工具 / 自动化测试入口
window.__cmindStore = store

const app = createApp(App)
// 输入框自动聚焦（对话框用）
app.directive('focus', {
  mounted: (el) => setTimeout(() => el.focus(), 30)
})
app.mount('#app')
