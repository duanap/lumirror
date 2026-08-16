<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  DataAnalysis, User, OfficeBuilding, Grid, Calendar, Tickets, Key, List,
  TrendCharts, Setting, UploadFilled, Fold, Expand, ArrowDown, Collection,
  UserFilled, Close, Sunny, Moon
} from '@element-plus/icons-vue'
import { api, unwrap } from '../lib/api'
import { can, clearAuth, getStoredUser, storeUser } from '../lib/auth'
import type { BackendUser } from '../types'
import { adminThemeLabel, adminThemeMode, resolvedAdminTheme, setAdminThemeMode, type AdminThemeMode } from '../lib/admin-theme'

const route = useRoute()
const router = useRouter()
const collapsed = ref(false)
const mobileOpen = ref(false)
const user = ref<BackendUser | null>(getStoredUser())
const title = computed(() => String(route.meta.title || '管理后台'))

const allGroups: any[] = [
  {
    label: '数据中心', icon: DataAnalysis,
    items: [
      { path: '/admin/dashboard', label: '数据概览', icon: DataAnalysis, permission: 'dashboard:view' },
      { path: '/admin/results', label: '评分结果', icon: TrendCharts, permission: 'results:view', hideForMember: true }
    ]
  },
  {
    label: '人员与组织', icon: User,
    items: [
      { path: '/admin/employees', label: '成员管理', icon: User, permission: 'employees:view' },
      { path: '/admin/departments', label: '部门管理', icon: OfficeBuilding, adminOnly: true },
      { path: '/admin/teams', label: '团队管理', icon: Grid, permission: 'employees:view' },
      { path: '/admin/users', label: '账号与权限', icon: UserFilled, adminOnly: true }
    ]
  },
  {
    label: '评价管理', icon: Collection,
    items: [
      { path: '/admin/evaluation-codes', label: '评价活动', icon: Tickets, permission: 'activities:view' },
      { path: '/admin/verify-codes', label: '邀请码', icon: Key, permission: 'verify:view' },
      { path: '/admin/tasks', label: '评价任务', icon: List, permission: 'tasks:view' },
      { path: '/admin/periods', label: '评价周期', icon: Calendar, permission: 'periods:view' }
    ]
  },
  {
    label: '系统管理', icon: Setting,
    items: [
      { path: '/admin/settings/score-rules', label: '评分计算规则', icon: Setting, roles: ['admin','team_leader'] },
      { path: '/admin/import-export', label: '导入与导出', icon: UploadFilled, adminOnly: true },
      { path: '/admin/settings', label: '基础与安全设置', icon: Setting, permission: 'settings:password' }
    ]
  }
]

const groups = computed(() => allGroups.map((group) => ({
  ...group,
  items: group.items.filter((item: any) => {
    if (!user.value) return false
    if (item.adminOnly && user.value.role !== 'admin') return false
    if (item.hideForMember && user.value.role === 'member') return false
    if (item.roles && !item.roles.includes(user.value.role)) return false
    return !item.permission || can(user.value,item.permission)
  })
})).filter((group) => group.items.length))

async function loadMe() {
  try {
    user.value = unwrap(await api.get<BackendUser>('/admin/me'))
    storeUser(user.value)
    if (user.value.mustChangePassword && route.path !== '/admin/settings') router.replace('/admin/settings')
  } catch {
    logout(false)
  }
}
async function logout(callServer = true) {
  if (callServer) {
    try { await api.post('/admin/logout') } catch {}
  }
  clearAuth()
  router.replace('/admin/login')
}
function closeMobile() { mobileOpen.value = false }
function changeTheme(command:string) { setAdminThemeMode(command as AdminThemeMode) }
onMounted(loadMe)
watch(() => route.path, (path) => {
  if (user.value?.mustChangePassword && path !== '/admin/settings') router.replace('/admin/settings')
})
</script>

<template>
  <div class="admin-shell" :class="{ collapsed, 'mobile-open': mobileOpen }">
    <div class="mobile-mask" @click="closeMobile" />
    <aside>
      <div class="brand">
        <span class="brand-mark">L</span>
        <div v-if="!collapsed" class="brand-copy">
          <strong>和光镜鉴</strong>
          <small>Lumirror</small>
        </div>
        <button class="mobile-close" aria-label="关闭菜单" @click="closeMobile"><Close /></button>
      </div>
      <nav>
        <section v-for="group in groups" :key="group.label" class="nav-group">
          <div class="nav-parent"><component :is="group.icon"/><span>{{ group.label }}</span></div>
          <router-link v-for="item in group.items" :key="item.path" :to="item.path" @click="closeMobile">
            <component :is="item.icon"/><span>{{ item.label }}</span>
          </router-link>
        </section>
      </nav>
    </aside>
    <section class="admin-main">
      <header>
        <button class="collapse desktop-toggle" aria-label="切换侧边栏" @click="collapsed = !collapsed"><component :is="collapsed ? Expand : Fold"/></button>
        <button class="collapse mobile-toggle" aria-label="打开菜单" @click="mobileOpen = true"><Expand /></button>
        <span class="breadcrumb">管理后台 / {{ title }}</span>
        <el-dropdown class="theme-menu" trigger="click" @command="changeTheme">
          <button class="theme-toggle" :aria-label="`主题设置，当前${adminThemeLabel}`" :title="`主题：${adminThemeLabel}`"><component :is="resolvedAdminTheme==='dark'?Moon:Sunny"/></button>
          <template #dropdown><el-dropdown-menu><el-dropdown-item command="auto" :disabled="adminThemeMode==='auto'">自动（19:00–08:00）</el-dropdown-item><el-dropdown-item command="light" :disabled="adminThemeMode==='light'">浅色模式</el-dropdown-item><el-dropdown-item command="dark" :disabled="adminThemeMode==='dark'">深色模式</el-dropdown-item></el-dropdown-menu></template>
        </el-dropdown>
        <el-dropdown class="user-menu">
          <span class="admin-user">
            <span class="avatar">{{ (user?.displayName || user?.username || 'U').slice(0,1).toUpperCase() }}</span>
            <span class="user-copy"><b>{{ user?.displayName || '后台用户' }}</b><small>{{ user?.roleLabel }}</small></span>
            <ArrowDown/>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="router.push('/admin/settings')">账号设置</el-dropdown-item>
              <el-dropdown-item divided @click="logout()">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>
      <main><router-view /></main>
    </section>
  </div>
