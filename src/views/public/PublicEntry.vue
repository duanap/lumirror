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
  <PublicShell entry-mode>
    <div class="entry-card">
      <div class="entry-icon"><el-icon :size="30"><Lock /></el-icon></div>
      <span class="eyebrow">匿名评价入口</span>
      <h2>{{ hasTimedLink ? '正在打开时效评价' : '进入团队评价' }}</h2>
      <p v-if="hasTimedLink">链接打开后开始 5 分钟倒计时，请在倒计时内完成全部评价。</p>
      <p v-else-if="!hasInviteLink">评价活动只能通过邀请链接加邀请码，或一次性的时效链接打开。</p>

      <form v-if="hasInviteLink" @submit.prevent="enter">
        <label>邀请码</label>
        <div class="field">
          <el-icon :size="20"><Lock /></el-icon>
          <input v-model.trim="form.verifyCode" maxlength="6" inputmode="numeric" type="password" autocomplete="one-time-code" placeholder="请输入 6 位数字" />
        </div>
        <button class="enter-btn" :disabled="loading">
          <span>{{ loading ? '正在校验...' : '开始评价' }}</span>
          <el-icon :size="20"><ArrowRight /></el-icon>
        </button>
        <ol class="entry-notes">
          <li><b>1.</b><span>请输入管理员分发的 6 位数字邀请码，校验通过后即可开始评价。</span></li>
          <li><b>2.</b><span>邀请码仅用于确认评价资格，提交后不可重复使用。</span></li>
          <li><b>3.</b><span>全程匿名汇总，后台仅统计整体结果，不向被评价人展示单次评分。</span></li>
        </ol>
      </form>

      <div v-else-if="hasTimedLink" class="state-copy">
        <el-icon :size="22"><Timer /></el-icon>
        <span>正在校验时效链接...</span>
      </div>
      <div v-else class="state-copy">
        <el-icon :size="22"><Link /></el-icon>
        <span>请使用管理员分发的专属链接进入。</span>
      </div>
    </div>
    <a class="admin-link" href="/admin/login">管理员入口</a>
  </PublicShell>
</template>

<style scoped>
.entry-card{position:relative;max-width:560px;margin:0 auto;padding:44px 48px 34px;border:1px solid rgba(232,91,44,.16);border-radius:18px;background:rgba(255,255,255,.96);box-shadow:var(--shadow);text-align:center}.entry-icon{display:grid;place-items:center;width:62px;height:62px;margin:0 auto 18px;border-radius:16px;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand-2));box-shadow:0 14px 28px rgba(233,91,44,.2)}.eyebrow{display:inline-block;margin-bottom:8px;color:var(--brand-dark);font-size:13px;font-weight:760}h2{margin:0;color:var(--ink);font-size:28px;line-height:1.2}p{margin:11px 0 28px;color:var(--muted);font-size:15px;line-height:1.8}form{text-align:left}label{display:block;margin:24px 0 9px;color:var(--ink);font-weight:700}.field{display:flex;align-items:center;gap:12px;height:54px;padding:0 15px;border:1.5px solid #efb08c;border-radius:12px;color:var(--brand);background:#fff;transition:.2s}.field:focus-within{border-color:var(--brand);box-shadow:var(--focus)}input{width:100%;border:0;outline:0;color:var(--text);background:transparent;font-size:16px}.enter-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:56px;margin-top:28px;border:0;border-radius:999px;color:#fff;background:linear-gradient(100deg,var(--brand),var(--brand-2));box-shadow:0 14px 28px rgba(233,91,44,.2);font-size:18px;font-weight:760;cursor:pointer}.enter-btn:disabled{opacity:.65;cursor:wait}.entry-notes{display:grid;gap:10px;margin:23px 0 0;padding:17px 2px 0;border-top:1px solid var(--line);list-style:none}.entry-notes li{display:grid;grid-template-columns:19px minmax(0,1fr);gap:4px;color:var(--subtle);font-size:13px;line-height:1.65}.entry-notes b{color:var(--brand);font-weight:800}.entry-notes span{min-width:0}.state-copy{display:flex;align-items:center;justify-content:center;gap:10px;padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--surface-soft);color:#5c504a}.admin-link{display:block;width:max-content;margin:20px auto 0;color:var(--muted);font-size:13px;font-weight:650}.admin-link:hover{color:var(--brand)}
@media(max-width:600px){.entry-card{padding:34px 22px 26px;border-radius:16px}.entry-icon{width:56px;height:56px}.entry-card h2{font-size:24px}p{margin-bottom:22px}.entry-notes{gap:9px;margin-top:20px}.entry-notes li{font-size:12px}}
</style>
