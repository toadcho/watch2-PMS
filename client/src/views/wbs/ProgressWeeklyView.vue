<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MainLayout from '@/components/common/MainLayout.vue'
import { projectService } from '@/services/projects'
import api from '@/services/api'
import VueApexCharts from 'vue3-apexcharts'

const route = useRoute()
const router = useRouter()
const projectId = Number(route.params.projectId)

const project = ref<any>(null)
const data = ref<any>(null)
const loading = ref(false)
const expandedBiz = reactive<Record<string, boolean>>({})

const BIZ_COLORS = ['#1976D2','#2E7D32','#E65100','#7B1FA2','#C62828','#00838F','#AD1457','#4E342E','#37474F','#558B2F']

async function fetchData() {
  loading.value = true
  try {
    const [projRes, weeklyRes] = await Promise.all([
      projectService.getDetail(projectId),
      api.get(`/projects/${projectId}/wbs/progress-weekly`),
    ])
    if (projRes.success) project.value = projRes.data
    if (weeklyRes.data.success) data.value = weeklyRes.data.data
  } catch (err) { console.error(err) }
  finally { loading.value = false }
}

const currentWeekIdx = computed(() => {
  if (!data.value?.weeks) return -1
  const today = new Date().toISOString().substring(0, 10)
  return data.value.weeks.findIndex((w: any) => w.date >= today)
})
const currentWeekNo = computed(() => {
  if (!data.value?.projectStart) return 0
  return Math.max(1, Math.ceil((new Date().getTime() - new Date(data.value.projectStart).getTime()) / (7 * 24 * 60 * 60 * 1000)))
})

// 전체 프로젝트 현재 계획/실적 (오늘 이전 마지막 주차 기준)
const currentWeekData = computed(() => {
  if (!data.value?.weeks) return null
  const today = new Date().toISOString().substring(0, 10)
  let last = null
  for (const w of data.value.weeks) {
    if (w.date <= today) last = w
    else break
  }
  return last || data.value.weeks[0]
})
const totalCurrentPlan = computed(() => currentWeekData.value?.plan || 0)
const totalCurrentActual = computed(() => currentWeekData.value?.actual || 0)
const totalDiff = computed(() => Math.round((totalCurrentActual.value - totalCurrentPlan.value) * 10) / 10)

function toggleBiz(code: string) { expandedBiz[code] = !expandedBiz[code] }
function diffColor(d: number) { return d > 0 ? 'var(--pms-success)' : d < 0 ? 'var(--pms-error)' : 'var(--pms-text-secondary)' }
function diffIcon(d: number) { return d > 0 ? '▲' : d < 0 ? '▼' : '' }

// ── ApexCharts: 전체 S-Curve ──
const mainChartOptions = computed(() => {
  const weeks = data.value?.weeks || []
  const cats = weeks.map((_: any, i: number) => `${i + 1}`)
  const curIdx = currentWeekIdx.value
  const annotX = curIdx >= 0 ? cats[curIdx] : cats[0]
  const curDate = curIdx >= 0 ? weeks[curIdx]?.date?.substring(5) || '' : ''

  return {
    chart: { type: 'line' as const, height: 380, toolbar: { show: true }, zoom: { enabled: true } },
    stroke: { width: [3, 3], curve: 'smooth' as const },
    colors: ['#1E88E5', '#E53935'],
    xaxis: {
      categories: cats,
      title: { text: '주차', style: { fontSize: '11px' } },
      labels: { style: { fontSize: '10px' }, rotate: 0,
        formatter: (v: string) => {
          const n = parseInt(v)
          if (weeks.length <= 20) return v
          if (n % Math.ceil(weeks.length / 20) === 0 || n === weeks.length) return v
          return ''
        },
      },
    },
    yaxis: { title: { text: '누적 진척률 (%)', style: { fontSize: '11px' } }, min: 0, max: 100, labels: { style: { fontSize: '10px' }, formatter: (v: number) => `${v}%` } },
    legend: { position: 'top' as const, fontSize: '12px' },
    markers: { size: weeks.length > 30 ? 0 : 3 },
    dataLabels: {
      enabled: weeks.length <= 30,
      style: { fontSize: '9px' },
      formatter: (v: number) => v > 0 ? `${v}` : '',
    },
    tooltip: { shared: true, y: { formatter: (v: number) => `${v}%` } },
    annotations: annotX ? {
      xaxis: [{
        x: annotX,
        borderColor: '#E53935',
        strokeDashArray: 0,
        borderWidth: 2,
        label: {
          text: `${curIdx + 1}주 (${curDate})`,
          borderColor: '#E53935',
          style: { color: '#fff', background: '#E53935', fontSize: '9px', padding: { left: 3, right: 3, top: 1, bottom: 1 } },
          orientation: 'horizontal',
          position: 'top',
        },
      }],
    } : {},
  }
})
const mainChartSeries = computed(() => {
  const weeks = data.value?.weeks || []
  return [
    { name: '계획', data: weeks.map((w: any) => w.plan) },
    { name: '실적', data: weeks.map((w: any) => w.actual) },
  ]
})

