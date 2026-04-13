<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MainLayout from '@/components/common/MainLayout.vue'
import UserTreePicker from '@/components/common/UserTreePicker.vue'
import PmsDatePicker from '@/components/common/PmsDatePicker.vue'
import { devProgramService } from '@/services/devPrograms'
import { projectService } from '@/services/projects'
import VueApexCharts from 'vue3-apexcharts'

const route = useRoute()
const router = useRouter()
const projectId = Number(route.params.projectId)

const project = ref<any>(null)
const loading = ref(false)
const activeTab = ref('scurve')

// 기준일
const baseDate = ref(new Date().toISOString().substring(0, 10))

// 데이터
const trend = ref<any[]>([])
const totalPrograms = ref(0)
const byTask = ref<any[]>([])
const taskWeekNos = ref<number[]>([])
const taskTrend = ref<Record<string, number[]>>({})
const byDev = ref<any[]>([])
const summary = ref<any>(null)

// 주차 슬라이더
const baseWeekSlider = ref(1)

// 슬라이더 ↔ 기준일 동기화
function onSliderChange(weekNo: number) {
  baseWeekSlider.value = weekNo
  const w = trend.value.find(t => t.weekNo === weekNo)
  if (w) baseDate.value = w.weekEnd
}
function onDateChange(date: string) {
  baseDate.value = date
  // 날짜에 맞는 주차 찾기
  for (let i = 0; i < trend.value.length; i++) {
    if (trend.value[i].weekEnd >= date) { baseWeekSlider.value = trend.value[i].weekNo; return }
  }
  if (trend.value.length) baseWeekSlider.value = trend.value[trend.value.length - 1].weekNo
}

// 기준일 기반 통계
const baseStats = computed(() => {
  if (!trend.value.length || !totalPrograms.value) return { total: 0, planCount: 0, actualCount: 0, planRate: 0, actualRate: 0, achieveRate: 0 }
  const matched = trend.value.find(t => t.weekNo === baseWeekSlider.value) || trend.value[0]
  const planCount = matched?.planCount || 0
  const actualCount = matched?.actualCount || 0
  const planRate = matched?.planCumRate || 0
  const actualRate = matched?.actualCumRate || 0
  const achieveRate = planRate > 0 ? Math.round(actualRate / planRate * 1000) / 10 : 0
  return { total: totalPrograms.value, planCount, actualCount, planRate, actualRate, achieveRate }
})

const baseWeekIdx = computed(() => baseWeekSlider.value)

// trend 로드 후 슬라이더 초기 위치 설정
function initSlider() {
  if (!trend.value.length) return
  const bd = baseDate.value
  for (let i = 0; i < trend.value.length; i++) {
    if (trend.value[i].weekEnd >= bd) { baseWeekSlider.value = trend.value[i].weekNo; return }
  }
  baseWeekSlider.value = trend.value[trend.value.length - 1].weekNo
}

const baseWeekInfo = computed(() => trend.value.find(t => t.weekNo === baseWeekSlider.value))
const maxWeekNo = computed(() => trend.value.length ? trend.value[trend.value.length - 1].weekNo : 1)

// S-Curve 필터
const filterTask = ref('')
const filterDevUser = ref('')
const members = ref<any[]>([])

// 업무별 현황용 (별도 조회 불필요, byTask 그대로)

// 담당자별 필터
const filterTeam = ref('')
const teamOptions = computed(() => {
  const set = new Set<string>()
  byDev.value.forEach(d => { if (d.devTeam) set.add(d.devTeam) })
  return [{ title: '전체', value: '' }, ...Array.from(set).sort().map(t => ({ title: t, value: t }))]
})
const filteredByDev = computed(() => {
  if (!filterTeam.value) return byDev.value
  return byDev.value.filter(d => d.devTeam === filterTeam.value)
})

// S-Curve 차트
const chartOptions = computed(() => {
  // annotation x값은 category 문자열과 정확히 일치해야 함
  const cats = trend.value.map(t => `${t.weekNo}`)
  const annotX = cats[baseWeekIdx.value - 1] || cats[0] || '1'

  return {
    chart: { type: 'line' as const, height: 380, toolbar: { show: true }, zoom: { enabled: true } },
    stroke: { width: [3, 3], curve: 'smooth' as const },
    colors: ['#1E88E5', '#E53935'],
    xaxis: {
      categories: cats,
      title: { text: '주차', style: { fontSize: '11px' } },
      labels: { style: { fontSize: '10px' } },
    },
    yaxis: { title: { text: '누적 완료율 (%)', style: { fontSize: '11px' } }, min: 0, max: 100, labels: { style: { fontSize: '10px' }, formatter: (v: number) => `${v}%` } },
    legend: { position: 'top' as const, fontSize: '12px' },
    markers: { size: 3 },
    dataLabels: { enabled: true, style: { fontSize: '9px' }, formatter: (v: number) => v > 0 ? `${v}` : '' },
    tooltip: { shared: true, y: { formatter: (v: number) => `${v}%` } },
    annotations: {
      xaxis: [{
        x: annotX,
        borderColor: '#E53935',
        strokeDashArray: 0,
        borderWidth: 2,
        label: {
          text: `${baseWeekIdx.value}주 (${baseDate.value})`,
          borderColor: '#E53935',
          style: { color: '#fff', background: '#E53935', fontSize: '9px', padding: { left: 3, right: 3, top: 1, bottom: 1 } },
          orientation: 'horizontal',
          position: 'top',
        },
      }],
    },
  }
})
const chartSeries = computed(() => [
  { name: '계획', data: trend.value.map(t => t.planCumRate) },
  { name: '실적', data: trend.value.map(t => t.actualCumRate) },
])

