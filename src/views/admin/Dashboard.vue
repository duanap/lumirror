<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AdminPage from '../../components/AdminPage.vue'
import StatCard from '../../components/StatCard.vue'
import { api, unwrap } from '../../lib/api'

const data = ref<any>({})
const loading = ref(true)
const selected = ref('')
const teamGroups = computed(() => Array.isArray(data.value.teamGroups) ? data.value.teamGroups : [])

function statusLabel(status:string) {
  return status === 'active' ? '进行中' : status === 'archived' ? '已归档' : status === 'disabled' ? '已停用' : status || '--'
}
function statusType(status:string) {
  return status === 'active' ? 'success' : status === 'archived' ? 'info' : 'warning'
}

async function load() {
  loading.value = true
  try {
    const query = selected.value ? `?evaluationCodeId=${encodeURIComponent(selected.value)}` : ''
    data.value = unwrap(await api.get(`/admin/dashboard${query}`))
    if (data.value.id) selected.value = data.value.id
  } finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <AdminPage title="数据概览" :description="data.mode==='member'?'成员账号仅用于后台账号维护，不展示整体进度和评分结果':'按权限范围查看评价活动参与情况与匿名汇总数据'">
    <template #actions>
      <el-select v-if="data.mode!=='member'" v-model="selected" placeholder="选择评价活动" style="width:320px" @change="load">
        <el-option v-for="item in data.activities||[]" :key="item.id" :label="`${item.name}${item.teamName ? ` · ${item.teamName}` : ''}`" :value="item.id"/>
      </el-select>
    </template>

    <div v-if="data.mode==='member'" class="member-welcome panel">
      <div class="welcome-mark">✓</div>
      <div>
        <h3>成员账号已登录</h3>
        <p>为了保护匿名评价，本账号不会展示团队整体完成进度、个人评分结果或其他成员信息。请使用邀请链接和邀请码参与评价。</p>
        <router-link to="/">前往评价入口</router-link>
      </div>
    </div>

    <template v-else>
      <div v-loading="loading" class="stats">
        <StatCard label="当前评价周期" :value="data.periodName||'--'"/>
        <StatCard label="当前评价团队" :value="data.teamName||'--'"/>
        <StatCard label="参与评价人数" :value="data.participants??'--'"/>
        <StatCard label="已完成人数" :value="data.completed??'--'" color="var(--success)"/>
        <StatCard label="未完成人数" :value="data.pending??'--'" color="var(--warning)"/>
        <StatCard label="整体完成率" :value="`${data.completionRate??0}%`"/>
        <StatCard label="评价对象人数" :value="data.targetCount??'--'"/>
        <StatCard label="平均综合分" :value="data.averageScore??'--'" color="var(--brand)"/>
      </div>

      <section class="panel progress-panel">
        <div>
          <h3>整体评分进度</h3>
          <p>仅具备后台统计权限的角色可见；公开评价端不会展示个人评分结果。</p>
        </div>
        <el-progress type="dashboard" :percentage="data.completionRate||0" color="#e95b2c"/>
      </section>

      <section class="team-section">
        <div class="section-head compact-head">
          <div>
            <h3>按团队和评价活动</h3>
            <p>团队内按评价活动拆分展示参与人数、完成进度、任务量和匿名汇总分。</p>
          </div>
        </div>
        <div v-loading="loading" class="team-groups">
          <el-empty v-if="!teamGroups.length" description="暂无可展示的评价活动"/>
          <article v-for="group in teamGroups" :key="group.teamId" class="team-group panel">
            <header class="team-head">
              <div>
                <h4>{{ group.teamName || '未分配团队' }}</h4>
                <p>{{ group.departmentName || '未设置部门' }} · {{ group.activityCount || 0 }} 个评价活动</p>
              </div>
              <div class="team-metrics">
                <span><b>{{ group.participants || 0 }}</b> 参与</span>
                <span><b>{{ group.completed || 0 }}</b> 完成</span>
                <span><b>{{ group.completionRate || 0 }}%</b> 完成率</span>
              </div>
            </header>
            <el-table :data="group.activities || []" class="activity-table" size="small">
              <el-table-column prop="name" label="评价活动" min-width="180"/>
              <el-table-column label="状态" width="92">
                <template #default="{row}"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
              </el-table-column>
              <el-table-column label="参与 / 完成 / 未完成" min-width="160">
                <template #default="{row}">{{ row.participantCount || 0 }} / {{ row.completedParticipants || 0 }} / {{ row.pendingParticipants || 0 }}</template>
              </el-table-column>
              <el-table-column label="完成率" min-width="160">
                <template #default="{row}"><el-progress :percentage="row.completionRate || 0" :stroke-width="8" color="#e95b2c"/></template>
              </el-table-column>
              <el-table-column label="对象 / 任务" min-width="120">
                <template #default="{row}">{{ row.targetCount || 0 }} / {{ row.taskCount || 0 }}</template>
              </el-table-column>
              <el-table-column prop="averageScore" label="平均分" width="95"/>
            </el-table>
          </article>
        </div>
      </section>
    </template>
  </AdminPage>
</template>

<style scoped>
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-top:22px}.progress-panel{display:flex;align-items:center;justify-content:space-between;margin-top:18px;padding:26px 30px}h3,h4{margin:0 0 8px;color:var(--ink)}p{margin:0;color:var(--muted);font-size:14px;line-height:1.75}.member-welcome{display:flex;align-items:flex-start;gap:18px;margin-top:24px;padding:32px}.welcome-mark{display:grid;place-items:center;flex:0 0 auto;width:52px;height:52px;border-radius:14px;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand-2));font-size:24px;font-weight:800}.member-welcome a{display:inline-block;margin-top:16px;color:var(--brand);font-weight:720}.team-section{margin-top:24px}.compact-head{margin-bottom:14px}.team-groups{display:grid;gap:16px;min-height:120px}.team-group{padding:18px}.team-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:14px}.team-head h4{font-size:18px}.team-metrics{display:flex;flex-wrap:wrap;gap:10px}.team-metrics span{display:inline-flex;align-items:center;gap:4px;padding:8px 11px;border:1px solid var(--line-strong);border-radius:999px;background:var(--surface-tint);color:var(--muted);font-size:13px}.team-metrics b{color:var(--brand);font-size:15px}.activity-table{width:100%}
@media(max-width:1200px){.stats{grid-template-columns:repeat(2,1fr)}}@media(max-width:760px){.team-head{flex-direction:column}.team-metrics{width:100%}.team-metrics span{flex:1 1 30%;justify-content:center}}@media(max-width:600px){.stats{grid-template-columns:1fr}.progress-panel{align-items:flex-start;flex-direction:column;padding:22px;gap:18px}.member-welcome{padding:24px 20px}.welcome-mark{width:44px;height:44px}.team-group{padding:14px}.team-metrics span{flex-basis:100%}}
</style>
