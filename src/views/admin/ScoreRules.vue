<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { View, CircleCheckFilled, WarningFilled, Plus, Delete } from '@element-plus/icons-vue'
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
const locked = ref(false)
const lockedReason = ref('')
const enabledRules = computed(() => rules.value.filter((x) => x.enabled))
const netWeight = computed(() => enabledRules.value.reduce((total,rule) => total + (rule.operation === 'subtract' ? -1 : 1) * Number(rule.weight),0))
const equalAverage = computed(() => enabledRules.value.length > 0 && enabledRules.value.every((rule) => rule.operation === 'add' && Number(rule.weight) === 100))
const valid = computed(() => rules.value.length >= 1 && rules.value.length <= 12 && enabledRules.value.length > 0 && (netWeight.value === 100 || equalAverage.value) && rules.value.every((rule) => rule.name.trim() && Number.isInteger(rule.min) && Number.isInteger(rule.max) && rule.min >= 0 && rule.max > rule.min && rule.max <= 99 && Number.isInteger(rule.weight) && rule.weight >= 0 && rule.weight <= 100))
const formula = computed(() => ruleFormula(rules.value))
const periodName = computed(() => periods.value.find((x) => x.id === evaluation.value.periodId)?.name || '--')

async function load() {
  loading.value = true
  try {
    const query = selected.value ? `?evaluationCodeId=${encodeURIComponent(selected.value)}` : ''
    const data = unwrap<any>(await api.get(`/admin/settings/score-rules${query}`))
    rules.value = data.rules.map((rule:ScoreRule) => ({...rule,operation:rule.operation === 'subtract' ? 'subtract' : 'add'}))
    rounding.value = data.rounding
    evaluation.value = data.evaluation
    activities.value = data.activities
    periods.value = data.periods
    selected.value = data.evaluation.id
    locked.value = Boolean(data.locked)
    lockedReason.value = String(data.lockedReason || '')
  } finally { loading.value = false }
}
function reset() {
  if (locked.value) return ElMessage.warning(lockedReason.value || '当前活动规则已锁定')
  rules.value = [
    {id:'ability',name:'工作能力',min:60,max:99,weight:100,operation:'add',enabled:true},
    {id:'attitude',name:'工作态度',min:60,max:99,weight:100,operation:'add',enabled:true},
    {id:'collaboration',name:'协作能力',min:60,max:99,weight:100,operation:'add',enabled:true}
  ]
  rounding.value = 'one_decimal'
}
function addRule() {
  if (locked.value) return ElMessage.warning(lockedReason.value || '当前活动规则已锁定')
  if (rules.value.length >= 12) return ElMessage.warning('最多可设置 12 个评分维度')
  rules.value.push({id:`dimension_${Date.now().toString(36)}`,name:'新评分维度',min:0,max:99,weight:0,operation:'add',enabled:true})
}
function removeRule(index:number) {
  if (locked.value) return ElMessage.warning(lockedReason.value || '当前活动规则已锁定')
  if (rules.value.length <= 1) return ElMessage.warning('至少保留 1 个评分维度')
  rules.value.splice(index,1)
}
async function save() {
  if (locked.value) return ElMessage.warning(lockedReason.value || '当前活动规则已锁定')
  if (!valid.value) return ElMessage.error('请检查名称、分值范围和计入比例；普通加权的净计入比例必须为 100%')
  await api.put('/admin/settings/score-rules', { evaluationCodeId:evaluation.value.id, rules:rules.value, rounding:rounding.value })
  ElMessage.success('评分规则已保存并应用')
  await load()
}
onMounted(load)
</script>

