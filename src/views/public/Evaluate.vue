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
        <div class="target-label">当前评价对象</div>
        <div class="target-main">
          <img :src="task.target.avatar||`/assets/avatar/default-${task.target.gender==='female'?'female':'male'}.svg`" alt="员工默认头像"/>
          <div class="target-copy">
            <h2>{{ task.target.name }}</h2>
            <div class="target-meta">
              <span>{{ task.target.gender==='female'?'女':task.target.gender==='male'?'男':'未知' }}</span>
              <span>{{ task.target.teamName }}</span>
              <span>{{ task.target.position }}</span>
            </div>
          </div>
        </div>
      </header>

      <div class="task-status" :class="{'has-timer':task.timed}">
        <section v-if="task.timed" class="timer-card" :class="{expired:timedExpired}">
          <el-icon :size="20"><Timer /></el-icon>
          <span>{{ timedExpired ? '评价不存在或已结束' : '时效链接剩余时间' }}</span>
          <b>{{ timeLeftLabel }}</b>
        </section>

        <section class="progress-card">
          <div><strong>填写进度</strong><small>{{ completedCount }}/{{ enabledRules.length }} 项完成</small></div>
          <el-progress :percentage="progress" :stroke-width="8" color="#e95b2c"/>
        </section>
      </div>

      <section class="score-fields">
        <label v-for="(rule,index) in enabledRules" :key="rule.id" class="score-row">
          <span class="score-icon"><IconGlyph :name="index===0?'briefcase':index===1?'heart':'team'" :size="22"/></span>
          <span class="score-copy"><strong>{{rule.name}}</strong><small>请输入 {{rule.min}}-{{rule.max}} 分</small></span>
          <span class="input-wrap" :class="{valid:Number.isInteger(scores[rule.id])&&Number(scores[rule.id])>=rule.min&&Number(scores[rule.id])<=rule.max}">
            <input :value="scores[rule.id]??''" type="text" inputmode="numeric" maxlength="2" :placeholder="`${rule.min}-${rule.max}`" @input="onScoreInput(rule,$event)" @blur="onScoreBlur(rule)"/>
          </span>
          <i>分</i>
        </label>
      </section>

      <section class="total-card" :class="{ready:total!==null}">
        <span class="trophy"><IconGlyph name="trophy" :size="28"/></span>
        <strong>综合总分</strong>
        <b>{{total??'--'}}</b>
        <em>分</em>
      </section>

      <section class="rule-card" aria-label="综合评分计算规则">
        <div class="rule-title"><strong>综合评分计算规则</strong><small>仅用于本次匿名评分</small></div>
        <div class="rule-body">
          <p>{{formula}}</p>
          <small>计算结果{{task.rounding==='round'?'四舍五入取整':task.rounding==='one_decimal'?'保留1位小数':'直接取整'}}；每项仅可填写对应范围内的整数。</small>
        </div>
      </section>

      <button class="submit-btn" :disabled="submitting||total===null||timedExpired" @click="submit">
        <el-icon :size="20"><Check /></el-icon>
        <span>{{submitting?'正在提交...':'提交评价'}}</span>
      </button>
      <footer class="remaining">
        <el-icon :size="20"><User /></el-icon>
        <span>还剩 <b>{{task.remaining}}</b> 人待评价</span>
      </footer>
    </article>
  </PublicShell>
</template>

