<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import PmsDatePicker from '@/components/common/PmsDatePicker.vue'
import { reportService } from '@/services/reports'
import { projectService } from '@/services/projects'
import { useDialog } from '@/composables/useDialog'
import VueApexCharts from 'vue3-apexcharts'

const { showAlert, showConfirm } = useDialog()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)

const project = ref<any>(null)
const myRole = ref<any>(null)
const isPmsAdmin = computed(() => myRole.value?.isPmsAdmin || false)

// 내 팀만 보기 스위치
const myTeamOnly = ref(true)
const myDepartment = computed(() => authStore.user?.department || '')

// 팀 필터된 섹션
const visibleSections = computed(() => {
  if (!selectedReport.value?.sections) return []
  if (myTeamOnly.value && myDepartment.value) {
    return selectedReport.value.sections.filter((s: any) => s.teamName === myDepartment.value)
  }
  return selectedReport.value.sections
})

// 내 팀 진척률
const myTeamProgress = computed(() => {
  const all = selectedReport.value?.autoContent?.teamProgress || []
  if (!myDepartment.value) return null
  return all.find((t: any) => t.teamName === myDepartment.value) || null
})

// 업무별 진척률: PMS관리자는 전체, 일반 사용자는 본인 팀 업무만
const visibleBizProgress = computed(() => {
  const all = selectedReport.value?.autoContent?.bizProgress || []
  if (!all.length) return []
  if (isPmsAdmin.value) return all
  // 일반 사용자: 본인 팀 섹션의 teamName과 일치하는 업무만
  // sections에서 본인 팀 찾기
  const mySections = (selectedReport.value?.sections || []).filter((s: any) => s.teamName === myDepartment.value)
  if (!mySections.length) return all // 매칭 안 되면 전체 표시
  // WBS depth2 업무와 팀 매핑이 직접적이지 않으므로, 본인 팀 이름이 포함된 업무 찾기
  // 간단 접근: myTeamOnly ON이면 필터링, OFF면 전체
  if (myTeamOnly.value) return [] // 내 팀만 보기 시 업무별은 숨김 (본인 팀 실적만 표시)
  return all
})

// 목록 상태
const reports = ref<any[]>([])
const loading = ref(false)
const selectedReport = ref<any>(null)
const detailLoading = ref(false)

// 필터
const filterType = ref('')
const filterStatus = ref('')

// 생성 다이얼로그
const createDialog = ref(false)
const createForm = ref<any>({ reportType: 'weekly', title: '', periodStart: '', periodEnd: '', nextStart: '', nextEnd: '', selectedTeams: [] as string[] })

// 투입인력 팀 목록
const teamList = ref<string[]>([])
const members = ref<any[]>([])

// 보고서 표시 모드
const viewMode = ref<'list' | 'detail' | 'preview'>('list')

// 섹션 편집
const editingSectionId = ref<number | null>(null)
const sectionForm = ref<any>({ currentTasks: [], nextTasks: [], issues: '', achievements: '', plans: '', currentRemark: '', nextRemark: '' })

// 인라인 날짜 피커 (PmsDatePicker 활용)
const rptDatePickerRef = ref<any>(null)
const rptDateTarget = ref<{ task: any; field: string } | null>(null)
const rptDateValue = ref('')

function openRptDate(task: any, field: string) {
  rptDateTarget.value = { task, field }
  rptDateValue.value = task[field] || ''
  nextTick(() => rptDatePickerRef.value?.openPicker())
}
function onRptDateSelect(val: string) {
  if (rptDateTarget.value) rptDateTarget.value.task[rptDateTarget.value.field] = val
  rptDateValue.value = val
}

// 총괄소견 편집
const editingSummary = ref(false)
const summaryForm = ref('')

const typeLabels: Record<string, string> = { weekly: '주간보고', monthly: '월간보고' }
const typeItems = [
  { title: '전체', value: '' },
  { title: '주간보고', value: 'weekly' },
  { title: '월간보고', value: 'monthly' },
]
const statusItems = [
  { title: '전체', value: '' },
  { title: '생성', value: '생성' },
  { title: '작성요청', value: '작성요청' },
  { title: '작성중', value: '작성중' },
  { title: '검토', value: '검토' },
  { title: '완료', value: '완료' },
]

const statusColor: Record<string, string> = {
  '생성': 'grey', '작성요청': 'info', '작성중': 'warning', '검토': 'purple', '완료': 'success',
}
const sectionStatusColor: Record<string, string> = { '미작성': 'grey', '작성중': 'warning', '작성완료': 'success' }

const isWeeklyOrMonthly = computed(() => selectedReport.value && ['weekly', 'monthly'].includes(selectedReport.value.reportType))
const periodLabel = computed(() => selectedReport.value?.reportType === 'weekly' ? '금주' : '금월')
const nextPeriodLabel = computed(() => selectedReport.value?.reportType === 'weekly' ? '차주' : '차월')
const sectionProgress = computed(() => {
  if (!selectedReport.value?.sections?.length) return { done: 0, total: 0, pct: 0 }
  const total = selectedReport.value.sections.length
  const done = selectedReport.value.sections.filter((s: any) => s.status === '작성완료').length
  return { done, total, pct: total ? Math.round(done / total * 100) : 0 }
})
const isCompleted = computed(() => selectedReport.value?.status === '완료')

function isMySection(section: any) {
  return section.writerId === authStore.user?.userId || section.teamName === myDepartment.value
}

// ── 목록 ──
async function fetchList() {
  loading.value = true
  try {
    const params: any = {}
    if (filterType.value) params.reportType = filterType.value
    if (filterStatus.value) params.status = filterStatus.value
    const res = await reportService.getList(projectId, params)
    if (res.success) reports.value = res.data
  } catch (err) { console.error(err) }
  finally { loading.value = false }
}

async function selectReport(item: any) {
  detailLoading.value = true
  try {
    const res = await reportService.getDetail(projectId, item.reportId)
    if (res.success) { selectedReport.value = res.data; viewMode.value = 'detail' }
  } catch (err: any) { showAlert(err?.response?.data?.message || '상세 조회 실패', { color: 'error' }) }
  finally { detailLoading.value = false }
}

function backToList() {
  viewMode.value = 'list'; selectedReport.value = null
  editingSectionId.value = null; editingSummary.value = false
}

// ── 생성 ──
function openCreate() {
  // 기본 금주: 이번 주 월~일
  const now = new Date()
  const day = now.getDay()
  const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  const nMon = new Date(sun); nMon.setDate(sun.getDate() + 1)
  const nSun = new Date(nMon); nSun.setDate(nMon.getDate() + 6)
  const fmt = (d: Date) => d.toISOString().substring(0, 10)
  createForm.value = {
    reportType: 'weekly',
    title: '주간보고',
    periodStart: fmt(mon), periodEnd: fmt(sun),
    nextStart: fmt(nMon), nextEnd: fmt(nSun),
    selectedTeams: [...teamList.value],
  }
  createDialog.value = true
}

function onTypeChange() {
  const t = createForm.value.reportType
  createForm.value.title = typeLabels[t] || '보고서'
  if (t === 'monthly') {
    const now = new Date()
    const y = now.getFullYear(), m = now.getMonth()
    const start = new Date(y, m, 1)
    const end = new Date(y, m + 1, 0)
    const nStart = new Date(y, m + 1, 1)
    const nEnd = new Date(y, m + 2, 0)
    const fmt = (d: Date) => d.toISOString().substring(0, 10)
    createForm.value.periodStart = fmt(start); createForm.value.periodEnd = fmt(end)
    createForm.value.nextStart = fmt(nStart); createForm.value.nextEnd = fmt(nEnd)
  }
}

async function createReport() {
  if (!createForm.value.title) { await showAlert('제목을 입력하세요.', { color: 'error' }); return }
  try {
    const res = await reportService.create(projectId, createForm.value)
    if (res.success) {
      createDialog.value = false; await fetchList()
      selectedReport.value = res.data; viewMode.value = 'detail'
      await showAlert('보고서가 생성되었습니다.')
    }
  } catch (err: any) { showAlert(err?.response?.data?.message || '생성 실패', { color: 'error' }) }
}

