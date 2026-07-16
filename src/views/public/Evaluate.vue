<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowUp, ArrowDown, Timer, User, Check } from '@element-plus/icons-vue'
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
const rulesOpen = ref(false)
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
        <img :src="task.target.avatar||`/assets/avatar/default-${task.target.gender==='female'?'female':'male'}.svg`" alt="员工默认头像"/>
        <div class="target-copy">
          <span>当前评价对象</span>
          <h2>{{ task.target.name }}</h2>
          <div class="tags">
            <span>{{ task.target.gender==='female'?'女':task.target.gender==='male'?'男':'未知' }}</span>
            <span>{{ task.target.teamName }}</span>
            <span>{{ task.target.position }}</span>
          </div>
        </div>
      </header>

      <section v-if="task.timed" class="timer-card" :class="{expired:timedExpired}">
        <el-icon :size="20"><Timer /></el-icon>
        <span>{{ timedExpired ? '评价不存在或已结束' : '时效链接剩余时间' }}</span>
        <b>{{ timeLeftLabel }}</b>
      </section>

      <section class="progress-card">
        <div><strong>填写进度</strong><small>{{ completedCount }}/{{ enabledRules.length }} 项完成</small></div>
        <el-progress :percentage="progress" :stroke-width="8" color="#e95b2c"/>
      </section>

      <section class="score-fields">
        <label v-for="(rule,index) in enabledRules" :key="rule.id" class="score-row">
          <span class="score-icon"><IconGlyph :name="index===0?'briefcase':index===1?'heart':'team'" :size="22"/></span>
          <span class="score-copy"><strong>{{rule.name}}</strong><small>{{rule.min}}-{{rule.max}} 分</small></span>
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

      <section class="rule-card">
        <button class="rule-title" type="button" @click="rulesOpen=!rulesOpen">
          <span><strong>综合评分计算规则</strong><small>仅用于本次匿名评分</small></span>
          <el-icon class="rule-arrow" :size="18"><component :is="rulesOpen?ArrowUp:ArrowDown"/></el-icon>
        </button>
        <div v-show="rulesOpen" class="rule-body">
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
.score-card{padding:22px 38px 30px;border:1px solid rgba(233,91,44,.16);border-radius:18px;background:rgba(255,255,255,.97);box-shadow:var(--shadow)}.loading-card{padding:78px 24px;text-align:center;color:var(--muted)}.task-head{display:grid;grid-template-columns:118px 1fr;gap:22px;align-items:center}.task-head img{width:118px;height:118px;border:6px solid #fff;border-radius:50%;background:#fff7f1;box-shadow:0 12px 28px rgba(80,48,31,.13)}.target-copy span{color:var(--muted);font-size:13px;font-weight:650}.target-copy h2{margin:6px 0 12px;color:var(--ink);font-size:34px;line-height:1.1}.tags{display:flex;gap:8px;flex-wrap:wrap}.tags span{padding:6px 12px;border:1px solid #efc3aa;border-radius:999px;color:#4a3b36;background:#fffaf6;font-size:13px}.timer-card,.progress-card{display:flex;align-items:center;gap:10px;margin-top:18px;padding:13px 15px;border:1px solid #efc3aa;border-radius:12px;color:#704e3f;background:#fff8f2}.timer-card b{margin-left:auto;color:var(--brand);font-size:24px;letter-spacing:.04em}.timer-card.expired{border-color:#e8b8b5;color:#9b2c24;background:#fff5f4}.timer-card.expired b{color:#9b2c24}.progress-card{display:grid;grid-template-columns:150px 1fr}.progress-card strong{display:block;color:var(--ink)}.progress-card small{color:var(--muted);font-size:12px}.score-fields{margin-top:8px}.score-row{display:grid;grid-template-columns:48px minmax(132px,1fr) minmax(140px,210px) 22px;gap:14px;align-items:center;min-height:88px;border-bottom:1px solid var(--line)}.score-icon{display:grid;place-items:center;width:46px;height:46px;border-radius:50%;color:var(--brand);background:#fff1e8}.score-copy{display:grid;gap:4px}.score-copy strong{color:var(--ink);font-size:20px}.score-copy small{color:var(--subtle);font-size:12px}.input-wrap{display:block;border:1.5px solid #efa67d;border-radius:12px;background:#fff;transition:.18s}.input-wrap:focus-within{border-color:var(--brand);box-shadow:var(--focus)}.input-wrap.valid{border-color:var(--success);background:#fbfff9}.score-row input{width:100%;height:52px;padding:0 12px;border:0;border-radius:12px;outline:none;background:transparent;text-align:center;font-size:22px;font-weight:760}.score-row input::placeholder{color:#b8aca6;font-size:15px;font-weight:500}.score-row i{font-style:normal;font-size:16px}.total-card{display:flex;align-items:baseline;justify-content:center;gap:8px;margin-top:20px;padding:18px;border:1px solid #efc3aa;border-radius:14px;color:#8f8078;background:linear-gradient(110deg,#fff8f2,#fffaf8)}.total-card.ready{color:var(--brand);background:linear-gradient(110deg,#fff0e2,#fff8f3)}.trophy{align-self:center;margin-right:4px}.total-card strong{font-size:20px}.total-card b{font-size:40px;line-height:1}.total-card em{font-style:normal;font-size:18px;font-weight:700}.rule-card{margin-top:14px;padding:0 16px 12px;border:1px solid #efd0bd;border-radius:12px;background:#fffaf7}.rule-title{display:flex;align-items:center;justify-content:space-between;width:100%;padding:14px 0 11px;border:0;color:var(--brand);background:transparent;text-align:left;cursor:pointer}.rule-title>span{display:grid;gap:3px}.rule-title strong{font-size:15px}.rule-title small{color:var(--subtle);font-size:12px}.rule-body{border-top:1px solid #f0d8c8}.rule-body p{margin:12px 0 5px;font-weight:650}.rule-body small{color:var(--muted);line-height:1.7}.submit-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:58px;margin-top:20px;border:0;border-radius:999px;color:#fff;background:linear-gradient(100deg,var(--brand),var(--brand-2));box-shadow:0 13px 28px rgba(233,91,44,.2);font-size:21px;font-weight:800;cursor:pointer}.submit-btn:disabled{box-shadow:none;cursor:not-allowed;opacity:.48}.remaining{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px;color:#4b423f}.remaining b{color:var(--brand);font-size:18px}
@media(max-width:640px){.score-card{padding:18px 16px 23px;border-radius:16px}.task-head{grid-template-columns:82px 1fr;gap:14px}.task-head img{width:82px;height:82px;border-width:4px}.target-copy h2{font-size:26px}.tags{gap:6px}.tags span{padding:5px 9px;font-size:12px}.progress-card{grid-template-columns:1fr;gap:8px}.score-row{grid-template-columns:40px minmax(88px,1fr) 92px 17px;gap:8px;min-height:78px}.score-icon{width:38px;height:38px}.score-copy strong{font-size:16px;white-space:nowrap}.score-copy small{font-size:11px}.score-row input{height:46px;padding:0 5px;font-size:20px}.score-row input::placeholder{font-size:13px}.score-row i{font-size:14px}.total-card{padding:15px 5px}.total-card strong{font-size:18px}.total-card b{font-size:34px}.submit-btn{height:54px;font-size:20px}.loading-card{padding:64px 20px}}
@media(max-width:380px){.score-row{grid-template-columns:36px minmax(74px,1fr) 78px 15px}.score-copy strong{font-size:15px}.score-row input{font-size:18px}}
</style>