// 업무별 막대 차트
const taskChartOptions = computed(() => ({
  chart: { type: 'bar' as const, height: 300, toolbar: { show: false } },
  plotOptions: { bar: { horizontal: true, barHeight: '60%' } },
  colors: ['#1E88E5', '#43A047'],
  xaxis: { max: 100, labels: { formatter: (v: number) => `${v}%` } },
  yaxis: { labels: { style: { fontSize: '11px' } } },
  legend: { position: 'top' as const },
  dataLabels: { enabled: true, style: { fontSize: '10px' }, formatter: (v: number) => `${v}%` },
}))
const taskChartSeries = computed(() => [
  { name: '전체 대비 완료율', data: byTask.value.map(t => t.doneRate) },
])
const taskChartCategories = computed(() => byTask.value.map(t => t.taskCode))

const taskOptions = computed(() => [{ title: '전체', value: '' }, ...byTask.value.map(t => ({ title: t.taskCode, value: t.taskCode }))])

async function fetchAll() {
  loading.value = true
  try {
    const [trendRes, taskRes, devRes, sumRes] = await Promise.all([
      devProgramService.getWeeklyTrend(projectId, {
        ...(filterTask.value ? { taskCode: filterTask.value } : {}),
        ...(filterDevUser.value ? { devUserId: filterDevUser.value } : {}),
      }),
      devProgramService.getStatsByTask(projectId),
      devProgramService.getStatsByDeveloper(projectId),
      devProgramService.getSummary(projectId),
    ])
    if (trendRes.success) { trend.value = trendRes.data; totalPrograms.value = trendRes.total || 0; initSlider() }
    if (taskRes.success) { byTask.value = taskRes.data; taskWeekNos.value = taskRes.weekNos || []; taskTrend.value = taskRes.taskTrend || {} }
    if (devRes.success) byDev.value = devRes.data
    if (sumRes.success) summary.value = sumRes.data
  } catch (err) { console.error(err) }
  finally { loading.value = false }
}

async function fetchTrend() {
  try {
    const params: any = {}
    if (filterTask.value) params.taskCode = filterTask.value
    if (filterDevUser.value) params.devUserId = filterDevUser.value
    const res = await devProgramService.getWeeklyTrend(projectId, params)
    if (res.success) { trend.value = res.data; totalPrograms.value = res.total || 0; initSlider() }
  } catch {}
}

function onScurveDevChange(userId: string) {
  filterDevUser.value = userId
  fetchTrend()
}

function clearScurveDev() {
  filterDevUser.value = ''
  fetchTrend()
}

watch(filterTask, fetchTrend)

onMounted(async () => {
  try {
    const [p, m] = await Promise.all([
      projectService.getDetail(projectId),
      projectService.getMembers(projectId).catch(() => null),
    ])
    if (p.success) project.value = p.data
    if (m?.success) members.value = m.data
  } catch {}
  fetchAll()
})
</script>

