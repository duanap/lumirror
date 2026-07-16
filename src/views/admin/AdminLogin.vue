<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { api } from '../../lib/api'
import { storeUser } from '../../lib/auth'

const router = useRouter()
const loading = ref(false)
const form = reactive({ username:'', password:'' })

async function login() {
  if (!form.username.trim() || !form.password) return ElMessage.warning('请输入账号和密码')
  loading.value = true
  try {
    const result = await api.post('/admin/login',form)
    if (result.user) {
      localStorage.removeItem('admin_token')
      storeUser(result.user)
      router.replace(result.user.mustChangePassword ? '/admin/settings' : '/admin/dashboard')
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '登录失败')
  } finally { loading.value = false }
}
</script>

<template>
  <main class="login-page">
    <section class="login-card">
      <div class="brand-lock">L</div>
      <span class="eyebrow">Lumirror Admin</span>
      <h1>和光镜鉴</h1>
      <p>匿名反馈 · 公平成长</p>
      <el-form size="large" @submit.prevent="login">
        <el-form-item><el-input v-model="form.username" :prefix-icon="User" placeholder="后台账号" autocomplete="username"/></el-form-item>
        <el-form-item><el-input v-model="form.password" :prefix-icon="Lock" type="password" show-password placeholder="登录密码" autocomplete="current-password"/></el-form-item>
        <el-button type="primary" native-type="submit" :loading="loading">登录后台</el-button>
      </el-form>
      <small>首次登录后请立即修改默认密码，并妥善保管管理员账号。</small>
    </section>
  </main>
</template>

<style scoped>
.login-page{display:grid;place-items:center;min-height:100vh;padding:24px;background:linear-gradient(145deg,#f4eee8,#fffaf5 48%,#f3eee8)}.login-card{width:min(430px,100%);padding:42px 42px 34px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.96);box-shadow:var(--shadow);text-align:center}.brand-lock{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 16px;border-radius:16px;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand-2));box-shadow:0 14px 28px rgba(233,91,44,.2);font-size:25px;font-weight:850}.eyebrow{color:var(--brand-dark);font-size:12px;font-weight:800;text-transform:uppercase}h1{margin:7px 0 4px;color:var(--ink);font-size:27px}p{margin:0 0 28px;color:var(--muted)}.el-button{width:100%;height:48px;font-size:16px;font-weight:760}small{display:block;margin-top:22px;color:var(--subtle);line-height:1.7}@media(max-width:480px){.login-page{padding:16px}.login-card{padding:34px 22px 28px}}
</style>