async function deleteReport() {
  if (!(await showConfirm('보고서를 삭제하시겠습니까?'))) return
  try {
    await reportService.remove(projectId, selectedReport.value.reportId)
    await showAlert('삭제되었습니다.'); backToList(); fetchList()
  } catch (err: any) { showAlert(err?.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

// ── 워크플로 ──
async function requestWrite() {
  if (!(await showConfirm('각 팀에 작성 요청을 발송하시겠습니까?'))) return
  try {
    const res = await reportService.requestWrite(projectId, selectedReport.value.reportId)
    if (res.success) { selectedReport.value = res.data; fetchList(); await showAlert('작성 요청이 발송되었습니다.') }
  } catch (err: any) { showAlert(err?.response?.data?.message || '실패', { color: 'error' }) }
}

async function consolidate() {
  if (!(await showConfirm('취합하시겠습니까? 자동 수집 데이터도 최신화됩니다.'))) return
  try {
    const res = await reportService.consolidate(projectId, selectedReport.value.reportId)
    if (res.success) { selectedReport.value = res.data; fetchList(); await showAlert('취합 완료') }
  } catch (err: any) { showAlert(err?.response?.data?.message || '실패', { color: 'error' }) }
}

async function completeReport() {
  if (!(await showConfirm('최종 완료 처리하시겠습니까?'))) return
  try {
    const res = await reportService.complete(projectId, selectedReport.value.reportId)
    if (res.success) { selectedReport.value = res.data; fetchList(); await showAlert('최종 완료') }
  } catch (err: any) { showAlert(err?.response?.data?.message || '실패', { color: 'error' }) }
}

async function refreshData() {
  try {
    const res = await reportService.refresh(projectId, selectedReport.value.reportId)
    if (res.success) { selectedReport.value = res.data; await showAlert('데이터가 갱신되었습니다.') }
  } catch (err: any) { showAlert(err?.response?.data?.message || '실패', { color: 'error' }) }
}

// ── 섹션 편집 ──
function ensureScheduleFields(tasks: any[]) {
  for (const t of tasks) {
    if (!t.scheduleStart && t.schedule) {
      const parts = t.schedule.split('~')
      if (parts.length === 2) {
        // MM/DD format → guess year from context
        t.scheduleStart = t.scheduleStart || ''
        t.scheduleEnd = t.scheduleEnd || ''
      }
    }
    if (!t.status) t.status = '진행중'
  }
}

function startEditSection(section: any) {
  editingSectionId.value = section.sectionId
  const cur = JSON.parse(JSON.stringify(section.currentTasks || []))
  const nxt = JSON.parse(JSON.stringify(section.nextTasks || []))
  ensureScheduleFields(cur)
  ensureScheduleFields(nxt)
  sectionForm.value = {
    currentTasks: cur,
    nextTasks: nxt,
    issues: section.issues || '',
    achievements: section.achievements || '',
    plans: section.plans || '',
    currentRemark: (section as any).currentRemark || '',
    nextRemark: (section as any).nextRemark || '',
  }
}

function cancelEditSection() { editingSectionId.value = null }

function addCurrentTask() {
  sectionForm.value.currentTasks.push({ taskId: null, taskName: '', content: '', schedule: '', status: '진행중' })
}
function removeCurrentTask(idx: number) { sectionForm.value.currentTasks.splice(idx, 1) }
function addNextTask() {
  sectionForm.value.nextTasks.push({ taskId: null, taskName: '', content: '', schedule: '', status: '진행중' })
}
function removeNextTask(idx: number) { sectionForm.value.nextTasks.splice(idx, 1) }

function syncSchedule(tasks: any[]) {
  for (const t of tasks) {
    if (t.scheduleStart || t.scheduleEnd) {
      const s = t.scheduleStart ? fmtShortDate(t.scheduleStart) : ''
      const e = t.scheduleEnd ? fmtShortDate(t.scheduleEnd) : ''
      t.schedule = s && e ? `${s}~${e}` : s || e
    }
  }
}

async function saveSectionDraft(section: any) {
  try {
    syncSchedule(sectionForm.value.currentTasks)
    syncSchedule(sectionForm.value.nextTasks)
    const body: any = {
      currentTasks: sectionForm.value.currentTasks,
      nextTasks: sectionForm.value.nextTasks,
      issues: sectionForm.value.issues,
      achievements: sectionForm.value.achievements,
      plans: sectionForm.value.plans,
      currentRemark: sectionForm.value.currentRemark,
      nextRemark: sectionForm.value.nextRemark,
      status: '작성중',
    }
    const res = await reportService.updateSection(projectId, selectedReport.value.reportId, section.sectionId, body)
    if (res.success) {
      await selectReport(selectedReport.value)
      await showAlert('임시저장 되었습니다.')
    }
  } catch (err: any) { showAlert(err?.response?.data?.message || '저장 실패', { color: 'error' }) }
}

async function saveSectionComplete(section: any) {
  if (!(await showConfirm('작성을 완료하시겠습니까?\n완료 후에는 관리자에게 알림이 발송됩니다.'))) return
  try {
    syncSchedule(sectionForm.value.currentTasks)
    syncSchedule(sectionForm.value.nextTasks)
    const body: any = {
      currentTasks: sectionForm.value.currentTasks,
      nextTasks: sectionForm.value.nextTasks,
      issues: sectionForm.value.issues,
      achievements: sectionForm.value.achievements,
      plans: sectionForm.value.plans,
      currentRemark: sectionForm.value.currentRemark,
      nextRemark: sectionForm.value.nextRemark,
      status: '작성완료',
    }
    const res = await reportService.updateSection(projectId, selectedReport.value.reportId, section.sectionId, body)
    if (res.success) {
      editingSectionId.value = null
      await selectReport(selectedReport.value)
      await showAlert('작성완료 되었습니다.')
    }
  } catch (err: any) { showAlert(err?.response?.data?.message || '저장 실패', { color: 'error' }) }
}

// ── 총괄소견 ──
function startEditSummary() { summaryForm.value = selectedReport.value?.summaryNote || ''; editingSummary.value = true }
async function saveSummary() {
  try {
    const res = await reportService.update(projectId, selectedReport.value.reportId, { summaryNote: summaryForm.value })
    if (res.success) { selectedReport.value = res.data; editingSummary.value = false; await showAlert('저장되었습니다.') }
  } catch (err: any) { showAlert(err?.response?.data?.message || '저장 실패', { color: 'error' }) }
}

function openPreview() { viewMode.value = 'preview' }

async function downloadDocx() {
  if (!selectedReport.value) return
  try {
    await reportService.exportDocx(projectId, selectedReport.value.reportId, selectedReport.value.title)
  } catch (err: any) { showAlert('DOCX 다운로드 실패', { color: 'error' }) }
}
function closePreview() { viewMode.value = 'detail' }

function fmtDate(d: string | null) { return d ? d.substring(0, 10) : '-' }
function fmtDT(d: string | null) { return d ? new Date(d).toLocaleString('ko-KR') : '-' }
function fmtShortDate(d: string | null) {
  if (!d) return ''
  const dt = d.substring(0, 10)
  return dt.substring(5).replace('-', '/')
}

function getLevelColor(l: string) {
  const c: Record<string, string> = { '높음': 'error', '중간': 'warning', '낮음': 'success', '상': 'error', '중': 'warning', '하': 'success' }
  return c[l] || 'grey'
}

// S-Curve 차트
const scurveChartOptions = computed(() => {
  const weeks = selectedReport.value?.autoContent?.scurveWeeks || []
  const cats = weeks.map((w: any) => `${w.weekNo}`)
  // 현재 주차 찾기
  const today = new Date().toISOString().substring(0, 10)
  let curWeekNo = ''
  for (const w of weeks) { if (w.date <= today) curWeekNo = `${w.weekNo}`; else break }
  return {
    chart: { type: 'line' as const, height: 300, toolbar: { show: true }, zoom: { enabled: true } },
    stroke: { width: [3, 3], curve: 'smooth' as const },
    colors: ['#1E88E5', '#E53935'],
    xaxis: {
      categories: cats,
      title: { text: '주차', style: { fontSize: '11px' } },
      labels: { style: { fontSize: '9px' }, rotate: 0,
        formatter: (v: string) => { const n = parseInt(v); if (weeks.length <= 20) return v; if (n % Math.ceil(weeks.length / 20) === 0 || n === weeks.length) return v; return '' },
      },
    },
    yaxis: { title: { text: '누적 진척률 (%)', style: { fontSize: '11px' } }, min: 0, max: 100, labels: { style: { fontSize: '9px' }, formatter: (v: number) => `${v}%` } },
    legend: { position: 'top' as const, fontSize: '11px' },
    markers: { size: weeks.length > 30 ? 0 : 2 },
    dataLabels: { enabled: false },
    tooltip: { shared: true, y: { formatter: (v: number) => `${v}%` } },
    annotations: curWeekNo ? { xaxis: [{ x: curWeekNo, borderColor: '#E53935', strokeDashArray: 0, borderWidth: 2,
      label: { text: `현재 ${curWeekNo}주`, borderColor: '#E53935', style: { color: '#fff', background: '#E53935', fontSize: '9px', padding: { left: 3, right: 3, top: 1, bottom: 1 } }, orientation: 'horizontal', position: 'top' },
    }] } : {},
  }
})
const scurveChartSeries = computed(() => {
  const weeks = selectedReport.value?.autoContent?.scurveWeeks || []
  return [
    { name: '계획', data: weeks.map((w: any) => w.plan) },
    { name: '실적', data: weeks.map((w: any) => w.actual) },
  ]
})

onMounted(async () => {
  try {
    const [p, r, m] = await Promise.all([
      projectService.getDetail(projectId),
      projectService.getMyRole(projectId).catch(() => null),
      projectService.getMembers(projectId).catch(() => null),
    ])
    if (p.success) project.value = p.data
    if (r?.success) myRole.value = r.data
    if (m?.success) {
      members.value = m.data
      const set = new Set<string>()
      m.data.forEach((mb: any) => { const dept = mb.user?.department || mb.department || '미지정'; set.add(dept) })
      teamList.value = Array.from(set).sort()
    }
  } catch {}
  fetchList()
})
</script>

<template>
  <MainLayout>
    <!-- 헤더 -->
    <v-row class="mb-1" align="center" dense>
      <v-col cols="auto">
        <v-btn icon size="small" variant="text" @click="viewMode === 'list' ? router.push(`/projects/${projectId}`) : (viewMode === 'preview' ? closePreview() : backToList())">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
      </v-col>
      <v-col>
        <span class="pms-page-title">보고서 관리</span>
        <span class="pms-page-subtitle">{{ project?.projectName }}</span>
      </v-col>
    </v-row>

    <!-- ============================================================ -->
    <!-- 목록 모드 -->
    <!-- ============================================================ -->
    <template v-if="viewMode === 'list'">
      <v-row class="mb-1" dense align="center">
        <v-col cols="6" md="2">
          <v-select v-model="filterType" :items="typeItems" label="유형" hide-details class="pms-filter" @update:model-value="fetchList" />
        </v-col>
        <v-col cols="6" md="2">
          <v-select v-model="filterStatus" :items="statusItems" label="상태" hide-details class="pms-filter" @update:model-value="fetchList" />
        </v-col>
        <v-col cols="auto" class="ml-auto">
          <v-btn v-if="isPmsAdmin" color="primary" size="x-small" prepend-icon="mdi-plus" @click="openCreate">보고서 생성</v-btn>
        </v-col>
      </v-row>

      <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

      <div class="pms-card">
        <table class="pms-table" style="width:100%">
          <thead>
            <tr>
              <th style="width:50px">No</th>
              <th style="width:80px">유형</th>
              <th>제목</th>
              <th style="width:130px">보고기간</th>
              <th style="width:80px">상태</th>
              <th style="width:80px">팀 작성</th>
              <th style="width:80px">생성자</th>
              <th style="width:100px">생성일</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!reports.length">
              <td colspan="8" class="text-center" style="color:var(--pms-text-hint); padding:24px">등록된 보고서가 없습니다.</td>
            </tr>
            <tr v-for="(item, idx) in reports" :key="item.reportId" class="pms-table-row-clickable" @click="selectReport(item)">
              <td class="text-center">{{ reports.length - idx }}</td>
              <td class="text-center">
                <v-chip size="x-small" variant="tonal" :color="item.reportType === 'weekly' ? 'primary' : item.reportType === 'monthly' ? 'success' : 'warning'">
                  {{ typeLabels[item.reportType] || item.reportType }}
                </v-chip>
              </td>
              <td>{{ item.title }}</td>
              <td class="text-center" style="font-size:var(--pms-font-caption)">
                <template v-if="item.periodStart">{{ fmtShortDate(item.periodStart) }}~{{ fmtShortDate(item.periodEnd) }}</template>
              </td>
              <td class="text-center"><v-chip :color="statusColor[item.status]||'grey'" size="x-small" variant="tonal">{{ item.status }}</v-chip></td>
              <td class="text-center" style="font-size:var(--pms-font-caption)">
                {{ item.sections?.filter((s: any) => s.status === '작성완료').length || 0 }}/{{ item.sections?.length || 0 }}
              </td>
              <td class="text-center">{{ item.createdByName || item.createdBy }}</td>
              <td class="text-center" style="font-size:var(--pms-font-caption)">{{ fmtDate(item.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ============================================================ -->
    <!-- 상세 모드 -->
    <!-- ============================================================ -->
    <template v-if="viewMode === 'detail' && selectedReport">
      <v-progress-linear v-if="detailLoading" indeterminate color="primary" class="mb-2" />

      <!-- 기본 정보 + 액션 -->
      <div class="pms-card mb-3">
        <div class="d-flex align-center pa-3" style="gap:8px; flex-wrap:wrap">
          <v-chip :color="statusColor[selectedReport.status]" size="small" variant="tonal">{{ selectedReport.status }}</v-chip>
          <v-chip size="small" variant="outlined" :color="selectedReport.reportType === 'weekly' ? 'primary' : 'success'">
            {{ typeLabels[selectedReport.reportType] }}
          </v-chip>
          <span style="font-size:var(--pms-font-subtitle); font-weight:600">{{ selectedReport.title }}</span>
          <v-spacer />
          <template v-if="isPmsAdmin && !isCompleted">
            <v-btn v-if="selectedReport.status === '생성'" size="x-small" color="info" variant="outlined" prepend-icon="mdi-send" @click="requestWrite">작성요청</v-btn>
            <v-btn v-if="selectedReport.status === '검토'" size="x-small" color="success" variant="outlined" prepend-icon="mdi-check-circle" @click="completeReport">최종완료</v-btn>
          </template>
          <v-btn v-if="isPmsAdmin" size="x-small" variant="outlined" prepend-icon="mdi-refresh" @click="refreshData">데이터 갱신</v-btn>
          <v-btn size="x-small" variant="outlined" prepend-icon="mdi-eye" @click="openPreview">미리보기</v-btn>
          <v-btn size="x-small" variant="outlined" color="indigo" prepend-icon="mdi-file-word" @click="downloadDocx">DOCX</v-btn>
          <v-btn v-if="isPmsAdmin && selectedReport.status === '생성'" size="x-small" variant="outlined" color="error" prepend-icon="mdi-delete" @click="deleteReport">삭제</v-btn>
        </div>
        <v-divider />
        <table class="pms-detail-table">
          <tbody>
            <tr>
              <td class="pms-detail-label">{{ periodLabel }} 기간</td>
              <td class="pms-detail-value">{{ fmtDate(selectedReport.periodStart) }} ~ {{ fmtDate(selectedReport.periodEnd) }}</td>
              <td class="pms-detail-label">{{ nextPeriodLabel }} 기간</td>
              <td class="pms-detail-value">{{ fmtDate(selectedReport.nextStart) }} ~ {{ fmtDate(selectedReport.nextEnd) }}</td>
            </tr>
            <tr>
              <td class="pms-detail-label">생성자</td><td class="pms-detail-value">{{ selectedReport.createdByName || selectedReport.createdBy }}</td>
              <td class="pms-detail-label">생성일</td><td class="pms-detail-value">{{ fmtDT(selectedReport.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 워크플로 진행 -->
      <div class="pms-card mb-3">
        <div class="pms-section-header" style="background:var(--pms-info-light)">
          <v-icon size="14">mdi-progress-check</v-icon> 워크플로 진행
          <span style="font-size:var(--pms-font-caption); margin-left:8px">(팀 작성: {{ sectionProgress.done }}/{{ sectionProgress.total }})</span>
        </div>
        <div class="pa-3">
          <div class="d-flex align-center mb-3" style="gap:4px">
            <template v-for="(step, idx) in ['생성','작성요청','작성중','검토','완료']" :key="step">
              <v-chip :color="selectedReport.status === step ? statusColor[step] : (['생성','작성요청','작성중','검토','완료'].indexOf(selectedReport.status) >= idx ? 'success' : 'grey-lighten-2')"
                      :variant="selectedReport.status === step ? 'elevated' : 'tonal'" size="small">
                <v-icon v-if="['생성','작성요청','작성중','검토','완료'].indexOf(selectedReport.status) > idx" size="12" start>mdi-check</v-icon>
                {{ step }}
              </v-chip>
              <v-icon v-if="idx < 4" size="14" color="grey">mdi-chevron-right</v-icon>
            </template>
          </div>

          <!-- 팀별 작성 현황 -->
          <div v-if="selectedReport.sections?.length" style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">팀별 작성 현황</div>
          <div class="d-flex flex-wrap" style="gap:6px">
            <div v-for="s in selectedReport.sections" :key="s.sectionId" class="d-flex align-center" style="gap:4px; padding:3px 8px; border:1px solid var(--pms-border-light); border-radius:var(--pms-radius); font-size:var(--pms-font-caption)">
              <v-icon size="12" :color="s.status === '작성완료' ? 'success' : s.status === '작성중' ? 'warning' : 'grey'">
                {{ s.status === '작성완료' ? 'mdi-check-circle' : s.status === '작성중' ? 'mdi-pencil-circle' : 'mdi-circle-outline' }}
              </v-icon>
              <span :style="{ fontWeight: s.status === '작성완료' ? '600' : '400', color: s.status === '작성완료' ? 'var(--pms-success)' : '' }">{{ s.teamName }}</span>
              <v-chip :color="sectionStatusColor[s.status]" size="x-small" variant="tonal">{{ s.status }}</v-chip>
            </div>
          </div>
        </div>
      </div>

      <!-- ── 진척 현황 (S-Curve) ── -->
      <div v-if="selectedReport.autoContent" class="pms-card mb-3">
        <div class="pms-section-header d-flex align-center">
          <v-icon size="14">mdi-chart-line</v-icon> 진척 현황 (S-Curve)
          <v-spacer />
          <span style="font-size:var(--pms-font-caption); margin-right:12px">
            <span style="color:var(--pms-primary); font-weight:600">계획 {{ selectedReport.autoContent.totalProgress || 0 }}%</span>
            <span style="margin:0 4px; color:var(--pms-text-hint)">·</span>
            <span style="color:var(--pms-success); font-weight:600">실적 {{ selectedReport.autoContent.totalActual || 0 }}%</span>
            <span style="margin:0 4px; color:var(--pms-text-hint)">·</span>
            <span :style="{ color: (selectedReport.autoContent.totalActual || 0) >= (selectedReport.autoContent.totalProgress || 0) ? 'var(--pms-success)' : 'var(--pms-error)', fontWeight: '600' }">
              차이 {{ ((selectedReport.autoContent.totalActual || 0) - (selectedReport.autoContent.totalProgress || 0)).toFixed(1) }}%
            </span>
          </span>
        </div>
        <div class="pa-3">
          <!-- S-Curve 차트 -->
          <VueApexCharts v-if="selectedReport.autoContent.scurveWeeks?.length" type="line" :options="scurveChartOptions" :series="scurveChartSeries" height="300" />
          <div v-else class="text-center pa-4" style="color:var(--pms-text-hint); font-size:var(--pms-font-body)">S-Curve 데이터가 없습니다. 데이터 갱신을 실행하세요.</div>
          <!-- 팀별 진척률 -->
          <div v-if="selectedReport.autoContent.teamProgress?.length" class="mb-3">
            <div style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">
              {{ isPmsAdmin ? '팀별 진척률' : (myTeamOnly ? `${myDepartment} 진척률` : '팀별 진척률') }}
            </div>
            <!-- PMS관리자 또는 전체보기: 전체 팀 -->
            <template v-if="isPmsAdmin || !myTeamOnly">
              <div v-for="tp in selectedReport.autoContent.teamProgress" :key="tp.teamName" class="d-flex align-center mb-1" style="gap:8px">
                <span style="font-size:var(--pms-font-caption); width:80px; flex-shrink:0; font-weight:500" :style="{ color: tp.teamName === myDepartment ? 'var(--pms-primary)' : '' }">{{ tp.teamName }}</span>
                <v-progress-linear :model-value="tp.planRate" color="primary" height="10" rounded style="flex:1"><span style="font-size:8px">{{ tp.planRate }}%</span></v-progress-linear>
                <v-progress-linear :model-value="tp.actualRate" color="success" height="10" rounded style="flex:1"><span style="font-size:8px">{{ tp.actualRate }}%</span></v-progress-linear>
              </div>
              <div class="d-flex" style="gap:12px; font-size:var(--pms-font-mini); color:var(--pms-text-hint); margin-top:2px">
                <span><span style="display:inline-block; width:8px; height:8px; background:var(--pms-primary); border-radius:2px; margin-right:2px"></span>계획</span>
                <span><span style="display:inline-block; width:8px; height:8px; background:var(--pms-success); border-radius:2px; margin-right:2px"></span>실적</span>
              </div>
            </template>
            <!-- 일반 사용자 내 팀만: 본인 팀만 -->
            <template v-else-if="myTeamProgress">
              <div class="pa-3" style="border:1px solid var(--pms-border-light); border-radius:var(--pms-radius); background:var(--pms-surface)">
                <div style="font-size:var(--pms-font-body); font-weight:700; margin-bottom:6px; color:var(--pms-primary)">{{ myTeamProgress.teamName }} ({{ myTeamProgress.taskCount }}건)</div>
                <v-row dense align="center">
                  <v-col cols="1" style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary)">계획</v-col>
                  <v-col cols="9"><v-progress-linear :model-value="myTeamProgress.planRate" color="primary" height="14" rounded><span style="font-size:10px; color:#fff">{{ myTeamProgress.planRate }}%</span></v-progress-linear></v-col>
                  <v-col cols="2" style="font-size:var(--pms-font-body); font-weight:700; color:var(--pms-primary)">{{ myTeamProgress.planRate }}%</v-col>
                </v-row>
                <v-row dense align="center" class="mt-1">
                  <v-col cols="1" style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary)">실적</v-col>
                  <v-col cols="9"><v-progress-linear :model-value="myTeamProgress.actualRate" color="success" height="14" rounded><span style="font-size:10px; color:#fff">{{ myTeamProgress.actualRate }}%</span></v-progress-linear></v-col>
                  <v-col cols="2" style="font-size:var(--pms-font-body); font-weight:700; color:var(--pms-success)">{{ myTeamProgress.actualRate }}%</v-col>
                </v-row>
              </div>
            </template>
          </div>

          <!-- 업무별 진척률 (PMS관리자 또는 전체보기 시) -->
          <div v-if="visibleBizProgress.length">
            <div style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">업무별 진척률</div>
            <table class="pms-table" style="width:100%">
              <thead><tr><th>업무</th><th style="width:120px">계획</th><th style="width:120px">실적</th></tr></thead>
              <tbody>
                <tr v-for="b in visibleBizProgress" :key="b.taskName">
                  <td>{{ b.taskName }}</td>
                  <td><v-progress-linear :model-value="b.progressRate" color="primary" height="12" rounded><span style="font-size:9px">{{ b.progressRate }}%</span></v-progress-linear></td>
                  <td><v-progress-linear :model-value="b.actualRate" color="success" height="12" rounded><span style="font-size:9px">{{ b.actualRate }}%</span></v-progress-linear></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ── 개발진척 현황 (진척 현황 바로 아래) ── -->
      <div v-if="selectedReport.autoContent?.devProgress" class="pms-card mb-3">
        <div class="pms-section-header" style="background:#E8F5E9"><v-icon size="14">mdi-code-braces</v-icon> 개발진척 현황</div>
        <div class="pa-3">
          <v-row dense class="mb-2">
            <v-col cols="3"><div style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary)">전체</div><div style="font-size:16px; font-weight:700">{{ selectedReport.autoContent.devProgress.total.toLocaleString() }}본</div></v-col>
            <v-col cols="3"><div style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary)">완료</div><div style="font-size:16px; font-weight:700; color:var(--pms-success)">{{ selectedReport.autoContent.devProgress.done }}본 ({{ selectedReport.autoContent.devProgress.doneRate }}%)</div></v-col>
            <v-col cols="3"><div style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary)">진행중</div><div style="font-size:16px; font-weight:700; color:var(--pms-primary)">{{ selectedReport.autoContent.devProgress.inProgress }}본</div></v-col>
            <v-col cols="3"><div style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary)">지연</div><div style="font-size:16px; font-weight:700; color:var(--pms-error)">{{ selectedReport.autoContent.devProgress.delayed }}본</div></v-col>
          </v-row>
          <div v-if="selectedReport.autoContent.devProgress.byTask?.length">
            <div style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">업무별 개발완료율</div>
            <table class="pms-table" style="width:100%">
              <thead><tr><th>업무</th><th>전체</th><th>완료</th><th>완료율</th></tr></thead>
              <tbody>
                <tr v-for="t in selectedReport.autoContent.devProgress.byTask" :key="t.taskCode">
                  <td>{{ t.taskCode }}</td>
                  <td class="text-center">{{ t.total }}</td>
                  <td class="text-center" style="color:var(--pms-success); font-weight:600">{{ t.done }}</td>
                  <td><v-progress-linear :model-value="t.doneRate" color="success" height="12" rounded style="min-width:60px"><span style="font-size:9px">{{ t.doneRate }}%</span></v-progress-linear></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ── 이슈/리스크 현황 ── -->
      <div v-if="selectedReport.autoContent" class="pms-card mb-3">
        <div class="pms-section-header" style="background:#FFF3E0"><v-icon size="14">mdi-shield-alert</v-icon> 이슈/리스크 현황 (이슈 {{ selectedReport.autoContent?.openIssueCount || 0 }}건, 리스크 {{ selectedReport.autoContent?.openRiskCount || 0 }}건)</div>
        <div class="pa-3">
          <div style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">미해결 이슈 ({{ selectedReport.autoContent?.openIssueCount || 0 }}건)</div>
          <div v-if="selectedReport.autoContent?.openIssues?.length" class="mb-3">
            <table class="pms-table" style="width:100%">
              <thead><tr><th>이슈명</th><th>이슈내용</th><th>변경내역</th><th style="width:70px">상태</th><th style="width:60px">중요도</th><th style="width:80px">담당자</th></tr></thead>
              <tbody>
                <tr v-for="(i, idx) in selectedReport.autoContent.openIssues" :key="'doi'+idx">
                  <td>{{ i.issueTitle }}</td>
                  <td style="font-size:var(--pms-font-caption); white-space:pre-wrap; max-width:200px">{{ i.content || '' }}</td>
                  <td style="font-size:var(--pms-font-caption); white-space:pre-wrap; max-width:200px">{{ i.lastChangeContent || '' }}</td>
                  <td class="text-center"><v-chip :color="i.status === 'Opened' ? 'error' : 'warning'" size="x-small" variant="tonal">{{ i.status }}</v-chip></td>
                  <td class="text-center">{{ i.importance || '' }}</td>
                  <td>{{ i.assigneeName || '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="mb-3" style="font-size:var(--pms-font-body); color:var(--pms-text-hint)">미해결 이슈 없음</div>
          <div style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">미해결 리스크 ({{ selectedReport.autoContent?.openRiskCount || 0 }}건)</div>
          <div v-if="selectedReport.autoContent?.openRisks?.length" class="mb-1">
            <table class="pms-table" style="width:100%">
              <thead><tr><th>리스크명</th><th>변경내역</th><th style="width:70px">상태</th><th style="width:60px">영향도</th><th style="width:80px">담당자</th></tr></thead>
              <tbody>
                <tr v-for="(r, idx) in selectedReport.autoContent.openRisks" :key="'dor'+idx">
                  <td>{{ r.riskName }}</td>
                  <td style="font-size:var(--pms-font-caption); white-space:pre-wrap; max-width:200px">{{ r.lastChangeContent || '' }}</td>
                  <td class="text-center"><v-chip :color="r.status === 'Opened' ? 'error' : 'warning'" size="x-small" variant="tonal">{{ r.status }}</v-chip></td>
                  <td class="text-center"><v-chip :color="getLevelColor(r.impactLevel)" size="x-small" variant="tonal">{{ r.impactLevel }}</v-chip></td>
                  <td>{{ r.ownerName || '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else style="font-size:var(--pms-font-body); color:var(--pms-text-hint)">미해결 리스크 없음</div>
        </div>
      </div>

      <!-- ── 내 팀만 보기 스위치 ── -->
      <div v-if="!isPmsAdmin && myDepartment" class="d-flex align-center mb-2" style="gap:8px">
        <v-switch v-model="myTeamOnly" density="compact" color="primary" hide-details style="flex:none" />
        <span style="font-size:var(--pms-font-body)">내 팀만 보기 ({{ myDepartment }})</span>
      </div>

      <!-- ── 팀별 섹션: 주간/월간 ── -->
      <div v-for="section in visibleSections" :key="section.sectionId" class="pms-card mb-3">
        <!-- 팀 헤더 -->
        <div class="d-flex align-center pa-3" style="gap:8px; background:var(--pms-surface)">
          <v-chip :color="sectionStatusColor[section.status]" size="x-small" variant="tonal">{{ section.status }}</v-chip>
          <span style="font-size:var(--pms-font-body); font-weight:700">{{ section.teamName }}</span>
          <span style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary)">{{ section.writerName || '' }}</span>
          <v-spacer />
          <template v-if="!isCompleted && editingSectionId !== section.sectionId">
            <v-btn v-if="isPmsAdmin || isMySection(section)" size="x-small" variant="outlined" prepend-icon="mdi-pencil" @click="startEditSection(section)">작성</v-btn>
          </template>
        </div>

        <!-- ── 편집 모드 ── -->
        <template v-if="editingSectionId === section.sectionId">
          <div v-if="isWeeklyOrMonthly" class="pa-3">
            <!-- 좌우 분할: 금주/차주 -->
            <div class="d-flex" style="gap:12px">
              <!-- 금주(금월) 실적 -->
              <div style="flex:1; min-width:0">
                <div class="pms-form-group-title green mb-2">
                  <v-icon size="16">mdi-check-circle</v-icon>
                  {{ periodLabel }} 실적 ({{ fmtShortDate(selectedReport.periodStart) }}~{{ fmtShortDate(selectedReport.periodEnd) }})
                </div>
                <table class="report-task-table mb-2">
                  <thead>
                    <tr><th style="width:28px"></th><th>실적 내용</th><th style="width:110px; text-align:center">시작일</th><th style="width:110px; text-align:center">종료일</th><th style="width:80px; text-align:center">상태</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(task, idx) in sectionForm.currentTasks" :key="idx">
                      <td class="text-center">
                        <v-btn icon size="x-small" variant="text" color="error" @click="removeCurrentTask(idx)"><v-icon size="12">mdi-close</v-icon></v-btn>
                      </td>
                      <td><v-textarea v-model="task.content" rows="2" variant="outlined" density="compact" hide-details class="pms-form rpt-textarea" auto-grow /></td>
                      <td><div class="rpt-date-cell" @click="openRptDate(task, 'scheduleStart')">{{ task.scheduleStart ? fmtShortDate(task.scheduleStart) : '-' }}<v-icon size="12" color="primary" class="ml-1">mdi-calendar</v-icon></div></td>
                      <td><div class="rpt-date-cell" @click="openRptDate(task, 'scheduleEnd')">{{ task.scheduleEnd ? fmtShortDate(task.scheduleEnd) : '-' }}<v-icon size="12" color="primary" class="ml-1">mdi-calendar</v-icon></div></td>
                      <td><select class="rpt-select" v-model="task.status"><option value="진행중">진행중</option><option value="완료">완료</option></select></td>
                    </tr>
                    <tr v-if="!sectionForm.currentTasks.length">
                      <td colspan="5" class="text-center" style="color:var(--pms-text-hint); padding:8px; font-size:var(--pms-font-caption)">태스크 없음</td>
                    </tr>
                  </tbody>
                </table>
                <v-btn size="x-small" variant="text" color="primary" prepend-icon="mdi-plus" @click="addCurrentTask">행 추가</v-btn>
                <div class="mt-2">
                  <div style="font-size:var(--pms-font-caption); font-weight:600; color:var(--pms-text-hint); margin-bottom:2px">비고</div>
                  <v-textarea v-model="sectionForm.currentRemark" rows="1" variant="outlined" density="compact" hide-details class="pms-form" auto-grow placeholder="실적 비고 (자유기재)" style="font-size:var(--pms-font-caption)" />
                </div>
              </div>

              <v-divider vertical />

              <!-- 차주(차월) 계획 -->
              <div style="flex:1; min-width:0">
                <div class="pms-form-group-title mb-2">
                  <v-icon size="16">mdi-calendar-arrow-right</v-icon>
                  {{ nextPeriodLabel }} 계획 ({{ fmtShortDate(selectedReport.nextStart) }}~{{ fmtShortDate(selectedReport.nextEnd) }})
                </div>
                <table class="report-task-table mb-2">
                  <thead>
                    <tr><th style="width:28px"></th><th>계획 내용</th><th style="width:110px; text-align:center">시작일</th><th style="width:110px; text-align:center">종료일</th><th style="width:80px; text-align:center">상태</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(task, idx) in sectionForm.nextTasks" :key="idx">
                      <td class="text-center">
                        <v-btn icon size="x-small" variant="text" color="error" @click="removeNextTask(idx)"><v-icon size="12">mdi-close</v-icon></v-btn>
                      </td>
                      <td><v-textarea v-model="task.content" rows="2" variant="outlined" density="compact" hide-details class="pms-form rpt-textarea" auto-grow /></td>
                      <td><div class="rpt-date-cell" @click="openRptDate(task, 'scheduleStart')">{{ task.scheduleStart ? fmtShortDate(task.scheduleStart) : '-' }}<v-icon size="12" color="primary" class="ml-1">mdi-calendar</v-icon></div></td>
                      <td><div class="rpt-date-cell" @click="openRptDate(task, 'scheduleEnd')">{{ task.scheduleEnd ? fmtShortDate(task.scheduleEnd) : '-' }}<v-icon size="12" color="primary" class="ml-1">mdi-calendar</v-icon></div></td>
                      <td><select class="rpt-select" v-model="task.status"><option value="진행중">진행중</option><option value="완료">완료</option></select></td>
                    </tr>
                    <tr v-if="!sectionForm.nextTasks.length">
                      <td colspan="5" class="text-center" style="color:var(--pms-text-hint); padding:8px; font-size:var(--pms-font-caption)">태스크 없음</td>
                    </tr>
                  </tbody>
                </table>
                <v-btn size="x-small" variant="text" color="primary" prepend-icon="mdi-plus" @click="addNextTask">행 추가</v-btn>
                <div class="mt-2">
                  <div style="font-size:var(--pms-font-caption); font-weight:600; color:var(--pms-text-hint); margin-bottom:2px">비고</div>
                  <v-textarea v-model="sectionForm.nextRemark" rows="1" variant="outlined" density="compact" hide-details class="pms-form" auto-grow placeholder="계획 비고 (자유기재)" style="font-size:var(--pms-font-caption)" />
                </div>
              </div>
            </div>

            <!-- 이슈/건의 -->
            <div class="mt-3">
              <div class="pms-form-group-title orange mb-1"><v-icon size="16">mdi-alert-circle</v-icon>이슈/건의사항</div>
              <v-textarea v-model="sectionForm.issues" rows="2" variant="outlined" density="compact" hide-details class="pms-form" auto-grow />
            </div>
          </div>

          <!-- 감리/완료보고: 텍스트 기반 -->
          <div v-else class="pa-3">
            <div class="pms-form-group">
              <div class="pms-form-group-title green"><v-icon size="16">mdi-check-circle</v-icon>실적</div>
              <v-textarea v-model="sectionForm.achievements" rows="4" variant="outlined" density="compact" hide-details class="pms-form mb-2" />
            </div>
            <div class="pms-form-group">
              <div class="pms-form-group-title"><v-icon size="16">mdi-calendar-arrow-right</v-icon>계획</div>
              <v-textarea v-model="sectionForm.plans" rows="4" variant="outlined" density="compact" hide-details class="pms-form mb-2" />
            </div>
            <div class="pms-form-group">
              <div class="pms-form-group-title orange"><v-icon size="16">mdi-alert-circle</v-icon>이슈/건의</div>
              <v-textarea v-model="sectionForm.issues" rows="2" variant="outlined" density="compact" hide-details class="pms-form" />
            </div>
          </div>

          <v-divider />
          <div class="d-flex justify-end pa-2" style="gap:4px">
            <v-btn size="x-small" variant="outlined" @click="cancelEditSection">취소</v-btn>
            <v-btn size="x-small" variant="outlined" color="primary" @click="saveSectionDraft(section)">임시저장</v-btn>
            <v-btn size="x-small" color="success" @click="saveSectionComplete(section)">작성완료</v-btn>
          </div>
        </template>

        <!-- ── 보기 모드: 주간/월간 태스크 테이블 ── -->
        <template v-else-if="isWeeklyOrMonthly">
          <div class="d-flex" style="min-height:60px">
            <!-- 금주 실적 -->
            <div style="flex:1; min-width:0; border-right:1px solid var(--pms-border-light)">
              <div class="report-col-header green">{{ periodLabel }} ({{ fmtShortDate(selectedReport.periodStart) }}~{{ fmtShortDate(selectedReport.periodEnd) }})</div>
              <table class="report-task-table">
                <thead><tr><th>실적</th><th style="width:120px">일정</th><th style="width:60px">상태</th></tr></thead>
                <tbody>
                  <tr v-for="(task, idx) in (section.currentTasks || [])" :key="idx">
                    <td style="white-space:pre-wrap">{{ task.content }}</td>
                    <td class="text-center">{{ task.schedule }}</td>
                    <td class="text-center"><v-chip v-if="task.status" :color="task.status === '완료' ? 'success' : 'warning'" size="x-small" variant="tonal">{{ task.status }}</v-chip></td>
                  </tr>
                  <tr v-if="!(section.currentTasks || []).length">
                    <td colspan="3" class="text-center" style="color:var(--pms-text-hint); font-size:var(--pms-font-caption); padding:12px">-</td>
                  </tr>
                  <tr v-if="section.currentRemark" class="remark-row">
                    <td colspan="3" style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary); background:#FAFAFA"><span style="font-weight:600; color:var(--pms-text-hint)">비고:</span> {{ section.currentRemark }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <!-- 차주 계획 -->
            <div style="flex:1; min-width:0">
              <div class="report-col-header blue">{{ nextPeriodLabel }} ({{ fmtShortDate(selectedReport.nextStart) }}~{{ fmtShortDate(selectedReport.nextEnd) }})</div>
              <table class="report-task-table">
                <thead><tr><th>계획</th><th style="width:120px">일정</th><th style="width:60px">상태</th></tr></thead>
                <tbody>
                  <tr v-for="(task, idx) in (section.nextTasks || [])" :key="idx">
                    <td style="white-space:pre-wrap">{{ task.content }}</td>
                    <td class="text-center">{{ task.schedule }}</td>
                    <td class="text-center"><v-chip v-if="task.status" :color="task.status === '완료' ? 'success' : 'warning'" size="x-small" variant="tonal">{{ task.status }}</v-chip></td>
                  </tr>
                  <tr v-if="!(section.nextTasks || []).length">
                    <td colspan="3" class="text-center" style="color:var(--pms-text-hint); font-size:var(--pms-font-caption); padding:12px">-</td>
                  </tr>
                  <tr v-if="section.nextRemark" class="remark-row">
                    <td colspan="3" style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary); background:#FAFAFA"><span style="font-weight:600; color:var(--pms-text-hint)">비고:</span> {{ section.nextRemark }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <!-- 이슈 -->
          <div v-if="section.issues" style="border-top:1px solid var(--pms-border-light); padding:6px 12px; font-size:var(--pms-font-caption)">
            <span style="font-weight:600; color:var(--pms-warning)">이슈/건의: </span>
            <span style="white-space:pre-wrap">{{ section.issues }}</span>
          </div>
        </template>

        <!-- 보기 모드: 감리/완료 (텍스트) -->
        <template v-else>
          <div v-if="section.achievements || section.plans || section.issues" class="px-3 pb-3 pt-1">
            <div v-if="section.achievements" class="mb-2">
              <div style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary); font-weight:600">실적</div>
              <div style="white-space:pre-wrap; font-size:var(--pms-font-body)">{{ section.achievements }}</div>
            </div>
            <div v-if="section.plans" class="mb-2">
              <div style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary); font-weight:600">계획</div>
              <div style="white-space:pre-wrap; font-size:var(--pms-font-body)">{{ section.plans }}</div>
            </div>
            <div v-if="section.issues">
              <div style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary); font-weight:600">이슈</div>
              <div style="white-space:pre-wrap; font-size:var(--pms-font-body)">{{ section.issues }}</div>
            </div>
          </div>
          <div v-else class="px-3 pb-2" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">(미작성)</div>
        </template>
      </div>

      <!-- 총괄소견 -->
      <div v-if="isPmsAdmin || selectedReport.summaryNote" class="pms-card mb-3">
        <div class="pms-section-header" style="background:var(--pms-success-light)">
          <v-icon size="14">mdi-comment-text</v-icon> 관리자 총괄소견
          <v-btn v-if="isPmsAdmin && !isCompleted && !editingSummary" size="x-small" variant="text" class="ml-2" @click="startEditSummary"><v-icon size="14">mdi-pencil</v-icon></v-btn>
        </div>
        <div class="pa-3">
          <template v-if="editingSummary">
            <v-textarea v-model="summaryForm" rows="4" variant="outlined" density="compact" hide-details class="pms-form mb-2" />
            <div class="d-flex justify-end" style="gap:4px">
              <v-btn size="x-small" variant="outlined" @click="editingSummary = false">취소</v-btn>
              <v-btn size="x-small" color="primary" @click="saveSummary">저장</v-btn>
            </div>
          </template>
          <div v-else style="white-space:pre-wrap; font-size:var(--pms-font-body)">{{ selectedReport.summaryNote || '(미작성)' }}</div>
        </div>
      </div>

    </template>

    <!-- ============================================================ -->
    <!-- 미리보기 (인쇄용) -->
    <!-- ============================================================ -->
    <template v-if="viewMode === 'preview' && selectedReport">
      <div class="d-flex justify-end mb-2">
        <v-btn size="x-small" variant="outlined" prepend-icon="mdi-printer" @click="window.print()">인쇄</v-btn>
        <v-btn size="x-small" variant="outlined" color="indigo" prepend-icon="mdi-file-word" @click="downloadDocx">DOCX</v-btn>
      </div>
      <div class="pms-card" id="report-content">
        <div class="pa-4">
          <h3 class="text-center mb-1" style="font-size:16px; font-weight:700">{{ selectedReport.title }}</h3>
          <div class="text-center mb-4" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">
            {{ periodLabel }}: {{ fmtDate(selectedReport.periodStart) }} ~ {{ fmtDate(selectedReport.periodEnd) }}
            <template v-if="selectedReport.nextStart">&nbsp;|&nbsp;{{ nextPeriodLabel }}: {{ fmtDate(selectedReport.nextStart) }} ~ {{ fmtDate(selectedReport.nextEnd) }}</template>
          </div>

          <!-- 1. 프로젝트 개요 -->
          <div class="pms-form-group-title mb-2"><v-icon size="16">mdi-briefcase</v-icon>1. 프로젝트 개요</div>
          <table class="pms-detail-table mb-4" v-if="selectedReport.autoContent?.project">
            <tbody>
              <tr><td class="pms-detail-label">프로젝트명</td><td class="pms-detail-value">{{ selectedReport.autoContent.project.projectName }}</td></tr>
              <tr><td class="pms-detail-label">사업관리번호</td><td class="pms-detail-value">{{ selectedReport.autoContent.project.businessNo }}</td></tr>
              <tr><td class="pms-detail-label">PM</td><td class="pms-detail-value">{{ selectedReport.autoContent.project.pmName }}</td></tr>
              <tr><td class="pms-detail-label">사업기간</td><td class="pms-detail-value">{{ fmtDate(selectedReport.autoContent.project.startDate) }} ~ {{ fmtDate(selectedReport.autoContent.project.endDate) }}</td></tr>
              <tr><td class="pms-detail-label">투입인력</td><td class="pms-detail-value">{{ selectedReport.autoContent.memberCount }}명 ({{ selectedReport.autoContent.totalManMonth }}M/M)</td></tr>
            </tbody>
          </table>

          <!-- 2. 진척 현황 (S-Curve) -->
          <div class="pms-form-group-title mb-2">
            <v-icon size="16">mdi-chart-line</v-icon>2. 진척 현황 (S-Curve)
            <span style="font-size:var(--pms-font-caption); margin-left:12px; font-weight:400">
              계획 {{ selectedReport.autoContent?.totalProgress || 0 }}% · 실적 {{ selectedReport.autoContent?.totalActual || 0 }}%
            </span>
          </div>
          <div class="mb-3">
            <VueApexCharts v-if="selectedReport.autoContent?.scurveWeeks?.length" type="line" :options="scurveChartOptions" :series="scurveChartSeries" height="280" />
          </div>

          <!-- 2-2. 업무별 진척률 -->
          <table class="pms-table mb-4" style="width:100%" v-if="selectedReport.autoContent?.bizProgress?.length">
            <thead><tr><th>업무</th><th style="width:120px">계획 진척률</th><th style="width:120px">실적 진척률</th></tr></thead>
            <tbody>
              <tr v-for="(b, i) in selectedReport.autoContent.bizProgress" :key="i">
                <td>{{ b.taskName }}</td>
                <td>
                  <v-progress-linear :model-value="b.progressRate" color="primary" height="14" rounded style="min-width:80px">
                    <span style="font-size:10px">{{ b.progressRate }}%</span>
                  </v-progress-linear>
                </td>
                <td>
                  <v-progress-linear :model-value="b.actualRate" color="success" height="14" rounded style="min-width:80px">
                    <span style="font-size:10px">{{ b.actualRate }}%</span>
                  </v-progress-linear>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else-if="selectedReport.autoContent?.phaseProgress?.length">
            <table class="pms-table mb-4" style="width:100%">
              <thead><tr><th>태스크</th><th>공정</th><th style="width:120px">계획</th><th style="width:120px">실적</th></tr></thead>
              <tbody>
                <tr v-for="(p, i) in selectedReport.autoContent.phaseProgress" :key="i">
                  <td>{{ p.taskName }}</td><td>{{ p.phase || '-' }}</td>
                  <td><v-progress-linear :model-value="p.progressRate" color="primary" height="14" rounded><span style="font-size:10px">{{ p.progressRate }}%</span></v-progress-linear></td>
                  <td><v-progress-linear :model-value="p.actualRate || 0" color="success" height="14" rounded><span style="font-size:10px">{{ p.actualRate || 0 }}%</span></v-progress-linear></td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 3. 이슈/리스크 현황 -->
          <div class="pms-form-group-title orange mb-2"><v-icon size="16">mdi-shield-alert</v-icon>3. 이슈/리스크 현황 (이슈 {{ selectedReport.autoContent?.openIssueCount || 0 }}건, 리스크 {{ selectedReport.autoContent?.openRiskCount || 0 }}건)</div>
          <div v-if="selectedReport.autoContent?.openIssues?.length" class="mb-3">
            <div style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">미해결 이슈 ({{ selectedReport.autoContent.openIssueCount }}건)</div>
            <table class="pms-table" style="width:100%">
              <thead><tr><th>이슈명</th><th>이슈내용</th><th>변경내역</th><th style="width:70px">상태</th><th style="width:60px">중요도</th><th style="width:80px">담당자</th></tr></thead>
              <tbody>
                <tr v-for="(i, idx) in selectedReport.autoContent.openIssues" :key="'poi'+idx">
                  <td>{{ i.issueTitle }}</td>
                  <td style="font-size:var(--pms-font-caption); white-space:pre-wrap; max-width:200px">{{ i.content || '' }}</td>
                  <td style="font-size:var(--pms-font-caption); white-space:pre-wrap; max-width:200px">{{ i.lastChangeContent || '' }}</td>
                  <td class="text-center"><v-chip :color="i.status === 'Opened' ? 'error' : 'warning'" size="x-small" variant="tonal">{{ i.status }}</v-chip></td>
                  <td class="text-center">{{ i.importance || '' }}</td>
                  <td>{{ i.assigneeName || '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="mb-3" style="font-size:var(--pms-font-body); color:var(--pms-text-hint)">미해결 이슈 없음</div>
          <div v-if="selectedReport.autoContent?.openRisks?.length" class="mb-4">
            <div style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">미해결 리스크 ({{ selectedReport.autoContent.openRiskCount }}건)</div>
            <table class="pms-table" style="width:100%">
              <thead><tr><th>리스크명</th><th>변경내역</th><th style="width:70px">상태</th><th style="width:60px">영향도</th><th style="width:80px">담당자</th></tr></thead>
              <tbody>
                <tr v-for="(r, idx) in selectedReport.autoContent.openRisks" :key="'por'+idx">
                  <td>{{ r.riskName }}</td>
                  <td style="font-size:var(--pms-font-caption); white-space:pre-wrap; max-width:200px">{{ r.lastChangeContent || '' }}</td>
                  <td class="text-center"><v-chip :color="r.status === 'Opened' ? 'error' : 'warning'" size="x-small" variant="tonal">{{ r.status }}</v-chip></td>
                  <td class="text-center"><v-chip :color="getLevelColor(r.impactLevel)" size="x-small" variant="tonal">{{ r.impactLevel }}</v-chip></td>
                  <td>{{ r.ownerName || '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="mb-4" style="font-size:var(--pms-font-body); color:var(--pms-text-hint)">미해결 리스크 없음</div>

          <!-- 4. 팀별 실적/계획 -->
          <div class="pms-form-group-title green mb-2"><v-icon size="16">mdi-account-group</v-icon>4. 팀별 {{ periodLabel }} 실적 / {{ nextPeriodLabel }} 계획</div>
          <div v-for="section in selectedReport.sections" :key="section.sectionId" class="mb-3" style="border:1px solid var(--pms-border); border-radius:var(--pms-radius)">
            <div style="font-size:var(--pms-font-body); font-weight:700; padding:6px 12px; background:var(--pms-surface); border-bottom:1px solid var(--pms-border-light)">
              {{ section.teamName }} <span style="font-weight:400; color:var(--pms-text-secondary)">{{ section.writerName }}</span>
            </div>
            <div v-if="isWeeklyOrMonthly">
              <div class="d-flex">
                <div style="flex:1; border-right:1px solid var(--pms-border-light)">
                  <table class="report-task-table">
                    <thead><tr><th>{{ periodLabel }} 실적</th><th style="width:120px">일정</th><th style="width:60px">상태</th></tr></thead>
                    <tbody>
                      <tr v-for="(t, i) in (section.currentTasks || [])" :key="i">
                        <td style="white-space:pre-wrap">{{ t.content }}</td><td class="text-center">{{ t.schedule }}</td><td class="text-center">{{ t.status || '' }}</td>
                      </tr>
                      <tr v-if="!(section.currentTasks||[]).length"><td colspan="3" class="text-center" style="color:var(--pms-text-hint); padding:8px">-</td></tr>
                      <tr v-if="section.currentRemark" class="remark-row"><td colspan="3" style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary); background:#FAFAFA"><span style="font-weight:600; color:var(--pms-text-hint)">비고:</span> {{ section.currentRemark }}</td></tr>
                    </tbody>
                  </table>
                </div>
                <div style="flex:1">
                  <table class="report-task-table">
                    <thead><tr><th>{{ nextPeriodLabel }} 계획</th><th style="width:120px">일정</th><th style="width:60px">상태</th></tr></thead>
                    <tbody>
                      <tr v-for="(t, i) in (section.nextTasks || [])" :key="i">
                        <td style="white-space:pre-wrap">{{ t.content }}</td><td class="text-center">{{ t.schedule }}</td><td class="text-center">{{ t.status || '' }}</td>
                      </tr>
                      <tr v-if="!(section.nextTasks||[]).length"><td colspan="3" class="text-center" style="color:var(--pms-text-hint); padding:8px">-</td></tr>
                      <tr v-if="section.nextRemark" class="remark-row"><td colspan="3" style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary); background:#FAFAFA"><span style="font-weight:600; color:var(--pms-text-hint)">비고:</span> {{ section.nextRemark }}</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div v-if="section.issues" style="padding:4px 8px; font-size:var(--pms-font-caption); border-top:1px solid var(--pms-border-light)">
                <span style="font-weight:600; color:#E65100">이슈/건의:</span> {{ section.issues }}
              </div>
            </div>
            <div v-else class="pa-2" style="font-size:var(--pms-font-body)">
              <div v-if="section.achievements"><b>실적:</b> {{ section.achievements }}</div>
              <div v-if="section.plans"><b>계획:</b> {{ section.plans }}</div>
              <div v-if="section.issues"><b>이슈:</b> {{ section.issues }}</div>
              <div v-if="!section.achievements && !section.plans" style="color:var(--pms-text-hint)">(미작성)</div>
            </div>
          </div>

          <!-- 총괄소견 -->
          <div v-if="selectedReport.summaryNote">
            <div class="pms-form-group-title green mb-2"><v-icon size="16">mdi-comment-text</v-icon>5. 관리자 총괄소견</div>
            <div style="white-space:pre-wrap; font-size:var(--pms-font-body); border:1px solid var(--pms-border-light); padding:8px 12px; border-radius:var(--pms-radius)">{{ selectedReport.summaryNote }}</div>
          </div>
        </div>
      </div>
    </template>

    <!-- 보고서 생성 다이얼로그 -->
    <v-dialog v-model="createDialog" max-width="520" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">보고서 생성</v-card-title>
        <v-card-text>
          <v-select v-model="createForm.reportType" :items="typeItems.slice(1)" label="보고서 유형" variant="outlined" density="compact" hide-details class="pms-form mb-3" @update:model-value="onTypeChange" />
          <v-text-field v-model="createForm.title" variant="outlined" density="compact" hide-details class="pms-form mb-3">
            <template #label>제목<span class="pms-required">*</span></template>
          </v-text-field>
          <div style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">{{ createForm.reportType === 'weekly' ? '금주' : '금월' }} 기간</div>
          <v-row dense class="mb-3">
            <v-col cols="6"><v-text-field v-model="createForm.periodStart" label="시작" type="date" variant="outlined" density="compact" hide-details class="pms-form" /></v-col>
            <v-col cols="6"><v-text-field v-model="createForm.periodEnd" label="종료" type="date" variant="outlined" density="compact" hide-details class="pms-form" /></v-col>
          </v-row>
          <div style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">{{ createForm.reportType === 'weekly' ? '차주' : '차월' }} 기간</div>
          <v-row dense class="mb-3">
            <v-col cols="6"><v-text-field v-model="createForm.nextStart" label="시작" type="date" variant="outlined" density="compact" hide-details class="pms-form" /></v-col>
            <v-col cols="6"><v-text-field v-model="createForm.nextEnd" label="종료" type="date" variant="outlined" density="compact" hide-details class="pms-form" /></v-col>
          </v-row>

          <!-- 보고 대상 팀 선택 -->
          <div style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">보고 대상 팀
            <v-btn size="x-small" variant="text" color="primary" class="ml-1" @click="createForm.selectedTeams = [...teamList]">전체선택</v-btn>
            <v-btn size="x-small" variant="text" color="grey" @click="createForm.selectedTeams = []">해제</v-btn>
          </div>
          <div class="d-flex flex-wrap" style="gap:4px">
            <v-chip v-for="team in teamList" :key="team" size="small"
                    :variant="createForm.selectedTeams.includes(team) ? 'elevated' : 'outlined'"
                    :color="createForm.selectedTeams.includes(team) ? 'primary' : 'grey'"
                    @click="createForm.selectedTeams.includes(team) ? createForm.selectedTeams = createForm.selectedTeams.filter((t: string) => t !== team) : createForm.selectedTeams.push(team)"
                    style="cursor:pointer">
              {{ team }}
            </v-chip>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="outlined" @click="createDialog = false">취소</v-btn>
          <v-btn size="small" color="primary" @click="createReport">생성</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <!-- 날짜 선택용 숨겨진 PmsDatePicker -->
    <div style="position:absolute; left:-9999px">
      <PmsDatePicker ref="rptDatePickerRef" :model-value="rptDateValue" @update:model-value="onRptDateSelect" label="날짜" />
    </div>
  </MainLayout>
</template>

<style scoped>
.pms-table-row-clickable { cursor: pointer; }
.pms-table-row-clickable:hover { background: var(--pms-hover, #f5f5f5); }

.report-col-header {
  font-size: var(--pms-font-caption, 10px);
  font-weight: 700;
  padding: 4px 8px;
  border-bottom: 1px solid var(--pms-border-light, #e0e0e0);
  background: #f5f5f5;
}
.report-col-header.green { background: #e8f5e9; }
.report-col-header.blue { background: #e3f2fd; }

.report-task-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--pms-font-body, 11px);
}
.report-task-table th {
  font-size: var(--pms-font-caption, 10px);
  font-weight: 600;
  padding: 3px 6px;
  border-bottom: 1px solid var(--pms-border-light, #e0e0e0);
  background: var(--pms-surface, #fafafa);
  text-align: left;
}
.report-task-table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--pms-border-light, #eee);
  vertical-align: top;
}
.rpt-date-cell {
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; cursor: pointer; padding: 4px 2px;
  border: 1px solid var(--pms-border, #ddd); border-radius: 3px;
  background: #fff; white-space: nowrap; transition: border-color 0.15s;
}
.rpt-date-cell:hover { border-color: var(--pms-primary); background: #f8f9ff; }
.rpt-select {
  width: 100%; font-size: 10px; border: 1px solid var(--pms-border, #ddd);
  border-radius: 3px; padding: 3px 4px; outline: none; background: #fff;
}
.rpt-select:focus { border-color: var(--pms-primary); }
.rpt-textarea :deep(.v-field__input) { font-size: 11px !important; }
.remark-row td { padding: 0 6px 4px !important; border-bottom: 2px solid var(--pms-border-light, #ddd) !important; }
</style>
