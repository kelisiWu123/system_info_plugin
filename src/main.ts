import { createApp } from 'vue'
import './style.css'
import Router from './router/index';
import App from './App.vue'
import "@icon-park/vue-next/styles/index.css";

const app = createApp(App)
app.use(Router).mount('#app')
