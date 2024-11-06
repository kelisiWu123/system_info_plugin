import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import '@icon-park/vue-next/styles/index.css'
import './assets/icon/iconfont.css'
import { Loading, Cpu, Monitor, Platform } from '@element-plus/icons-vue'

const app = createApp(App)

// 注册图标组件
app.component('Loading', Loading)
app.component('Cpu', Cpu)
app.component('Monitor', Monitor)
app.component('Platform', Platform)

app.mount('#app')