</template>

<style scoped>
.admin-shell{display:grid;grid-template-columns:264px minmax(0,1fr);min-height:100vh;background:var(--admin-bg);transition:grid-template-columns .2s ease,background .2s ease}.admin-shell.collapsed{grid-template-columns:82px minmax(0,1fr)}aside{position:sticky;top:0;z-index:20;height:100vh;overflow:auto;border-right:1px solid var(--line);background:var(--admin-sidebar);backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:12px;height:74px;padding:0 20px;border-bottom:1px solid var(--line);color:var(--brand)}.brand-mark{display:grid;place-items:center;flex:0 0 auto;width:36px;height:36px;border-radius:10px;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand-2));font-weight:800}.brand-copy{display:grid;line-height:1.15}.brand-copy strong{color:var(--ink);font-size:17px}.brand-copy small{margin-top:3px;color:var(--muted);font-size:11px}nav{padding:12px 10px 22px}.nav-group{padding:8px 0}.nav-parent{display:flex;align-items:center;gap:10px;height:32px;padding:0 12px;color:var(--subtle);font-size:12px;font-weight:760;white-space:nowrap}.nav-parent svg{width:15px;height:15px}.nav-group a{display:flex;align-items:center;gap:12px;height:42px;margin:2px 0;padding:0 13px;border-radius:10px;color:var(--text);white-space:nowrap;transition:background .15s,color .15s,transform .15s}.nav-group a svg{width:18px;height:18px}.nav-group a:hover{color:var(--brand);background:var(--admin-hover)}.router-link-active{color:var(--brand)!important;background:var(--admin-active);box-shadow:inset 3px 0 0 var(--brand)}.collapsed nav span,.collapsed .brand-copy{display:none}.collapsed .brand{justify-content:center;padding:0}.collapsed .nav-group a,.collapsed .nav-parent{justify-content:center;padding:0}.admin-main{min-width:0}header{position:sticky;top:0;z-index:10;display:flex;align-items:center;height:74px;padding:0 30px;border-bottom:1px solid var(--line);background:var(--admin-header);backdrop-filter:blur(14px)}.collapse,.theme-toggle{display:grid;place-items:center;width:38px;height:38px;border:1px solid var(--line);border-radius:10px;background:var(--surface);cursor:pointer}.collapse{margin-right:18px}.collapse:hover,.theme-toggle:hover{color:var(--brand);box-shadow:var(--focus)}.collapse svg,.theme-toggle svg{width:19px;height:19px}.breadcrumb{color:var(--muted);font-size:14px;font-weight:650}.theme-menu{display:flex;margin-left:auto;margin-right:12px}.user-menu{display:flex}.admin-user{display:flex;align-items:center;gap:10px;cursor:pointer}.admin-user>svg{width:14px;height:14px}.avatar{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;color:#fff;background:var(--admin-avatar);font-weight:760}.user-copy{display:grid;text-align:right}.user-copy b{color:var(--ink);font-size:14px}.user-copy small{margin-top:2px;color:var(--muted);font-size:11px}main{width:min(100%,var(--content-max));margin:0 auto;padding:28px 34px 44px}.mobile-toggle,.mobile-close,.mobile-mask{display:none}
@media(max-width:960px){.admin-shell,.admin-shell.collapsed{display:block}.admin-shell aside{position:fixed;left:0;top:0;width:286px;transform:translateX(-102%);box-shadow:var(--shadow);transition:transform .22s ease}.admin-shell.mobile-open aside{transform:translateX(0)}.admin-shell aside span{display:inline}.admin-shell .nav-group a,.admin-shell .nav-parent{justify-content:flex-start;padding:0 14px}.mobile-mask{position:fixed;inset:0;z-index:15;background:var(--admin-mask)}.mobile-open .mobile-mask{display:block}.desktop-toggle{display:none}.mobile-toggle,.mobile-close{display:grid}.mobile-close{place-items:center;width:34px;height:34px;margin-left:auto;border:1px solid var(--line);border-radius:10px;color:var(--brand);background:var(--surface)}.mobile-close svg{width:18px}.breadcrumb{display:none}header{height:66px;padding:0 16px}.user-copy small{display:none}main{padding:20px 14px 36px}}
</style>
