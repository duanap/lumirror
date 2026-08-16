<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Timer, User, Check } from '@element-plus/icons-vue'
import PublicShell from '../../layouts/PublicShell.vue'
import IconGlyph from '../../components/IconGlyph.vue'
import { api, unwrap } from '../../lib/api'
import { calculateScore, ruleFormula } from '../../lib/score'
import type { EvaluationTask, ScoreRule } from '../../types'

const router = useRouter()
const task = ref<EvaluationTask | null>(null)
const scores = reactive<Record<string, number | undefined>>({})
const loading = ref(true)
const submitting = ref(false)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined

const total = computed(() => task.value ? calculateScore(scores,task.value.rules,task.value.rounding) : null)
const formula = computed(() => task.value ? ruleFormula(task.value.rules) : '')
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
    <template #title>{{ task?.evaluation.teamName || '团队' }} · 和光镜鉴</template>
    <div v-if="loading" class="score-card loading-card">正在加载评价任务...</div>
    <article v-else-if="task" class="score-card">
      <header class="task-head">
        <div class="target-main">
          <img :src="task.target.avatar||`/assets/avatar/default-${task.target.gender==='female'?'female':'male'}.svg`" alt="员工默认头像"/>
          <div class="target-copy">
            <div class="target-eyebrow">
              <span>当前评价对象</span>
              <b>{{ completedCount }}/{{ enabledRules.length }} 项已填</b>
            </div>
            <h2>{{ task.target.name }}</h2>
            <div class="target-meta">
              <span>{{ task.target.gender==='female'?'女':task.target.gender==='male'?'男':'未知' }}</span>
              <span>{{ task.target.teamName }}</span>
              <span>{{ task.target.position }}</span>
            </div>
          </div>
        </div>
        <div class="progress-track" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" :aria-label="`填写进度 ${progress}%`">
          <span :style="{width:`${progress}%`}"/>
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

      <details class="rule-card">
        <summary><span>查看本次计分方式</span><small>仅用于本次匿名评分</small></summary>
        <div class="rule-body">
          <p>{{formula}}</p>
          <small>计算结果{{task.rounding==='round'?'四舍五入取整':task.rounding==='one_decimal'?'保留1位小数':'直接取整'}}；每项仅可填写对应范围内的整数。</small>
        </div>
      </details>

      <footer class="action-bar" :class="{ready:total!==null}">
        <div class="action-summary">
          <div class="total-line">
            <span class="trophy"><IconGlyph name="trophy" :size="22"/></span>
            <span>综合总分</span>
            <strong>{{total??'--'}}</strong>
            <em>分</em>
          </div>
          <small><el-icon :size="15"><User /></el-icon>{{completedCount}}/{{enabledRules.length}} 项已填 · 还剩 <b>{{task.remaining}}</b> 位同事</small>
        </div>
        <button class="submit-btn" :disabled="submitting||total===null||timedExpired" @click="submit">
          <el-icon :size="20"><Check /></el-icon>
          <span>{{submitting?'正在提交...':'提交评价'}}</span>
        </button>
      </footer>
    </article>
  </PublicShell>
</template>