// ── ApexCharts: 업무별 S-Curve ──
function bizChartOptions(biz: any, colorIdx: number) {
  const weeks = biz.weeks || []
  const cats = weeks.map((_: any, i: number) => `${i + 1}`)
  const color = BIZ_COLORS[colorIdx % BIZ_COLORS.length]
  return {
    chart: { type: 'line' as const, height: 260, toolbar: { show: false }, zoom: { enabled: false } },
    stroke: { width: [2, 2.5], curve: 'smooth' as const },
    colors: [color, '#E53935'],
    xaxis: {
      categories: cats,
      labels: { style: { fontSize: '9px' }, rotate: 0,
        formatter: (v: string) => {
          const n = parseInt(v)
          if (weeks.length <= 15) return v
          if (n % Math.ceil(weeks.length / 15) === 0 || n === weeks.length) return v
          return ''
        },
      },
    },
    yaxis: { min: 0, max: 100, labels: { style: { fontSize: '9px' }, formatter: (v: number) => `${v}%` } },
    legend: { show: false },
    markers: { size: weeks.length > 20 ? 0 : 2 },
    dataLabels: { enabled: false },
    tooltip: { shared: true, y: { formatter: (v: number) => `${v}%` } },
  }
}
function bizChartSeries(biz: any) {
  const weeks = biz.weeks || []
  return [
    { name: '계획', data: weeks.map((w: any) => w.plan) },
    { name: '실적', data: weeks.map((w: any) => w.actual) },
  ]
}

onMounted(fetchData)
</script>

