<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { View, CircleCheckFilled, WarningFilled } from '@element-plus/icons-vue'
import AdminPage from '../../components/AdminPage.vue'
import { api, unwrap } from '../../lib/api'
import { ruleFormula } from '../../lib/score'
import type { ScoreRule } from '../../types'

const loading = ref(false)
const rules = ref<ScoreRule[]>([])
const rounding = ref('one_decimal')
const evaluation = ref<any>({})
const activities = ref<any[]>([])
const periods = ref<any[]>([])
const selected = ref('')
const enabledRules = computed(() => rules.value.filter((x) => x.enabled))
const sum = computed(() => enabledRules.value.reduce((t, x) => t + Number(x.weight), 0))
const equalAverage = computed(() => enabledRules.value.length > 0 && enabledRules.value.every((x) => Number(x.weight) === 100))
const valid = computed(() => (sum.value === 100 || equalAverage.value) && rules.value.every((x) => Number.isInteger(x.min) && Number.isInteger(x.max) && x.min >= 60 && x.max > x.min && x.max <= 99))
const formula = computed(() => ruleFormula(rules.value))
const periodName = computed(() => periods.value.find((x) => x.id === evaluation.value.periodId)?.name || '--')

async function load() {
  loading.value = true
  try {
    const query = selected.value ? `?evaluationCodeId=${encodeURIComponent(selected.value)}` : ''
    const data = unwrap<any>(await api.get(`/admin/settings/score-rules${query}`))
    rules.value = data.rules
    rounding.value = data.rounding
    evaluation.value = data.evaluation
    activities.value = data.activities
    periods.value = data.periods
    selected.value = data.evaluation.id
  } finally { loading.value = false }
}
function reset() {
  rules.value = [
    {id:'ability',name:'工作能力',min:60,max:99,weight:100,enabled:true},
    {id:'attitude',name:'工作态度',min:60,max:99,weight:100,enabled:true},
    {id:'collaboration',name:'协作能力',min:60,max:99,weight:100,enabled:true}
  ]
  rounding.value = 'one_decimal'
}
async function save() {
  if (!valid.value) return ElMessage.error('请检查分值范围；启用维度可全部 100% 使用等权平均，或按权重合计 100%')
  await api.put('/admin/settings/score-rules', { evaluationCodeId:evaluation.value.id, rules:rules.value, rounding:rounding.value })
  ElMessage.success('评分规则已保存并应用')
}
onMounted(load)
</script>

<template>
  <AdminPage title="综合评分计算规则" description="每个评价活动独立保存规则，切换活动后自动刷新">
    <div v-loading="loading">
      <section class="panel scope">
        <h3>规则适用范围</h3>
        <div class="scope-grid">
          <label><span>评价周期</span><el-input :model-value="periodName" disabled/></label>
          <label><span>评价活动</span><el-select v-model="selected" style="width:100%" @change="load"><el-option v-for="item in activities" :key="item.id" :label="`${item.name}${item.teamName ? ` · ${item.teamName}` : ''}`" :value="item.id"/></el-select></label>
          <label><span>状态</span><el-tag :type="evaluation.status==='active'?'success':'info'" size="large">{{ evaluation.status==='active'?'进行中':evaluation.status==='upcoming'?'未开始':'非进行中' }}</el-tag></label>
        </div>
      </section>

      <section class="panel rules">
        <h3>评分维度与计入方式</h3>
        <el-table :data="rules">
          <el-table-column prop="name" label="评分维度" min-width="160"><template #default="{ row }"><el-input v-model="row.name"/></template></el-table-column>
          <el-table-column label="最低分" min-width="140"><template #default="{ row }"><el-input-number v-model="row.min" :min="60" :max="98"/></template></el-table-column>
          <el-table-column label="最高分" min-width="140"><template #default="{ row }"><el-input-number v-model="row.max" :min="row.min+1" :max="99"/></template></el-table-column>
          <el-table-column label="计入比例" min-width="150"><template #default="{ row }"><el-input-number v-model="row.weight" :min="0" :max="100"/><span class="percent">%</span></template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{ row }"><el-switch v-model="row.enabled"/></template></el-table-column>
        </el-table>
        <div class="validation" :class="{invalid:!valid}"><component :is="valid?CircleCheckFilled:WarningFilled"/><span>{{ equalAverage ? '默认不折算：启用维度等权平均' : `权重合计 ${sum}%` }}，{{ valid?'配置有效':'请调整配置' }}</span></div>
      </section>

      <section class="panel preview-settings">
        <div class="preview"><h3>员工端展示预览</h3><div class="preview-box"><div class="preview-title"><View/>综合评分计算规则</div><strong>{{ formula }}</strong><small>计算结果{{rounding==='round'?'四舍五入取整':rounding==='one_decimal'?'保留1位小数':'直接取整'}}；各项仅可填写 {{Math.min(...rules.map(x=>x.min))}}–{{Math.max(...rules.map(x=>x.max))}} 分</small></div></div>
        <div class="rounding"><h3>结果取整方式</h3><el-radio-group v-model="rounding"><el-radio value="round">四舍五入为整数</el-radio><el-radio value="one_decimal">保留1位小数</el-radio><el-radio value="floor">直接取整</el-radio></el-radio-group></div>
      </section>

      <div class="savebar"><div class="warning"><WarningFilled/>规则变更不会修改已提交的历史评分</div><el-button @click="reset">恢复默认规则</el-button><el-button type="primary" :disabled="!valid" @click="save">保存并应用</el-button></div>
    </div>
  </AdminPage>
</template>

<style scoped>
.panel{margin-top:18px;padding:20px 22px}h3{margin:0 0 16px;font-size:17px}.scope-grid{display:grid;grid-template-columns:1fr 1.2fr 150px;gap:20px;align-items:end}.scope-grid label{display:grid;gap:8px}.scope-grid span{font-size:14px}.rules .el-input-number{width:116px}.percent{margin-left:7px;color:#777}.validation{display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--success)}.validation svg{width:18px}.validation.invalid{color:var(--danger)}.preview-settings{display:grid;grid-template-columns:1.3fr 1fr;gap:32px}.preview-box{padding:17px;border:1px solid #ffc8a8;border-radius:10px;background:#fff7f1}.preview-title{display:flex;align-items:center;gap:10px;margin-bottom:13px;font-weight:700}.preview-title svg{width:20px;color:var(--brand)}.preview-box strong{display:block;margin-left:30px;color:var(--brand)}.preview-box small{display:block;margin:10px 0 0 30px;color:#777}.rounding .el-radio-group{display:grid;gap:14px}.savebar{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:20px}.warning{display:flex;align-items:center;gap:8px;margin-right:auto;color:#966117;font-size:14px}.warning svg{width:18px;color:var(--warning)}
@media(max-width:900px){.scope-grid,.preview-settings{grid-template-columns:1fr}.savebar{align-items:stretch;flex-direction:column}.warning{margin:0 0 8px}.savebar .el-button{margin:0}.rules{overflow:auto}}
</style>
