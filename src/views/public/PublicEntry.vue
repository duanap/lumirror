<script setup lang="ts">
import { computed, reactive, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Lock, ArrowRight, Link, Timer } from '@element-plus/icons-vue'
import PublicShell from '../../layouts/PublicShell.vue'
import { api } from '../../lib/api'

const router = useRouter()
const route = useRoute()
const form = reactive({ evaluationCode: '', verifyCode: '' })
const loading = ref(false)
const openedTimedCode = ref('')
const linkCode = computed(() => String(route.params.linkCode || '').trim())
const timedLinkCode = computed(() => String(route.params.timedLinkCode || '').trim())
const hasInviteLink = computed(() => /^\d{8}$/.test(linkCode.value))
const hasTimedLink = computed(() => /^\d{8}$/.test(timedLinkCode.value))

watchEffect(() => {
  if (hasInviteLink.value) form.evaluationCode = linkCode.value
  if (hasTimedLink.value && openedTimedCode.value !== timedLinkCode.value) void enterTimed()
})

function storeSession(result:any) {
  if (result.token) sessionStorage.setItem('public_token', result.token)
  sessionStorage.setItem('evaluation_summary', JSON.stringify({ evaluation: result.evaluation, remaining: result.remaining, timed: result.timed, expiresAt: result.expiresAt }))
}

async function enter() {
  if (!hasInviteLink.value) return ElMessage.warning('请通过邀请链接进入评价')
  if (!/^\d{6}$/.test(form.verifyCode.trim())) return ElMessage.warning('请输入 6 位数字邀请码')
  loading.value = true
  try {
    const result = await api.post('/public/verify-entry', form)
    storeSession(result)
    await router.push('/evaluate')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '校验失败')
  } finally { loading.value = false }
}

async function enterTimed() {
  openedTimedCode.value = timedLinkCode.value
  loading.value = true
  try {
    const result = await api.post('/public/timed-entry',{ linkCode:timedLinkCode.value })
    storeSession(result)
    await router.push('/evaluate')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '评价不存在或已结束')
    setTimeout(() => router.replace('/'), 1200)
  } finally { loading.value = false }
}
</script>

<template>
  <PublicShell>
    <template #title>和光镜鉴</template>
    <div class="entry-card">
      <div class="entry-icon"><el-icon :size="30"><Lock /></el-icon></div>
      <span class="eyebrow">匿名评价入口</span>
      <h2>{{ hasTimedLink ? '正在打开时效评价' : '进入团队评价' }}</h2>
      <p v-if="hasTimedLink">链接打开后开始 5 分钟倒计时，请在倒计时内完成全部评价。</p>
      <p v-else-if="hasInviteLink">请输入管理员分发的 6 位数字邀请码，校验通过后即可开始评价。</p>
      <p v-else>评价活动只能通过邀请链接加邀请码，或一次性的时效链接打开。</p>

      <form v-if="hasInviteLink" @submit.prevent="enter">
        <div class="link-panel">
          <el-icon :size="18"><Link /></el-icon>
          <span>邀请链接</span>
          <b>{{ linkCode }}</b>
        </div>
        <label>邀请码</label>
        <div class="field">
          <el-icon :size="20"><Lock /></el-icon>
          <input v-model.trim="form.verifyCode" maxlength="6" inputmode="numeric" type="password" autocomplete="one-time-code" placeholder="请输入 6 位数字" />
        </div>
        <small>邀请码仅用于确认评价资格，提交后不可重复使用，也不会展示个人评分结果。</small>
        <button class="enter-btn" :disabled="loading">
          <span>{{ loading ? '正在校验...' : '开始评价' }}</span>
          <el-icon :size="20"><ArrowRight /></el-icon>
        </button>
      </form>

      <div v-else-if="hasTimedLink" class="state-copy">
        <el-icon :size="22"><Timer /></el-icon>
        <span>正在校验时效链接...</span>
      </div>
      <div v-else class="state-copy">
        <el-icon :size="22"><Link /></el-icon>
        <span>请使用管理员分发的专属链接进入。</span>
      </div>
      <div class="privacy">全程匿名汇总，后台仅统计整体结果，不向被评价人展示单次评分。</div>
    </div>
    <a class="admin-link" href="/admin/login">管理员入口</a>
  </PublicShell>
</template>

<style scoped>
.entry-card{position:relative;max-width:560px;margin:22px auto 0;padding:44px 48px 34px;border:1px solid rgba(232,91,44,.16);border-radius:18px;background:rgba(255,255,255,.96);box-shadow:var(--shadow);text-align:center}.entry-icon{display:grid;place-items:center;width:62px;height:62px;margin:0 auto 18px;border-radius:16px;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand-2));box-shadow:0 14px 28px rgba(233,91,44,.2)}.eyebrow{display:inline-block;margin-bottom:8px;color:var(--brand-dark);font-size:13px;font-weight:760}h2{margin:0;color:var(--ink);font-size:28px;line-height:1.2}p{margin:11px 0 28px;color:var(--muted);font-size:15px;line-height:1.8}form{text-align:left}label{display:block;margin:18px 0 9px;color:var(--ink);font-weight:700}.link-panel{display:grid;grid-template-columns:20px 1fr auto;align-items:center;gap:8px;padding:13px 15px;border:1px solid var(--line);border-radius:12px;background:var(--surface-soft)}.link-panel span{color:var(--muted);font-size:13px}.link-panel b{color:var(--brand);letter-spacing:.08em}.field{display:flex;align-items:center;gap:12px;height:54px;padding:0 15px;border:1.5px solid #efb08c;border-radius:12px;color:var(--brand);background:#fff;transition:.2s}.field:focus-within{border-color:var(--brand);box-shadow:var(--focus)}input{width:100%;border:0;outline:0;color:var(--text);background:transparent;font-size:16px}small{display:block;margin:8px 2px 0;color:var(--subtle);line-height:1.6}.enter-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:56px;margin-top:28px;border:0;border-radius:999px;color:#fff;background:linear-gradient(100deg,var(--brand),var(--brand-2));box-shadow:0 14px 28px rgba(233,91,44,.2);font-size:18px;font-weight:760;cursor:pointer}.enter-btn:disabled{opacity:.65;cursor:wait}.state-copy{display:flex;align-items:center;justify-content:center;gap:10px;padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--surface-soft);color:#5c504a}.privacy{margin-top:24px;padding-top:18px;border-top:1px solid var(--line);color:var(--subtle);font-size:13px;line-height:1.7}.admin-link{display:block;width:max-content;margin:20px auto 0;color:var(--muted);font-size:13px;font-weight:650}.admin-link:hover{color:var(--brand)}
@media(max-width:600px){.entry-card{padding:34px 22px 26px;border-radius:16px}.entry-icon{width:56px;height:56px}.entry-card h2{font-size:24px}p{margin-bottom:22px}.link-panel{grid-template-columns:20px 1fr}.link-panel b{grid-column:1/-1;word-break:break-all}}
</style>
