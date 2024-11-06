import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import '@icon-park/vue-next/styles/index.css'
import './assets/icon/iconfont.css'
import { Loading } from '@element-plus/icons-vue'

const app = createApp(App)

// 只保留 Loading 图标用于加载状态
app.component('Loading', Loading)

app.mount('#app')
