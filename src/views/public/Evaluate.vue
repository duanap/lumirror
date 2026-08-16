<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Timer, User, Check } from '@element-plus/icons-vue'
import PublicShell from '../../layouts/PublicShell.vue'
import IconGlyph from '../../components/IconGlyph.vue'
import EmployeeAvatar from '../../components/EmployeeAvatar.vue'
import { api, unwrap } from '../../lib/api'
import { calculateScore } from '../../lib/score'
import type { EvaluationTask, ScoreRule } from '../../types'

const router = useRouter()
const task = ref<EvaluationTask | null>(null)
const scores = reactive<Record<string, number | undefined>>({})
const loading = ref(true)
const submitting = ref(false)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined

const total = computed(() => task.value ? calculateScore(scores,task.value.rules,task.value.rounding) : null)
const enabledRules = computed(() => task.value?.rules.filter((item) => item.enabled) || [])
const expiresAtMs = computed(() => task.value?.expiresAt ? new Date(task.value.expiresAt).getTime() : null)
const timeLeftSeconds = computed(() => expiresAtMs.value ? Math.max(0,Math.ceil((expiresAtMs.value - now.value) / 1000)) : null)
const timeLeftLabel = computed(() => {
  if (timeLeftSeconds.value === null) return ''
  const minutes = Math.floor(timeLeftSeconds.value / 60)
  const seconds = timeLeftSeconds.value % 60
  return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`
})
const timedExpired = computed(() => timeLeftSeconds.value !== null && timeLeftSeconds.value <= 0)
const completedCount = computed(() => enabledRules.value.filter((rule) => Number.isInteger(scores[rule.id]) && Number(scores[rule.id]) >= rule.min && Number(scores[rule.id]) <= rule.max).length)
const progress = computed(() => enabledRules.value.length ? Math.round(completedCount.value / enabledRules.value.length * 100) : 0)

function scoreIsValid(rule:ScoreRule) {
  const value = scores[rule.id]
  return Number.isInteger(value) && Number(value) >= rule.min && Number(value) <= rule.max
}
function scoreHasValue(rule:ScoreRule) { return scores[rule.id] !== undefined }
function selectScore(event:Event) { (event.target as HTMLInputElement).select() }
function focusNextScore(index:number) {
  const inputs = document.querySelectorAll<HTMLInputElement>('.score-row input')
  inputs[index + 1]?.focus()
}

async function loadTask() {
  loading.value = true
  try {
    task.value = unwrap(await api.get<EvaluationTask>('/public/current-task'))
    Object.keys(scores).forEach((key) => delete scores[key])
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无法获取评价任务')
    sessionStorage.removeItem('public_token')
    await router.replace('/')
  } finally { loading.value = false }
}
function onScoreInput(rule:ScoreRule,event:Event) {
  const input = event.target as HTMLInputElement
  const digits = input.value.replace(/\D/g,'').slice(0,2)
  input.value = digits
  scores[rule.id] = digits ? Number(digits) : undefined
}
function onScoreBlur(rule:ScoreRule) {
  const value = scores[rule.id]
  if (value !== undefined && (!Number.isInteger(value) || value < rule.min || value > rule.max)) {
    ElMessage.warning(`${rule.name}请输入 ${rule.min}-${rule.max} 的整数`)
  }
}
function validate() {
  if (!task.value) return false
  for (const rule of enabledRules.value) {
    const value = scores[rule.id]
    if (!Number.isInteger(value) || Number(value) < rule.min || Number(value) > rule.max) {
      ElMessage.warning(`${rule.name}必须填写 ${rule.min}-${rule.max} 的整数`)
      return false
    }
  }
  return true
}
async function submit() {
  if (!validate() || !task.value || total.value === null) return
  if (timedExpired.value) {
    ElMessage.error('评价不存在或已结束')
    sessionStorage.removeItem('public_token')
    await router.replace('/')
    return
  }
  try {
    await ElMessageBox.confirm(`本次综合评分为 ${total.value} 分，提交后不可修改。`,'确认提交',{confirmButtonText:'确认提交',cancelButtonText:'再检查一下',type:'warning'})
  } catch { return }
  submitting.value = true
  try {
    const result = unwrap(await api.post<{remaining:number;completed:boolean}>('/public/submit-score',{taskId:task.value.id,scores}))
    ElMessage.success('提交成功')
    if (result.completed) await router.replace('/success')
    else await loadTask()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '提交失败')
    if (error instanceof Error && /结束|失效|不存在/.test(error.message)) {
      sessionStorage.removeItem('public_token')
      await router.replace('/')
    }
  } finally { submitting.value = false }
}
onMounted(() => {
  timer = setInterval(() => { now.value = Date.now() }, 1000)
  void loadTask()
})
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <PublicShell compact>
    <template #title>{{ task?.evaluation.teamName || '团队' }} · 员工互评</template>
    <div v-if="loading" class="score-card loading-card">正在加载评价任务...</div>
    <article v-else-if="task" class="score-card">
      <header class="task-head">
        <div class="target-main">
          <EmployeeAvatar :avatar="task.target.avatar" :gender="task.target.gender" :size="108" :alt="`${task.target.name}的头像`"/>
          <div class="target-copy">
            <h2>{{ task.target.name }}</h2>
            <div class="target-meta">
              <span><IconGlyph name="user" :size="17"/>{{ task.target.gender==='female'?'女':task.target.gender==='male'?'男':'未知' }}</span>
              <span><IconGlyph name="team" :size="17"/>{{ task.target.teamName }}</span>
              <span><IconGlyph name="briefcase" :size="17"/>{{ task.target.position }}</span>
            </div>
          </div>
        </div>
      </header>

      <section v-if="task.timed" class="timer-card" :class="{expired:timedExpired}">
        <el-icon :size="20"><Timer /></el-icon>
        <span>{{ timedExpired ? '评价不存在或已结束' : '时效链接剩余时间' }}</span>
        <b>{{ timeLeftLabel }}</b>
      </section>

      <section class="score-fields">
        <label v-for="(rule,index) in enabledRules" :key="rule.id" class="score-row" :class="{complete:scoreIsValid(rule),invalid:scoreHasValue(rule)&&!scoreIsValid(rule)}">
          <span class="score-icon"><IconGlyph :name="index===0?'briefcase':index===1?'heart':'team'" :size="22"/></span>
          <span class="score-copy">
            <strong>{{rule.name}}</strong>
            <small>{{rule.min}}–{{rule.max}} 分 · {{rule.operation==='subtract'?'扣减项':'计分项'}}</small>
          </span>
          <span class="input-wrap" :class="{valid:scoreIsValid(rule)}">
            <input :value="scores[rule.id]??''" type="text" inputmode="numeric" maxlength="2" :enterkeyhint="index===enabledRules.length-1?'done':'next'" :aria-label="`${rule.name}，请输入 ${rule.min} 到 ${rule.max} 分`" :aria-invalid="scoreHasValue(rule)&&!scoreIsValid(rule)" :placeholder="`${rule.min}-${rule.max}`" @focus="selectScore" @input="onScoreInput(rule,$event)" @blur="onScoreBlur(rule)" @keydown.enter.prevent="focusNextScore(index)"/>
            <el-icon v-if="scoreIsValid(rule)" class="score-complete" :size="17"><Check /></el-icon>
          </span>
          <i>分</i>
        </label>
      </section>

      <section class="total-card" :class="{ready:total!==null}">
        <span class="trophy"><IconGlyph name="trophy" :size="26"/></span>
        <strong>综合总分：</strong>
        <b>{{total??'--'}}</b>
        <em>分</em>
      </section>

      <section class="rule-card" aria-label="本次计分方式">
        综合总分=(工作能力 + 工作态度 + 协作能力) / 3
      </section>

      <button class="submit-btn" :disabled="submitting||total===null||timedExpired" @click="submit">
        <el-icon :size="22"><Check /></el-icon>
        <span>{{submitting?'正在提交...':'提交评价'}}</span>
      </button>

      <footer class="remaining">
        <div><el-icon :size="20"><User /></el-icon><span>您还剩 <b>{{task.remaining}}</b> 人待评价</span></div>
        <div class="progress-track" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" :aria-label="`填写进度 ${progress}%`">
          <span :style="{width:`${progress}%`}"/>
        </div>
      </footer>
    </article>
  </PublicShell>
</template>

<style scoped>
.score-card{position:relative;overflow:visible;margin-top:72px;border:1px solid rgba(239,112,61,.18);border-radius:28px;background:rgba(255,255,255,.97);box-shadow:0 24px 60px rgba(84,46,25,.12)}.loading-card{margin-top:32px;padding:78px 24px;text-align:center;color:var(--muted)}.task-head{padding:70px 38px 30px;border-bottom:1px solid #f0dfd4;text-align:center}.target-main{display:block}.task-head :deep(.employee-avatar){position:absolute;left:50%;top:-58px;background-color:#fff2e9;box-shadow:0 0 0 8px #fff,0 0 0 10px #f5dfd2,0 15px 30px rgba(109,57,29,.12);transform:translateX(-50%)}.target-copy{min-width:0}.target-copy h2{margin:0 0 20px;color:var(--ink);font-size:34px;line-height:1.1;overflow-wrap:anywhere}.target-meta{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:10px;color:#4f433d;font-size:14px}.target-meta span{display:flex;align-items:center;gap:7px;min-height:38px;padding:0 15px;border:1px solid #f1a177;border-radius:12px;background:#fffaf7}.target-meta svg{color:var(--brand)}.timer-card{display:flex;align-items:center;gap:10px;margin:18px 38px 0;padding:11px 14px;border:1px solid #f1cbb9;border-radius:10px;color:#7b5445;background:#fff8f4}.timer-card b{margin-left:auto;color:var(--brand);font-size:21px;letter-spacing:.04em}.timer-card.expired{border-color:#e8b8b5;color:#9b2c24;background:#fff5f4}.timer-card.expired b{color:#9b2c24}.score-fields{padding:10px 48px 0}.score-row{display:grid;grid-template-columns:58px minmax(160px,1fr) minmax(190px,270px) 22px;gap:16px;align-items:center;min-height:116px;border-bottom:1px solid #f0e1d7}.score-icon{display:grid;place-items:center;width:52px;height:52px;border-radius:50%;color:var(--brand);background:#fff1e8}.score-row.complete .score-icon{color:#317a25;background:#f0f8ed}.score-copy{display:grid;gap:5px;min-width:0}.score-copy strong{color:var(--ink);font-size:23px}.score-copy small{color:var(--subtle);font-size:12px}.input-wrap{position:relative;display:block;border:1.5px solid #f06a3a;border-radius:12px;background:#fff;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}.input-wrap:focus-within{border-color:var(--brand);box-shadow:0 0 0 3px rgba(233,91,44,.14)}.input-wrap.valid{border-color:var(--success);background:#fbfff9}.score-row.invalid .input-wrap{border-color:#d25b4e;background:#fff9f8}.score-row input{width:100%;height:60px;padding:0 42px 0 14px;border:0;border-radius:12px;outline:none;background:transparent;text-align:center;font-size:24px;font-weight:760}.score-row input::placeholder{color:#b5aca6;font-size:17px;font-weight:500}.score-complete{position:absolute;right:13px;top:50%;color:var(--success);transform:translateY(-50%)}.score-row i{font-style:normal;font-size:19px}.total-card{display:flex;align-items:center;justify-content:center;gap:8px;margin:20px 48px 0;padding:24px 20px;border-radius:20px;color:#6d625b;background:linear-gradient(105deg,#fff2e5,#fff8f0)}.total-card.ready{color:#f04b22}.trophy{display:grid;place-items:center;width:48px;height:48px;margin-right:8px;border-radius:50%;color:var(--brand);background:rgba(255,255,255,.55)}.total-card strong{font-size:22px}.total-card b{font-size:42px;line-height:1}.total-card em{font-style:normal;font-size:20px;font-weight:760}.rule-card{margin:0 48px;padding:17px 20px 18px;border-top:1px solid rgba(240,106,58,.18);border-radius:0 0 20px 20px;color:#e44e24;background:#fff8f2;text-align:center;font-size:14px;font-weight:720;line-height:1.6}.submit-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:calc(100% - 96px);height:66px;margin:26px 48px 0;border:0;border-radius:999px;color:#fff;background:linear-gradient(100deg,#ffad43,var(--brand),#ff3e1d);box-shadow:0 14px 28px rgba(233,91,44,.25);font-size:23px;font-weight:800;cursor:pointer;transition:filter .16s ease,transform .16s cubic-bezier(.23,1,.32,1)}.submit-btn:active:not(:disabled){transform:scale(.98)}.submit-btn:disabled{box-shadow:none;cursor:not-allowed;filter:saturate(.5);opacity:.48}.remaining{display:grid;grid-template-columns:auto minmax(120px,1fr);align-items:center;gap:24px;padding:24px 48px 32px;color:#4f433d}.remaining>div:first-child{display:flex;align-items:center;gap:8px;white-space:nowrap}.remaining b{color:var(--brand);font-size:18px}.progress-track{height:8px;overflow:hidden;border-radius:999px;background:#f9e5d8}.progress-track span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#ff9a31,#ff4e20);transition:width .2s cubic-bezier(.23,1,.32,1)}
.total-card{border-radius:20px 20px 0 0}
@media(hover:hover) and (pointer:fine){.submit-btn:hover:not(:disabled){filter:brightness(.96)}}
@media(max-width:640px){.score-card{margin-top:58px;border-radius:24px}.task-head{padding:62px 18px 24px}.task-head :deep(.employee-avatar){top:-48px;box-shadow:0 0 0 6px #fff,0 0 0 8px #f5dfd2,0 12px 24px rgba(109,57,29,.12);transform:translateX(-50%) scale(.8333);transform-origin:center}.target-copy h2{margin-bottom:15px;font-size:29px}.target-meta{gap:7px;font-size:12px}.target-meta span{min-height:34px;padding:0 10px;border-radius:10px}.target-meta svg{width:15px;height:15px}.timer-card{margin:14px 18px 0}.score-fields{padding:7px 18px 0}.score-row{grid-template-columns:42px minmax(82px,1fr) minmax(112px,144px) 17px;gap:9px;min-height:88px}.score-icon{width:40px;height:40px}.score-copy strong{font-size:17px;white-space:nowrap}.score-copy small{font-size:10px}.score-row input{height:50px;padding:0 32px 0 6px;font-size:20px}.score-row input::placeholder{font-size:13px}.score-complete{right:9px}.score-row i{font-size:14px}.rule-card{margin:13px 18px 0;padding:12px 0}.total-card{margin:0 18px;padding:18px 12px;border-radius:16px}.trophy{width:40px;height:40px;margin-right:3px}.total-card strong{font-size:18px}.total-card b{font-size:34px}.total-card em{font-size:16px}.submit-btn{width:calc(100% - 36px);height:56px;margin:20px 18px 0;font-size:20px}.remaining{grid-template-columns:auto minmax(80px,1fr);gap:14px;padding:20px 18px 24px;font-size:13px}.remaining b{font-size:16px}.progress-track{height:7px}.loading-card{margin-top:24px;padding:64px 20px}}
@media(max-width:640px){.total-card{border-radius:16px 16px 0 0}.rule-card{margin:0 18px;padding:14px 16px 16px}}
@media(max-width:390px){.target-meta{gap:6px}.target-meta span{padding:0 8px}.score-row{grid-template-columns:38px minmax(76px,1fr) minmax(104px,128px) 16px;gap:7px}.score-icon{width:36px;height:36px}.score-copy strong{font-size:15px}.score-row input{height:48px;font-size:19px}.total-card{padding-left:8px;padding-right:8px}.total-card strong{font-size:17px}.remaining{gap:10px;font-size:12px}}
@media(prefers-reduced-motion:reduce){.progress-track span,.submit-btn{transition-duration:.01ms}}
</style>
