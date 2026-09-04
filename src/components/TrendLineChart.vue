<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export interface TrendPoint {
  activityId: string
  activityName: string
  periodName: string
  evaluationTime: string
  reviewCount: number
  total: number
  archived?: boolean
}

const props = defineProps<{ points: TrendPoint[] }>()
const selectedIndex = ref(0)
const width = 720
const height = 270
const padding = { left:52, right:28, top:26, bottom:48 }
const innerWidth = width - padding.left - padding.right
const innerHeight = height - padding.top - padding.bottom
const values = computed(() => props.points.map((point) => Number(point.total)).filter(Number.isFinite))
const bounds = computed(() => {
  if (!values.value.length) return { min:0,max:100 }
  const rawMin = Math.min(...values.value)
  const rawMax = Math.max(...values.value)
  const spread = Math.max(8,rawMax-rawMin)
  return {min:Math.max(0,Math.floor((rawMin-spread*.18)*10)/10),max:Math.ceil((rawMax+spread*.18)*10)/10}
})
function x(index:number) {
  if (props.points.length <= 1) return padding.left + innerWidth / 2
  return padding.left + index / (props.points.length-1) * innerWidth
}
function y(value:number) {
  return padding.top + (bounds.value.max-value) / (bounds.value.max-bounds.value.min || 1) * innerHeight
}
const linePath = computed(() => props.points.map((point,index) => `${index?'L':'M'} ${x(index)} ${y(point.total)}`).join(' '))
const gridValues = computed(() => Array.from({length:4},(_,index) => bounds.value.min + (bounds.value.max-bounds.value.min) / 3 * index).reverse())
const selectedPoint = computed(() => props.points[selectedIndex.value] || null)
function label(value:string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0,10)
  return `${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
function select(index:number) { selectedIndex.value = index }
watch(() => props.points,() => { selectedIndex.value = Math.max(0,props.points.length-1) },{immediate:true})
</script>

<template>
  <section class="trend-chart" :class="{single:points.length===1}">
    <svg v-if="points.length" class="chart-svg" :viewBox="`0 0 ${width} ${height}`" role="img" aria-label="综合平均分趋势图">
      <g v-for="value in gridValues" :key="value">
        <line :x1="padding.left" :x2="width-padding.right" :y1="y(value)" :y2="y(value)" class="grid-line"/>
        <text :x="padding.left-10" :y="y(value)+4" class="axis-label" text-anchor="end">{{value}}</text>
      </g>
      <path :d="linePath" class="trend-line"/>
      <g v-for="(point,index) in points" :key="point.activityId">
        <circle :cx="x(index)" :cy="y(point.total)" r="12" class="hit-area" tabindex="0" @mouseenter="select(index)" @focus="select(index)" @touchstart.prevent="select(index)"/>
        <circle :cx="x(index)" :cy="y(point.total)" :r="selectedIndex===index?6:4" class="trend-dot" :class="{selected:selectedIndex===index}"/>
        <text :x="x(index)" :y="height-18" class="axis-label x-label" text-anchor="middle">{{label(point.evaluationTime)}}</text>
      </g>
    </svg>
    <el-empty v-else description="所选对象在当前时间范围内暂无有效评分" :image-size="76"/>
    <div v-if="selectedPoint" class="trend-tooltip">
      <div><b>{{selectedPoint.activityName}}</b><span v-if="selectedPoint.archived">已归档</span></div>
      <p>{{selectedPoint.periodName || '未设置周期'}} · {{selectedPoint.evaluationTime}}</p>
      <strong>{{selectedPoint.total}} <small>分</small></strong><em>{{selectedPoint.reviewCount}} 份有效评价</em>
    </div>
  </section>
</template>

<style scoped>
.trend-chart{padding:16px 18px 8px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.chart-svg{display:block;width:100%;min-height:220px;overflow:visible}.grid-line{stroke:var(--line);stroke-dasharray:3 4}.axis-label{fill:var(--subtle);font-size:12px}.trend-line{fill:none;stroke:var(--brand);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.hit-area{fill:transparent;cursor:pointer}.trend-dot{fill:var(--brand);stroke:var(--surface);stroke-width:3;transition:r .14s ease}.trend-dot.selected{fill:var(--brand-2)}.trend-tooltip{display:grid;grid-template-columns:1fr auto auto;align-items:end;gap:10px;margin-top:5px;padding:12px 14px;border-radius:10px;background:var(--surface-tint)}.trend-tooltip div{display:flex;align-items:center;gap:8px}.trend-tooltip span{padding:2px 7px;border-radius:999px;color:var(--muted);background:var(--surface);font-size:11px}.trend-tooltip p{grid-column:1/-1;margin:0;color:var(--muted);font-size:12px}.trend-tooltip strong{color:var(--brand);font-size:26px;line-height:1}.trend-tooltip small{font-size:13px}.trend-tooltip em{color:var(--muted);font-size:12px;font-style:normal;white-space:nowrap}@media(max-width:600px){.trend-chart{padding:12px 8px 8px}.chart-svg{min-height:190px}.trend-tooltip{grid-template-columns:1fr auto;gap:8px}.trend-tooltip em{grid-column:1/-1}.axis-label{font-size:11px}}
</style>