<style scoped>
.score-card{overflow:hidden;border:1px solid #dedbd6;border-radius:8px;background:#fff;box-shadow:0 20px 48px rgba(48,38,29,.1)}.loading-card{padding:78px 24px;text-align:center;color:var(--muted)}.task-head{padding:26px 30px 24px;border-bottom:1px solid #e7e3de}.target-label{margin-bottom:15px;color:var(--ink);font-size:15px;font-weight:780}.target-main{display:flex;align-items:center;gap:18px}.task-head img{width:74px;height:74px;border-radius:50%;background:#f8eee8;box-shadow:0 0 0 5px #fff,0 0 0 6px #eee5de}.target-copy{min-width:0}.target-copy h2{margin:0 0 8px;color:var(--ink);font-size:30px;line-height:1.1;overflow-wrap:anywhere}.target-meta{display:flex;gap:0;color:var(--muted);font-size:14px}.target-meta span+span{margin-left:12px;padding-left:12px;border-left:1px solid #d9d4cf}.task-status{display:grid;gap:12px;margin:18px 30px 0}.task-status.has-timer{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)}.timer-card,.progress-card{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid #f1cbb9;border-radius:8px;color:#7b5445;background:#fff8f4}.timer-card b{margin-left:auto;color:var(--brand);font-size:21px;letter-spacing:.04em}.timer-card.expired{border-color:#e8b8b5;color:#9b2c24;background:#fff5f4}.timer-card.expired b{color:#9b2c24}.progress-card{display:grid;grid-template-columns:118px 1fr;background:#fff}.progress-card strong{display:block;color:var(--ink);font-size:15px}.progress-card small{color:var(--muted);font-size:12px}.score-fields{padding:4px 30px 0}.score-row{display:grid;grid-template-columns:44px minmax(160px,1fr) minmax(150px,214px) 20px;gap:14px;align-items:center;min-height:82px;border-bottom:1px solid #e9e5e0}.score-icon{display:grid;place-items:center;width:38px;height:38px;border-radius:8px;color:var(--brand);background:#fff1e8}.score-copy{display:grid;gap:3px;min-width:0}.score-copy strong{color:var(--ink);font-size:18px}.score-copy small{color:var(--subtle);font-size:12px}.input-wrap{display:block;border:1px solid #cfcac4;border-radius:8px;background:#fff;transition:.18s}.input-wrap:focus-within{border-color:var(--brand);box-shadow:var(--focus)}.input-wrap.valid{border-color:var(--success);background:#fbfff9}.score-row input{width:100%;height:48px;padding:0 12px;border:0;border-radius:8px;outline:none;background:transparent;text-align:center;font-size:22px;font-weight:760}.score-row input::placeholder{color:#aaa29b;font-size:14px;font-weight:500}.score-row i{font-style:normal;font-size:15px}.total-card{display:flex;align-items:baseline;gap:8px;margin:22px 30px 0;padding:17px 18px;border:1px solid #f0d5c4;border-radius:8px;color:#6d625b;background:#fffaf6}.total-card.ready{color:var(--brand);background:#fff6ef}.trophy{display:grid;place-items:center;margin-right:3px;color:var(--brand)}.total-card strong{font-size:18px}.total-card b{margin-left:auto;font-size:38px;line-height:1}.total-card em{font-style:normal;font-size:16px;font-weight:700}.rule-card{margin:20px 30px 0;padding-top:18px;border-top:1px solid #e9e5e0}.rule-title{display:grid;gap:3px}.rule-title strong{color:var(--ink);font-size:15px}.rule-title small{color:var(--subtle);font-size:12px}.rule-body p{margin:10px 0 4px;color:#4b443f;font-size:14px;font-weight:650}.rule-body small{color:var(--muted);font-size:12px;line-height:1.7}.submit-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:calc(100% - 60px);height:54px;margin:22px 30px 0;border:0;border-radius:8px;color:#fff;background:var(--brand);box-shadow:0 10px 22px rgba(233,91,44,.2);font-size:18px;font-weight:800;cursor:pointer}.submit-btn:hover:not(:disabled){background:#d94d21}.submit-btn:disabled{box-shadow:none;cursor:not-allowed;opacity:.48}.remaining{display:flex;align-items:center;justify-content:center;gap:8px;margin:14px 0 24px;color:#5e5651;font-size:14px}.remaining b{color:var(--brand);font-size:16px}
@media(max-width:640px){.task-head{padding:22px 18px}.target-main{gap:14px}.task-head img{width:64px;height:64px}.target-copy h2{font-size:25px}.target-meta{flex-wrap:wrap;gap:4px;font-size:12px}.target-meta span+span{margin-left:8px;padding-left:8px}.task-status,.task-status.has-timer{grid-template-columns:1fr;margin-left:18px;margin-right:18px}.progress-card{grid-template-columns:1fr;gap:8px}.score-fields{padding:4px 18px 0}.score-row{grid-template-columns:36px minmax(90px,1fr) 94px 16px;gap:8px;min-height:76px}.score-icon{width:34px;height:34px}.score-copy strong{font-size:15px;white-space:nowrap}.score-copy small{font-size:10px}.score-row input{height:44px;padding:0 4px;font-size:19px}.score-row input::placeholder{font-size:12px}.score-row i{font-size:13px}.total-card,.rule-card{margin-left:18px;margin-right:18px}.total-card{padding:15px 13px}.total-card strong{font-size:16px}.total-card b{font-size:32px}.submit-btn{width:calc(100% - 36px);margin-left:18px;margin-right:18px;height:52px;font-size:17px}.remaining{margin-bottom:20px}.loading-card{padding:64px 20px}}
@media(max-width:390px){.score-row{grid-template-columns:36px minmax(0,1fr) 18px;gap:8px;min-height:0;padding:14px 0}.score-icon{grid-column:1;grid-row:1}.score-copy{grid-column:2/-1;grid-row:1}.score-copy strong{white-space:normal}.input-wrap{grid-column:1/3;grid-row:2}.score-row i{grid-column:3;grid-row:2}.score-row input{height:48px;font-size:21px}}
</style>