<template>
  <MainLayout>
    <v-row class="mb-1" align="center" dense>
      <v-col>
        <span class="pms-page-title">개발진척 현황</span>
        <span class="pms-page-subtitle">{{ project?.projectName }}</span>
      </v-col>
    </v-row>

    <!-- 기준일 -->
    <div class="d-flex align-center mb-2" style="gap:12px">
      <div style="width:160px">
        <PmsDatePicker v-model="baseDate" label="기준일" :allow-non-working="true" @update:model-value="onDateChange" />
      </div>
      <div v-if="baseWeekInfo" style="font-size:var(--pms-font-body); color:var(--pms-text-secondary)">
        {{ baseWeekSlider }}주차 ({{ baseWeekInfo.weekEnd }})
      </div>
    </div>
    <v-row dense class="mb-2">
      <v-col cols="6" md="3">
        <div class="stat-card">
          <div class="sc-pct">{{ baseStats.total.toLocaleString() }}본</div>
          <div class="sc-sub">&nbsp;</div>
          <div class="sc-label">전체 프로그램</div>
        </div>
      </v-col>
      <v-col cols="6" md="3">
        <div class="stat-card" style="border-left:3px solid #1E88E5">
          <div class="sc-pct" style="color:#1E88E5">{{ baseStats.planRate }}%</div>
          <div class="sc-sub">{{ baseStats.planCount.toLocaleString() }}본</div>
          <div class="sc-label">계획 (누적)</div>
        </div>
      </v-col>
      <v-col cols="6" md="3">
        <div class="stat-card" style="border-left:3px solid #E53935">
          <div class="sc-pct" style="color:#E53935">{{ baseStats.actualRate }}%</div>
          <div class="sc-sub">{{ baseStats.actualCount.toLocaleString() }}본</div>
          <div class="sc-label">실적 (누적)</div>
        </div>
      </v-col>
      <v-col cols="6" md="3">
        <div class="stat-card" style="border-left:3px solid #FB8C00">
          <div class="sc-pct" style="color:#FB8C00">{{ baseStats.achieveRate }}%</div>
          <div class="sc-sub">&nbsp;</div>
          <div class="sc-label">달성율 (계획 대비)</div>
        </div>
      </v-col>
    </v-row>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-1" />
      <div class="pms-card mb-3">
        <div class="pms-section-header">
          <v-icon size="14">mdi-chart-line</v-icon> 개발계획 대비 실적 현황 (S-Curve)
          <span style="font-size:var(--pms-font-caption); margin-left:8px; color:var(--pms-text-secondary)">전체 {{ totalPrograms }}본</span>
        </div>
        <div class="pa-3">
          <v-row dense class="mb-2" align="center">
            <v-col cols="6" md="3">
              <v-select v-model="filterTask" :items="taskOptions" label="업무" hide-details class="pms-filter" />
            </v-col>
            <v-col cols="6" md="3">
              <UserTreePicker :model-value="filterDevUser" @update:model-value="onScurveDevChange" :members="members" label="담당자" class="pms-filter" hide-details clearable />
            </v-col>
            <v-col cols="auto" v-if="filterDevUser">
              <v-btn size="x-small" variant="text" color="grey" @click="clearScurveDev">초기화</v-btn>
            </v-col>
          </v-row>
          <VueApexCharts v-if="trend.length" type="line" :options="chartOptions" :series="chartSeries" height="380" />
          <div v-else class="text-center pa-8" style="color:var(--pms-text-hint)">데이터가 없습니다.</div>
          <!-- 기준일 슬라이더 -->
          <div v-if="trend.length" class="px-2 pt-1 pb-0">
            <div class="d-flex align-center" style="gap:8px">
              <span style="font-size:var(--pms-font-caption); color:var(--pms-text-hint); white-space:nowrap">1주</span>
              <v-slider
                v-model="baseWeekSlider"
                :min="1"
                :max="maxWeekNo"
                :step="1"
                color="error"
                track-color="grey-lighten-2"
                thumb-color="error"
                thumb-label
                thumb-size="14"
                hide-details
                density="compact"
                @update:model-value="onSliderChange"
                class="base-slider"
              />
              <span style="font-size:var(--pms-font-caption); color:var(--pms-text-hint); white-space:nowrap">{{ maxWeekNo }}주</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 주차별 데이터 테이블 -->
      <div class="pms-card mb-3" v-if="trend.length">
        <div class="pms-section-header"><v-icon size="14">mdi-table</v-icon> 주차별 계획/실적 (건수 / 누적률%)</div>
        <div style="overflow-x:auto">
          <table class="pms-table" style="width:100%">
            <thead><tr><th style="width:50px">주차</th><th v-for="t in trend" :key="'h'+t.weekNo" class="text-center" style="min-width:50px">{{ t.weekNo }}</th></tr></thead>
            <tbody>
              <tr><td style="font-weight:600; color:#1E88E5">계획</td><td v-for="t in trend" :key="'p'+t.weekNo" class="text-center">{{ t.planCount }}<br/><span style="font-size:8px; color:#999">{{ t.planCumRate }}%</span></td></tr>
              <tr><td style="font-weight:600; color:#E53935">실적</td><td v-for="t in trend" :key="'a'+t.weekNo" class="text-center">{{ t.actualCount }}<br/><span style="font-size:8px; color:#999">{{ t.actualCumRate }}%</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
  </MainLayout>
</template>

<style scoped>
.stat-card { background: var(--pms-surface); border: 1px solid var(--pms-border); border-radius: var(--pms-radius); padding: 8px 12px; border-left: 3px solid var(--pms-border); }
.base-slider :deep(.v-slider-thumb__label) { font-size: 9px !important; min-width: 20px; height: 18px; padding: 0 3px; }
.sc-pct { font-size: 22px; font-weight: 700; line-height: 1.2; }
.sc-sub { font-size: 12px; color: var(--pms-text-secondary); font-weight: 500; }
.sc-label { font-size: var(--pms-font-caption); color: var(--pms-text-hint); margin-top: 2px; }
</style>
