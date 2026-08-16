import { createRouter, createWebHistory } from 'vue-router'
import Home from './views/public/Home.vue'
import PublicEntry from './views/public/PublicEntry.vue'
import Evaluate from './views/public/Evaluate.vue'
import Success from './views/public/Success.vue'
const AdminLogin = () => import('./views/admin/AdminLogin.vue')
const AdminLayout = () => import('./layouts/AdminLayout.vue')
const Dashboard = () => import('./views/admin/Dashboard.vue')
const Employees = () => import('./views/admin/Employees.vue')
const Users = () => import('./views/admin/Users.vue')
const Organization = () => import('./views/admin/Organization.vue')
const Periods = () => import('./views/admin/Periods.vue')
const EvaluationCodes = () => import('./views/admin/EvaluationCodes.vue')
const VerifyCodes = () => import('./views/admin/VerifyCodes.vue')
const Tasks = () => import('./views/admin/Tasks.vue')
const Results = () => import('./views/admin/Results.vue')
const ImportExport = () => import('./views/admin/ImportExport.vue')
const ScoreRules = () => import('./views/admin/ScoreRules.vue')
const Settings = () => import('./views/admin/Settings.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/i/:linkCode', component: PublicEntry },
    { path: '/t/:timedLinkCode', component: PublicEntry },
    { path: '/evaluate', component: Evaluate },
    { path: '/success', component: Success },
    { path: '/admin/login', component: AdminLogin },
    {
      path: '/admin', component: AdminLayout, meta: { admin: true }, children: [
        { path: '', redirect: '/admin/dashboard' },
        { path: 'dashboard', component: Dashboard, meta: { title: '数据概览' } },
        { path: 'employees', component: Employees, meta: { title: '成员管理' } },
        { path: 'users', component: Users, meta: { title: '账号与权限' } },
        { path: 'departments', component: Organization, meta: { title: '部门管理', kind: 'departments' } },
        { path: 'teams', component: Organization, meta: { title: '团队管理', kind: 'teams' } },
        { path: 'periods', component: Periods, meta: { title: '评价周期' } },
        { path: 'evaluation-codes', component: EvaluationCodes, meta: { title: '评价活动' } },
        { path: 'verify-codes', component: VerifyCodes, meta: { title: '邀请码' } },
        { path: 'tasks', component: Tasks, meta: { title: '评价任务' } },
        { path: 'results', component: Results, meta: { title: '评分结果' } },
        { path: 'import-export', component: ImportExport, meta: { title: '导入与导出' } },
        { path: 'settings/score-rules', component: ScoreRules, meta: { title: '评分计算规则' } },
        { path: 'settings', component: Settings, meta: { title: '系统设置' } }
      ]
    },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

export default router
