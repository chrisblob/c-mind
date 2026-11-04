import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'

const app = createApp(App)
// 输入框自动聚焦（对话框用）
app.directive('focus', {
  mounted: (el) => setTimeout(() => el.focus(), 30)
})
app.mount('#app')