<style scoped>
.score-card{overflow:hidden;border:1px solid #dedbd6;border-radius:12px;background:#fff;box-shadow:0 20px 48px rgba(48,38,29,.1)}.loading-card{padding:78px 24px;text-align:center;color:var(--muted)}.task-head{padding:20px 30px 16px;border-bottom:1px solid #e7e3de}.target-main{display:flex;align-items:center;gap:16px}.task-head img{width:62px;height:62px;border-radius:50%;background:#f8eee8;box-shadow:0 0 0 4px #fff,0 0 0 5px #eee5de}.target-copy{flex:1;min-width:0}.target-eyebrow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px;color:var(--muted);font-size:12px}.target-eyebrow span{font-weight:700}.target-eyebrow b{color:var(--brand);font-weight:760}.target-copy h2{margin:0 0 6px;color:var(--ink);font-size:26px;line-height:1.1;overflow-wrap:anywhere}.target-meta{display:flex;gap:0;color:var(--muted);font-size:13px}.target-meta span+span{margin-left:10px;padding-left:10px;border-left:1px solid #d9d4cf}.progress-track{height:4px;margin-top:15px;overflow:hidden;border-radius:999px;background:#eee9e4}.progress-track span{display:block;height:100%;border-radius:inherit;background:var(--brand);transition:width .2s cubic-bezier(.23,1,.32,1)}.timer-card{display:flex;align-items:center;gap:10px;margin:16px 30px 0;padding:11px 14px;border:1px solid #f1cbb9;border-radius:8px;color:#7b5445;background:#fff8f4}.timer-card b{margin-left:auto;color:var(--brand);font-size:21px;letter-spacing:.04em}.timer-card.expired{border-color:#e8b8b5;color:#9b2c24;background:#fff5f4}.timer-card.expired b{color:#9b2c24}.score-fields{padding:2px 30px 0}.score-row{display:grid;grid-template-columns:44px minmax(160px,1fr) minmax(150px,190px) 20px;gap:14px;align-items:center;min-height:76px;border-bottom:1px solid #e9e5e0}.score-icon{display:grid;place-items:center;width:38px;height:38px;border-radius:8px;color:var(--brand);background:#fff1e8}.score-row.complete .score-icon{color:#317a25;background:#f0f8ed}.score-copy{display:grid;gap:3px;min-width:0}.score-copy strong{color:var(--ink);font-size:17px}.score-copy small{color:var(--subtle);font-size:12px}.input-wrap{position:relative;display:block;border:1px solid #cfcac4;border-radius:8px;background:#fff;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}.input-wrap:focus-within{border-color:var(--brand);box-shadow:var(--focus)}.input-wrap.valid{border-color:var(--success);background:#fbfff9}.score-row.invalid .input-wrap{border-color:#d25b4e;background:#fff9f8}.score-row input{width:100%;height:46px;padding:0 38px 0 12px;border:0;border-radius:8px;outline:none;background:transparent;text-align:center;font-size:21px;font-weight:760}.score-row input::placeholder{color:#aaa29b;font-size:14px;font-weight:500}.score-complete{position:absolute;right:12px;top:50%;color:var(--success);transform:translateY(-50%)}.score-row i{font-style:normal;font-size:14px}.rule-card{margin:15px 30px 0;padding:14px 0;border-top:1px solid #e9e5e0;color:#4b443f}.rule-card summary{display:grid;grid-template-columns:1fr auto;gap:2px 20px;position:relative;padding-right:24px;list-style:none;cursor:pointer}.rule-card summary::-webkit-details-marker{display:none}.rule-card summary:after{position:absolute;right:2px;top:9px;color:var(--muted);content:'⌄';transition:transform .16s cubic-bezier(.23,1,.32,1)}.rule-card[open] summary:after{transform:rotate(180deg)}.rule-card summary span{font-size:14px;font-weight:760}.rule-card summary small{grid-column:1;color:var(--subtle);font-size:11px}.rule-body p{margin:12px 0 4px;color:#4b443f;font-size:14px;font-weight:650}.rule-body>small{color:var(--muted);font-size:12px;line-height:1.7}.action-bar{display:grid;grid-template-columns:minmax(0,1fr) minmax(190px,240px);gap:18px;align-items:center;margin:0 30px 24px;padding:15px 16px;border:1px solid #f0d5c4;border-radius:10px;color:#6d625b;background:#fffaf6}.action-bar.ready{color:var(--brand);background:#fff6ef}.action-summary{display:grid;gap:5px;min-width:0}.total-line{display:flex;align-items:baseline;gap:7px}.trophy{display:grid;place-items:center;align-self:center;margin-right:2px;color:var(--brand)}.total-line>span:not(.trophy){font-weight:760}.total-line strong{margin-left:auto;font-size:30px;line-height:1}.total-line em{font-style:normal;font-size:14px;font-weight:700}.action-summary>small{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:12px}.action-summary>small b{color:var(--brand)}.submit-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:48px;border:0;border-radius:8px;color:#fff;background:var(--brand);box-shadow:0 8px 18px rgba(233,91,44,.2);font-size:17px;font-weight:800;cursor:pointer;transition:background .16s ease,transform .16s cubic-bezier(.23,1,.32,1)}.submit-btn:active:not(:disabled){transform:scale(.98)}.submit-btn:disabled{box-shadow:none;cursor:not-allowed;opacity:.48}
@media(hover:hover) and (pointer:fine){.submit-btn:hover:not(:disabled){background:#d94d21}}
@media(max-width:640px){.score-card{overflow:visible}.task-head{padding:18px}.target-main{gap:13px}.task-head img{width:54px;height:54px}.target-copy h2{font-size:23px}.target-eyebrow{font-size:11px}.target-meta{flex-wrap:wrap;gap:4px;font-size:12px}.target-meta span+span{margin-left:8px;padding-left:8px}.progress-track{margin-top:13px}.timer-card{margin:14px 18px 0}.score-fields{padding:2px 18px 0}.score-row{grid-template-columns:36px minmax(90px,1fr) 98px 16px;gap:8px;min-height:72px}.score-icon{width:34px;height:34px}.score-copy strong{font-size:15px;white-space:nowrap}.score-copy small{font-size:10px}.score-row input{height:44px;padding:0 30px 0 4px;font-size:19px}.score-row input::placeholder{font-size:12px}.score-complete{right:8px}.score-row i{font-size:13px}.rule-card{margin:12px 18px 0;padding:12px 0}.action-bar{position:sticky;z-index:5;bottom:max(8px,env(safe-area-inset-bottom));grid-template-columns:minmax(0,1fr) 142px;gap:10px;margin:0 8px 8px;padding:12px;border-color:#e9c8b8;box-shadow:0 12px 30px rgba(48,38,29,.2)}.total-line{gap:5px}.trophy{display:none}.total-line>span:not(.trophy){font-size:13px}.total-line strong{font-size:26px}.action-summary>small{font-size:10px}.submit-btn{height:46px;font-size:15px}.loading-card{padding:64px 20px}}
@media(max-width:390px){.target-eyebrow{align-items:flex-start;flex-direction:column;gap:1px}.score-row{grid-template-columns:36px minmax(0,1fr) 18px;gap:8px;min-height:0;padding:13px 0}.score-icon{grid-column:1;grid-row:1}.score-copy{grid-column:2/-1;grid-row:1}.score-copy strong{white-space:normal}.input-wrap{grid-column:1/3;grid-row:2}.score-row i{grid-column:3;grid-row:2}.score-row input{height:46px;padding-left:32px;font-size:21px}.action-bar{grid-template-columns:minmax(0,1fr) 128px;padding:10px}.total-line>span:not(.trophy){font-size:12px}.action-summary>small{line-height:1.25}.submit-btn{height:44px}}
@media(prefers-reduced-motion:reduce){.progress-track span,.rule-card summary:after,.submit-btn{transition-duration:.01ms}}
</style>
