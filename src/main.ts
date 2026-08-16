import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/tokens.css'
import './styles/global.css'
import App from './App.vue'
import router from './router'
import { initializeAdminTheme } from './lib/admin-theme'

initializeAdminTheme(router)
createApp(App).use(router).use(ElementPlus).mount('#app')