<template>
  <AdminPage title="综合评分计算规则" description="每个评价活动独立保存规则；首份评分提交后自动冻结计算口径">
    <div v-loading="loading">
      <section class="panel scope">
        <h3>规则适用范围</h3>
        <el-alert v-if="locked" :title="lockedReason || '当前活动规则已锁定'" type="warning" :closable="false" show-icon class="locked-alert"/>
        <div class="scope-grid">
          <label><span>评价周期</span><el-input :model-value="periodName" disabled/></label>
          <label><span>评价活动</span><el-select v-model="selected" style="width:100%" @change="load"><el-option v-for="item in activities" :key="item.id" :label="`${item.name}${item.teamName ? ` · ${item.teamName}` : ''}`" :value="item.id"/></el-select></label>
          <label><span>状态</span><el-tag :type="evaluation.status==='active'?'success':'info'" size="large">{{ evaluation.status==='active'?'进行中':evaluation.status==='upcoming'?'未开始':'非进行中' }}</el-tag></label>
        </div>
      </section>

      <section class="panel rules">
        <div class="rules-head"><div><h3>评分维度与计入方式</h3><small>加分比例之和减去减分比例之和，应等于 100%</small></div><el-button type="primary" plain :icon="Plus" :disabled="locked" @click="addRule">新增维度</el-button></div>
        <el-table :data="rules">
          <el-table-column prop="name" label="评分维度" min-width="160"><template #default="{ row }"><el-input v-model="row.name" :disabled="locked"/></template></el-table-column>
          <el-table-column label="最低分" min-width="140"><template #default="{ row }"><el-input-number v-model="row.min" :min="0" :max="98" :disabled="locked"/></template></el-table-column>
          <el-table-column label="最高分" min-width="140"><template #default="{ row }"><el-input-number v-model="row.max" :min="row.min+1" :max="99" :disabled="locked"/></template></el-table-column>
          <el-table-column label="计入方向" min-width="140"><template #default="{ row }"><el-select v-model="row.operation" :disabled="locked"><el-option label="增加" value="add"/><el-option label="减少" value="subtract"/></el-select></template></el-table-column>
          <el-table-column label="计入比例" min-width="150"><template #default="{ row }"><el-input-number v-model="row.weight" :min="0" :max="100" :disabled="locked"/><span class="percent">%</span></template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{ row }"><el-switch v-model="row.enabled" :disabled="locked"/></template></el-table-column>
          <el-table-column label="操作" width="80" fixed="right"><template #default="{ $index }"><el-button link type="danger" :icon="Delete" :disabled="locked" aria-label="删除评分维度" @click="removeRule($index)"/></template></el-table-column>
        </el-table>
        <div class="validation" :class="{invalid:!valid}"><component :is="valid?CircleCheckFilled:WarningFilled"/><span>{{ equalAverage ? '默认不折算：启用维度等权平均' : `净计入比例 ${netWeight}%` }}，{{ valid?'配置有效':'请调整配置' }}</span></div>
      </section>

      <section class="panel preview-settings">
        <div class="preview"><h3>员工端展示预览</h3><div class="preview-box"><div class="preview-title"><View/>综合评分计算规则</div><strong>{{ formula }}</strong><small>计算结果{{rounding==='round'?'四舍五入取整':rounding==='one_decimal'?'保留1位小数':'直接取整'}}；各项仅可填写 {{Math.min(...rules.map(x=>x.min))}}–{{Math.max(...rules.map(x=>x.max))}} 分</small></div></div>
        <div class="rounding"><h3>结果取整方式</h3><el-radio-group v-model="rounding" :disabled="locked"><el-radio value="round">四舍五入为整数</el-radio><el-radio value="one_decimal">保留1位小数</el-radio><el-radio value="floor">直接取整</el-radio></el-radio-group></div>
      </section>

      <div class="savebar"><div class="warning"><WarningFilled/>{{ locked ? '为保证历史评分口径一致，本活动不能再修改规则' : '首份评分提交后，本活动规则将自动冻结' }}</div><el-button :disabled="locked" @click="reset">恢复默认规则</el-button><el-button type="primary" :disabled="locked||!valid" @click="save">保存并应用</el-button></div>
    </div>
  </AdminPage>
</template>

<style scoped>
.panel{margin-top:18px;padding:20px 22px}h3{margin:0 0 16px;font-size:17px}.locked-alert{margin-bottom:16px}.rules-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}.rules-head h3{margin-bottom:4px}.rules-head small{color:var(--muted)}.scope-grid{display:grid;grid-template-columns:1fr 1.2fr 150px;gap:20px;align-items:end}.scope-grid label{display:grid;gap:8px}.scope-grid span{font-size:14px}.rules .el-input-number{width:116px}.percent{margin-left:7px;color:var(--muted)}.validation{display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--success)}.validation svg{width:18px}.validation.invalid{color:var(--danger)}.preview-settings{display:grid;grid-template-columns:1.3fr 1fr;gap:32px}.preview-box{padding:17px;border:1px solid var(--brand-soft);border-radius:10px;background:var(--surface-soft)}.preview-title{display:flex;align-items:center;gap:10px;margin-bottom:13px;font-weight:700}.preview-title svg{width:20px;color:var(--brand)}.preview-box strong{display:block;margin-left:30px;color:var(--brand)}.preview-box small{display:block;margin:10px 0 0 30px;color:var(--muted)}.rounding .el-radio-group{display:grid;gap:14px}.savebar{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:20px}.warning{display:flex;align-items:center;gap:8px;margin-right:auto;color:var(--warning);font-size:14px}.warning svg{width:18px;color:var(--warning)}
@media(max-width:900px){.scope-grid,.preview-settings{grid-template-columns:1fr}.savebar{align-items:stretch;flex-direction:column}.warning{margin:0 0 8px}.savebar .el-button{margin:0}.rules{overflow:auto}}
</style>