<template>
  <MainLayout>
    <v-row class="mb-1" align="center" dense>
      <v-col>
        <span class="pms-page-title">공정 진척현황</span>
        <span class="pms-page-subtitle">{{ project?.projectName }}</span>
      </v-col>
      <v-col cols="auto" v-if="data" class="d-flex align-center ga-1">
        <v-chip variant="outlined" size="small">{{ data.projectStart }} ~ {{ data.projectEnd }}</v-chip>
        <v-chip variant="tonal" size="small" color="primary"><v-icon size="12" start>mdi-calendar-week</v-icon>{{ currentWeekNo }}주차</v-chip>
        <v-chip variant="outlined" size="small">전체 {{ data.totalCount }}주</v-chip>
      </v-col>
    </v-row>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

    <template v-if="data">
      <!-- ===== 전체 프로젝트 S-Curve ===== -->
      <div class="pms-card mb-3">
        <div class="pms-section-header d-flex align-center">
          <v-icon size="14">mdi-chart-line</v-icon> 전체 프로젝트 진척추이 (S-Curve)
          <span style="font-size:var(--pms-font-caption); margin-left:8px; color:var(--pms-text-secondary)">전체 {{ data.totalCount }}주</span>
          <v-spacer />
          <div class="biz-sum">
            <span class="bs"><span class="bs-lb">계획</span><span class="bs-v" style="color:var(--pms-primary)">{{ totalCurrentPlan }}%</span></span>
            <span class="bs"><span class="bs-lb">실적</span><span class="bs-v" style="color:var(--pms-success)">{{ totalCurrentActual }}%</span></span>
            <span class="bs"><span class="bs-lb">차이</span><span class="bs-v" :style="{color:diffColor(totalDiff)}">{{ totalDiff>0?'+':'' }}{{ totalDiff }}%<span style="font-size:8px;margin-left:1px">{{ diffIcon(totalDiff) }}</span></span></span>
            <div class="bs-minibar"><div class="bs-mb-plan" :style="{width:Math.min(100,totalCurrentPlan)+'%'}"></div><div class="bs-mb-actual" :style="{width:Math.min(100,totalCurrentActual)+'%'}"></div></div>
          </div>
        </div>
        <div class="pa-3">
          <VueApexCharts v-if="data.weeks?.length" type="line" :options="mainChartOptions" :series="mainChartSeries" height="380" />
          <div v-else class="text-center pa-8" style="color:var(--pms-text-hint)">데이터가 없습니다.</div>
        </div>
      </div>

      <!-- 주차별 데이터 테이블 -->
      <div class="pms-card mb-3" v-if="data.weeks?.length">
        <div class="pms-section-header"><v-icon size="14">mdi-table</v-icon> 주차별 계획/실적</div>
        <div style="overflow-x:auto">
          <table class="pms-table" style="width:100%">
            <thead>
              <tr>
                <th style="width:50px; position:sticky; left:0; background:var(--pms-surface-variant); z-index:2">주차</th>
                <th v-for="(wk, i) in data.weeks" :key="'wh'+i" class="text-center" :class="{ 'cur-week-col': i === currentWeekIdx }" style="min-width:54px">{{ i + 1 }}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-weight:600; color:#1E88E5; position:sticky; left:0; background:var(--pms-surface); z-index:1">계획</td>
                <td v-for="(wk, i) in data.weeks" :key="'wp'+i" class="text-center" :class="{ 'cur-week-col': i === currentWeekIdx }">
                  {{ wk.plan }}<br/><span style="font-size:8px; color:#999">{{ wk.plan }}%</span>
                </td>
              </tr>
              <tr>
                <td style="font-weight:600; color:#E53935; position:sticky; left:0; background:var(--pms-surface); z-index:1">실적</td>
                <td v-for="(wk, i) in data.weeks" :key="'wa'+i" class="text-center" :class="{ 'cur-week-col': i === currentWeekIdx }">
                  {{ wk.actual || '-' }}<br/><span style="font-size:8px; color:#999">{{ wk.actual || 0 }}%</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ===== 업무별 공정현황 ===== -->
      <div class="pms-section-header mb-2"><v-icon size="14">mdi-briefcase</v-icon>업무별 공정현황</div>

      <div v-for="(biz, bi) in data.businesses" :key="biz.wbsCode" class="pms-card mb-2">
        <div class="biz-hd" @click="toggleBiz(biz.wbsCode)">
          <v-icon size="14" class="mr-1">{{ expandedBiz[biz.wbsCode] ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
          <span class="biz-dot" :style="{ background: BIZ_COLORS[bi % BIZ_COLORS.length] }"></span>
          <span class="biz-code">{{ biz.wbsCode }}</span>
          <span class="biz-nm ml-1">{{ biz.taskName }}</span>
          <v-chip size="x-small" variant="text" color="secondary" class="ml-1">{{ biz.taskCount }}건</v-chip>
          <v-spacer />
          <div class="biz-sum">
            <span class="bs"><span class="bs-lb">계획</span><span class="bs-v" style="color:var(--pms-primary)">{{ biz.currentPlan }}%</span></span>
            <span class="bs"><span class="bs-lb">실적</span><span class="bs-v" style="color:var(--pms-success)">{{ biz.currentActual }}%</span></span>
            <span class="bs"><span class="bs-lb">차이</span><span class="bs-v" :style="{color:diffColor(biz.diff)}">{{ biz.diff>0?'+':'' }}{{ biz.diff }}%<span style="font-size:8px;margin-left:1px">{{ diffIcon(biz.diff) }}</span></span></span>
            <div class="bs-minibar"><div class="bs-mb-plan" :style="{width:Math.min(100,biz.currentPlan)+'%'}"></div><div class="bs-mb-actual" :style="{width:Math.min(100,biz.currentActual)+'%'}"></div></div>
          </div>
        </div>
        <div v-if="expandedBiz[biz.wbsCode]" style="border-top:1px solid var(--pms-border-light)">
          <div class="pa-3">
            <VueApexCharts v-if="biz.weeks?.length" type="line" :options="bizChartOptions(biz, bi)" :series="bizChartSeries(biz)" height="260" />
          </div>
          <!-- 업무별 주차 테이블 -->
          <div v-if="biz.weeks?.length" style="overflow-x:auto; border-top:1px solid var(--pms-border-light)">
            <table class="pms-table" style="width:100%">
              <thead>
                <tr>
                  <th style="width:50px; position:sticky; left:0; background:var(--pms-surface-variant); z-index:2">주차</th>
                  <th v-for="(wk, i) in biz.weeks" :key="'bwh'+i" class="text-center" :class="{ 'cur-week-col': i === currentWeekIdx }" style="min-width:50px">{{ i + 1 }}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="font-weight:600; color:#1E88E5; position:sticky; left:0; background:var(--pms-surface); z-index:1">계획</td>
                  <td v-for="(wk, i) in biz.weeks" :key="'bwp'+i" class="text-center" :class="{ 'cur-week-col': i === currentWeekIdx }">
                    {{ wk.plan }}<br/><span style="font-size:8px; color:#999">{{ wk.plan }}%</span>
                  </td>
                </tr>
                <tr>
                  <td style="font-weight:600; color:#E53935; position:sticky; left:0; background:var(--pms-surface); z-index:1">실적</td>
                  <td v-for="(wk, i) in biz.weeks" :key="'bwa'+i" class="text-center" :class="{ 'cur-week-col': i === currentWeekIdx }">
                    {{ wk.actual || '-' }}<br/><span style="font-size:8px; color:#999">{{ wk.actual || 0 }}%</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </MainLayout>
</template>

<style scoped>
.biz-hd { display:flex; align-items:center; padding:8px 12px; cursor:pointer; user-select:none; transition:background 0.15s; }
.biz-hd:hover { background:var(--pms-hover, #f5f5f5); }
.biz-dot { width:8px; height:8px; border-radius:50%; margin-right:4px; flex-shrink:0; }
.biz-code { font-size:var(--pms-font-caption); font-weight:700; color:var(--pms-primary); font-family:'Roboto Mono',monospace; }
.biz-nm { font-size:var(--pms-font-body); font-weight:600; }
.biz-sum { display:flex; align-items:center; gap:8px; }
.bs { display:flex; flex-direction:column; align-items:center; }
.bs-lb { font-size:7px; color:var(--pms-text-hint); line-height:1; }
.bs-v { font-size:var(--pms-font-body); font-weight:700; font-variant-numeric:tabular-nums; line-height:1.2; }
.bs-minibar { width:60px; position:relative; height:8px; background:var(--pms-border-light); border-radius:4px; overflow:hidden; }
.bs-mb-plan { position:absolute; top:0; left:0; height:100%; background:rgba(25,118,210,0.2); border-radius:4px; }
.bs-mb-actual { position:absolute; top:1px; left:0; height:6px; background:var(--pms-success); border-radius:3px; }
.cur-week-col { background:rgba(255,160,0,0.08); }
</style>
