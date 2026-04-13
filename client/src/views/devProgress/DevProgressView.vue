<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import PmsDatePicker from '@/components/common/PmsDatePicker.vue'
import UserTreePicker from '@/components/common/UserTreePicker.vue'
import { devProgramService } from '@/services/devPrograms'
import { projectService } from '@/services/projects'
import { requirementService } from '@/services/requirements'
import { wbsService } from '@/services/wbs'
import { useDialog } from '@/composables/useDialog'

const { showAlert, showConfirm } = useDialog()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)

const project = ref<any>(null)
const myRole = ref<any>(null)
const isPmsAdmin = computed(() => myRole.value?.isPmsAdmin || false)

const items = ref<any[]>([])
const loading = ref(false)
const summary = ref<any>(null)
const trend = ref<any[]>([])
const totalPrograms = ref(0)
const baseDate = ref(new Date().toISOString().substring(0, 10))

// 기준일 기반 통계
const baseStats = computed(() => {
  if (!trend.value.length || !totalPrograms.value) return { total: 0, planCount: 0, actualCount: 0, planRate: 0, actualRate: 0, achieveRate: 0 }
  const bd = baseDate.value
  let matched = trend.value[0]
  for (const t of trend.value) {
    if (t.weekEnd <= bd) matched = t
    else break
  }
  const planCount = matched?.planCount || 0
  const actualCount = matched?.actualCount || 0
  const planRate = matched?.planCumRate || 0
  const actualRate = matched?.actualCumRate || 0
  const achieveRate = planRate > 0 ? Math.round(actualRate / planRate * 1000) / 10 : 0
  return { total: totalPrograms.value, planCount, actualCount, planRate, actualRate, achieveRate }
})

// 필터
const filterTask = ref('')
const filterType = ref('')
const filterDev = ref('')
const filterStatus = ref('')
const keyword = ref('')

// 투입인력 & 요구사항 & WBS
const members = ref<any[]>([])
const requirements = ref<any[]>([])
const wbsDepth2 = ref<any[]>([])  // WBS depth 2 (업무구분)

// 업무구분 셀렉트 옵션 (WBS depth 2)
const taskCodeItems = computed(() => wbsDepth2.value.map(t => ({ title: t.taskName, value: t.taskName })))
const reqSearchKeyword = ref('')
const reqSearchResults = computed(() => {
  if (!reqSearchKeyword.value) return requirements.value.slice(0, 20)
  const kw = reqSearchKeyword.value.toLowerCase()
  return requirements.value.filter(r =>
    (r.reqCode || '').toLowerCase().includes(kw) ||
    (r.reqName || '').toLowerCase().includes(kw)
  ).slice(0, 20)
})
// 다이얼로그
const formDialog = ref(false)
const formEditMode = ref(false)
const form = ref<any>({})

// 엑셀 업로드
const importDialog = ref(false)
const importFile = ref<File | null>(null)
const importResult = ref<any>(null)
const importing = ref(false)
const importMode = ref<'append' | 'reset'>('append')

const PGM_TYPES = [
  { title: '전체', value: '' },
  { title: '화면', value: 'ONL' }, { title: '배치', value: 'BAT' },
  { title: '인터페이스', value: 'INF' }, { title: '리포트', value: 'RPT' },
  { title: '공통모듈', value: 'COM' }, { title: '데이터이행', value: 'MIG' },
]
const PGM_TYPE_LABELS: Record<string, string> = {
  ONL: '화면', BAT: '배치', INF: '인터페이스', RPT: '리포트', COM: '공통모듈', MIG: '데이터이행',
}
const DIFF_ITEMS = [{ title: '상', value: 'H' }, { title: '중', value: 'M' }, { title: '하', value: 'L' }]
const PRIORITY_ITEMS = [{ title: '긴급', value: 'URGENT' }, { title: '높음', value: 'HIGH' }, { title: '보통', value: 'NORMAL' }, { title: '낮음', value: 'LOW' }]
const STATUS_ITEMS = [
  { title: '전체', value: '' },
  { title: '미착수', value: 'NOT_START' }, { title: '진행중', value: 'IN_PROGRESS' },
  { title: '개발완료', value: 'DEV_DONE' }, { title: '지연', value: 'DELAYED' },
]
const STATUS_LABELS: Record<string, string> = {
  NOT_START: '미착수', IN_PROGRESS: '진행중', DEV_DONE: '개발완료', DELAYED: '지연',
}
const STATUS_COLORS: Record<string, string> = {
  NOT_START: 'grey', IN_PROGRESS: 'primary', DEV_DONE: 'success', DELAYED: 'error',
}

// 업무 코드 목록 (WBS depth 2 + 데이터에서 추출)
const taskOptions = computed(() => {
  const set = new Set<string>()
  wbsDepth2.value.forEach(t => set.add(t.taskName))
  items.value.forEach(i => { if (i.taskCode) set.add(i.taskCode) })
  return [{ title: '전체', value: '' }, ...Array.from(set).sort().map(t => ({ title: t, value: t }))]
})
const devOptions = computed(() => {
  const map = new Map<string, string>()
  items.value.forEach(i => { if (i.devUserName) map.set(i.devUserId || i.devUserName, i.devUserName) })
  return [{ title: '전체', value: '' }, ...Array.from(map.entries()).map(([v, t]) => ({ title: t, value: v }))]
})

async function fetchList() {
  loading.value = true
  try {
    const params: any = {}
    if (filterTask.value) params.taskCode = filterTask.value
    if (filterType.value) params.pgmType = filterType.value
    if (filterDev.value) params.devUserId = filterDev.value
    if (filterStatus.value) params.statusCode = filterStatus.value
    if (keyword.value) params.keyword = keyword.value
    const res = await devProgramService.getList(projectId, params)
    if (res.success) items.value = res.data
  } catch (err) { console.error(err) }
  finally { loading.value = false }
}

async function fetchSummary() {
  try {
    const res = await devProgramService.getSummary(projectId)
    if (res.success) summary.value = res.data
  } catch {}
}

function fmtDate(d: string | null) { return d ? d.substring(0, 10) : '' }

// ── CRUD ──
function openCreate() {
  formEditMode.value = false
  form.value = {
    pgmCode: '', pgmName: '', taskCode: '', pgmType: 'ONL', screenId: '',
    difficulty: 'M', priority: 'NORMAL', reqId: '', reqName: '', devUserName: '', devTeam: '',
    planStartDate: '', planEndDate: '',
    planTcCount: 0, relatedDoc: '', remark: '',
  }
  formDialog.value = true
}

function openEdit(item: any) {
  formEditMode.value = true
  form.value = {
    ...item,
    planStartDate: fmtDate(item.planStartDate),
    planEndDate: fmtDate(item.planEndDate),
    actualStartDate: fmtDate(item.actualStartDate),
    actualEndDate: fmtDate(item.actualEndDate),
    reqName: item.reqName || '',
  }
  // devUserId 없고 devUserName만 있으면 members에서 userId 역매핑
  if (!form.value.devUserId && form.value.devUserName) {
    const m = members.value.find((m: any) => (m.user?.userName || m.userName) === form.value.devUserName)
    if (m) form.value.devUserId = m.user?.userId || m.userId
  }
  // reqId 있는데 reqName 없으면 요구사항 목록에서 매핑
  if (form.value.reqId && !form.value.reqName) {
    const r = requirements.value.find((r: any) => r.reqCode === form.value.reqId)
    if (r) form.value.reqName = r.reqName
  }
  formDialog.value = true
}

async function save() {
  if (!form.value.pgmCode || !form.value.pgmName || !form.value.taskCode || !form.value.planStartDate || !form.value.planEndDate) {
    await showAlert('필수 항목을 입력하세요.', { color: 'error' }); return
  }

  // 유효성: 개발완료일 있으면 실제시작일도 필수
  if (formEditMode.value && form.value.actualEndDate && !form.value.actualStartDate) {
    await showAlert('개발완료일 등록 시 실제시작일이 필수입니다.', { color: 'error' }); return
  }

  try {
    if (formEditMode.value) {
      await devProgramService.update(projectId, form.value.pgmId, form.value)
    } else {
      await devProgramService.create(projectId, form.value)
    }
    formDialog.value = false; await fetchList(); await fetchSummary(); await showAlert('저장되었습니다.')
  } catch (err: any) { showAlert(err?.response?.data?.message || '저장 실패', { color: 'error' }) }
}

async function deleteItem(item: any) {
  if (!(await showConfirm(`"${item.pgmName}"을 삭제하시겠습니까?`))) return
  try {
    await devProgramService.remove(projectId, item.pgmId)
    await fetchList(); await fetchSummary(); await showAlert('삭제되었습니다.')
  } catch (err: any) { showAlert(err?.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

// ── 담당자 실적 등록 (인라인 달력 아이콘) ──
const inlineDateItem = ref<any>(null)
const inlineDateDialog = ref(false)
const inlineDateValue = ref('')

function openInlineDatePicker(item: any) {
  inlineDateItem.value = item
  inlineDateValue.value = ''
  inlineDateDialog.value = true
}

async function saveInlineDate() {
  if (!inlineDateValue.value || !inlineDateItem.value) return
  try {
    await devProgramService.updateActual(projectId, inlineDateItem.value.pgmId, { actualEndDate: inlineDateValue.value })
    inlineDateDialog.value = false
    await fetchList(); await fetchSummary()
    await showAlert('개발완료일이 등록되었습니다.')
  } catch (err: any) { showAlert(err?.response?.data?.message || '실패', { color: 'error' }) }
}

// ── 엑셀 ──
async function exportExcel() {
  try { await devProgramService.exportExcel(projectId) }
  catch { showAlert('엑셀 다운로드 실패', { color: 'error' }) }
}

function openImport() { importFile.value = null; importResult.value = null; importMode.value = 'append'; importDialog.value = true }
function onFileChange(e: any) { importFile.value = e.target?.files?.[0] || null }

async function doImport() {
  if (!importFile.value) { await showAlert('파일을 선택하세요.', { color: 'error' }); return }
  if (importMode.value === 'reset') {
    if (!(await showConfirm('전체 초기화 후 임포트합니다.\n기존 프로그램 데이터가 모두 삭제됩니다. 계속하시겠습니까?'))) return
  }
  importing.value = true
  try {
    const res = await devProgramService.importExcel(projectId, importFile.value, importMode.value)
    if (res.success) { importResult.value = res.data; await fetchList(); await fetchSummary() }
  } catch (err: any) { showAlert(err?.response?.data?.message || '업로드 실패', { color: 'error' }) }
  finally { importing.value = false }
}

function downloadTemplate() { devProgramService.exportExcel(projectId) }

// 지연여부 판별
function isDelayed(item: any): boolean {
  if (item.statusCode === 'DEV_DONE' || item.statusCode === 'TEST_DONE' || item.statusCode === 'REVIEW_DONE') return false
  if (!item.planEndDate) return false
  return new Date(item.planEndDate) < new Date()
}

// 계획 자동 생성
async function autoGeneratePlans(pgmId: number) {
  if (!(await showConfirm('주차별 계획 진척률을 균등 배부로 생성하시겠습니까?\n기존 계획은 초기화됩니다.'))) return
  try {
    const res = await devProgramService.autoPlans(projectId, pgmId)
    if (res.success) await showAlert(`${res.data.length}주차 계획이 생성되었습니다.`)
  } catch (err: any) { showAlert(err?.response?.data?.message || '계획 생성 실패', { color: 'error' }) }
}

// 요구사항 선택
const reqPickerDialog = ref(false)
function openReqPicker() { reqSearchKeyword.value = ''; reqPickerDialog.value = true }
function selectReq(r: any) {
  form.value.reqId = r.reqCode
  form.value.reqName = r.reqName
  reqPickerDialog.value = false
}
function clearReq() { form.value.reqId = ''; form.value.reqName = '' }

// 담당자 선택 (UserTreePicker → update:modelValue)
async function onDevUserChange(userId: string) {
  form.value.devUserId = userId
  if (!userId) { form.value.devUserName = ''; form.value.devTeam = ''; return }
  // members에서 찾기
  const m = members.value.find((m: any) => (m.user?.userId || m.userId) === userId)
  if (m) {
    form.value.devUserName = m.user?.userName || m.userName || userId
    form.value.devTeam = m.user?.department || m.department || ''
  } else {
    // users API에서 조회
    try {
      const res = await import('@/services/users').then(mod => mod.userService.getList({ keyword: userId, size: 1 }))
      const u = res?.data?.[0]
      if (u) { form.value.devUserName = u.userName; form.value.devTeam = u.department || '' }
      else { form.value.devUserName = userId; form.value.devTeam = '' }
    } catch { form.value.devUserName = userId; form.value.devTeam = '' }
  }
}

onMounted(async () => {
  try {
    const [p, r, m, rq, wbs] = await Promise.all([
      projectService.getDetail(projectId),
      projectService.getMyRole(projectId).catch(() => null),
      projectService.getMembers(projectId).catch(() => null),
      requirementService.getList(projectId, { size: 500, progressStatus: '수용' }).catch(() => null),
      wbsService.getFlat(projectId).catch(() => null),
    ])
    if (p.success) project.value = p.data
    if (r?.success) myRole.value = r.data
    if (m?.success) members.value = m.data
    if (rq?.success) requirements.value = rq.data
    if (wbs?.success) wbsDepth2.value = (wbs.data || []).filter((t: any) => t.depth === 2)
  } catch {}
  // 일반 사용자: 본인 담당 기본 필터
  if (!isPmsAdmin.value && authStore.user?.userId) {
    filterDev.value = authStore.user.userId
  }
  fetchList()
  fetchSummary()
  // trend 로딩
  devProgramService.getWeeklyTrend(projectId, {}).then(res => {
    if (res.success) { trend.value = res.data; totalPrograms.value = res.total || 0 }
  }).catch(() => {})
})
</script>

<template>
  <MainLayout>
    <v-row class="mb-1" align="center" dense>
      <v-col>
        <span class="pms-page-title">개발진척관리</span>
        <span class="pms-page-subtitle">{{ project?.projectName }}</span>
      </v-col>
    </v-row>

    <!-- 기준일 + 통계 카드 -->
    <div class="d-flex align-center mb-2" style="gap:12px">
      <div style="width:160px">
        <PmsDatePicker v-model="baseDate" label="기준일" :allow-non-working="true" />
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

    <!-- 필터 -->
    <v-row dense class="mb-1" align="center">
      <v-col cols="6" md="2"><v-select v-model="filterTask" :items="taskOptions" label="업무" hide-details class="pms-filter" @update:model-value="fetchList" /></v-col>
      <v-col cols="6" md="2"><v-select v-model="filterType" :items="PGM_TYPES" label="유형" hide-details class="pms-filter" @update:model-value="fetchList" /></v-col>
      <v-col cols="6" md="2"><v-select v-model="filterStatus" :items="STATUS_ITEMS" label="상태" hide-details class="pms-filter" @update:model-value="fetchList" /></v-col>
      <v-col cols="6" md="2"><v-select v-model="filterDev" :items="devOptions" label="담당자" hide-details class="pms-filter" @update:model-value="fetchList" /></v-col>
      <v-col cols="12" md="3">
        <v-text-field v-model="keyword" placeholder="프로그램ID, 프로그램명" prepend-inner-icon="mdi-magnify" hide-details clearable class="pms-filter" @keyup.enter="fetchList" @click:clear="keyword='';fetchList()" />
      </v-col>
    </v-row>
    <v-row dense class="mb-2" align="center">
      <v-col cols="auto" class="ml-auto d-flex" style="gap:4px">
        <v-btn v-if="isPmsAdmin" size="x-small" color="primary" prepend-icon="mdi-plus" @click="openCreate">등록</v-btn>
        <v-btn size="x-small" variant="outlined" prepend-icon="mdi-file-download-outline" @click="exportExcel">엑셀 다운로드</v-btn>
        <v-btn v-if="isPmsAdmin" size="x-small" variant="outlined" prepend-icon="mdi-file-upload-outline" @click="openImport">엑셀 업로드</v-btn>
      </v-col>
    </v-row>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-1" />

    <!-- 목록 테이블 -->
    <div class="pms-card" style="overflow-x:auto">
      <table class="pms-table" style="width:100%; min-width:1200px">
        <thead>
          <tr>
            <th style="width:40px">No</th>
            <th style="width:110px">프로그램ID</th>
            <th style="min-width:80px">프로그램명</th>
            <th style="width:170px">업무</th>
            <th style="width:50px">유형</th>
            <th style="width:50px">난이도</th>
            <th style="width:80px">담당자</th>
            <th style="width:70px">개발팀</th>
            <th style="width:90px">계획시작일</th>
            <th style="width:90px">계획종료일</th>
            <th style="width:90px">개발완료일</th>
            <th style="width:60px">상태</th>
            <th v-if="isPmsAdmin" style="width:60px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!items.length">
            <td :colspan="isPmsAdmin ? 13 : 12" class="text-center" style="padding:24px; color:var(--pms-text-hint)">등록된 프로그램이 없습니다.</td>
          </tr>
          <tr v-for="(item, idx) in items" :key="item.pgmId" class="pms-table-row-clickable" @click="isPmsAdmin ? openEdit(item) : null">
            <td class="text-center">{{ idx + 1 }}</td>
            <td>{{ item.pgmCode }}</td>
            <td>{{ item.pgmName }}</td>
            <td>{{ item.taskCode }}</td>
            <td class="text-center">{{ PGM_TYPE_LABELS[item.pgmType] || item.pgmType }}</td>
            <td class="text-center">
              <v-chip :color="item.difficulty === 'H' ? 'error' : item.difficulty === 'M' ? 'warning' : 'success'" size="x-small" variant="tonal">{{ item.difficulty === 'H' ? '상' : item.difficulty === 'M' ? '중' : '하' }}</v-chip>
            </td>
            <td>{{ item.devUserName || '' }}</td>
            <td>{{ item.devTeam || '' }}</td>
            <td class="text-center" style="font-size:var(--pms-font-caption)">{{ fmtDate(item.planStartDate) }}</td>
            <td class="text-center" style="font-size:var(--pms-font-caption)">{{ fmtDate(item.planEndDate) }}</td>
            <td class="text-center" style="font-size:var(--pms-font-caption)" @click.stop>
              <template v-if="item.actualEndDate">{{ fmtDate(item.actualEndDate) }}</template>
              <template v-else-if="!isPmsAdmin && (item.devUserId === authStore.user?.userId)">
                <v-btn icon size="x-small" variant="tonal" color="primary" @click="openInlineDatePicker(item)"><v-icon size="14">mdi-calendar-edit</v-icon></v-btn>
              </template>
              <template v-else>-</template>
            </td>
            <td class="text-center">
              <v-chip :color="STATUS_COLORS[item.statusCode] || 'grey'" size="x-small" variant="tonal">{{ STATUS_LABELS[item.statusCode] || item.statusCode }}</v-chip>
            </td>
            <td v-if="isPmsAdmin" class="text-center" @click.stop>
              <v-btn icon size="x-small" variant="text" color="error" @click="deleteItem(item)"><v-icon size="14">mdi-delete</v-icon></v-btn>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 등록/수정 다이얼로그 -->
    <v-dialog v-model="formDialog" max-width="680" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">{{ formEditMode ? '프로그램 수정' : '프로그램 등록' }}</v-card-title>
        <v-card-text>
          <!-- 기본정보 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title"><v-icon size="16">mdi-file-document-edit</v-icon>기본정보</div>
            <v-row dense class="mb-2">
              <v-col cols="4">
                <v-text-field v-model="form.pgmCode" variant="outlined" density="compact" hide-details class="pms-form" :disabled="formEditMode">
                  <template #label>프로그램ID<span class="pms-required">*</span></template>
                </v-text-field>
              </v-col>
              <v-col cols="8">
                <v-text-field v-model="form.pgmName" variant="outlined" density="compact" hide-details class="pms-form">
                  <template #label>프로그램명<span class="pms-required">*</span></template>
                </v-text-field>
              </v-col>
            </v-row>
            <v-row dense>
              <v-col cols="4">
                <v-select v-model="form.taskCode" :items="taskCodeItems" variant="outlined" density="compact" hide-details class="pms-form">
                  <template #label>업무구분<span class="pms-required">*</span></template>
                </v-select>
              </v-col>
              <v-col cols="3">
                <v-select v-model="form.pgmType" :items="PGM_TYPES.slice(1)" label="프로그램유형" variant="outlined" density="compact" hide-details class="pms-form" />
              </v-col>
              <v-col cols="2">
                <v-select v-model="form.difficulty" :items="DIFF_ITEMS" label="난이도" variant="outlined" density="compact" hide-details class="pms-form" />
              </v-col>
              <v-col cols="3">
                <v-select v-model="form.priority" :items="PRIORITY_ITEMS" label="우선순위" variant="outlined" density="compact" hide-details class="pms-form" />
              </v-col>
            </v-row>
          </div>

          <!-- 담당 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title green"><v-icon size="16">mdi-account-group</v-icon>담당</div>
            <v-row dense>
              <v-col cols="5">
                <UserTreePicker :model-value="form.devUserId || ''" @update:model-value="onDevUserChange" :members="members" label="담당자" class="pms-form" hide-details />
              </v-col>
              <v-col cols="3">
                <v-text-field v-model="form.devTeam" label="팀구분" variant="outlined" density="compact" hide-details class="pms-form" readonly />
              </v-col>
            </v-row>
          </div>

          <!-- 일정/상태 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title orange"><v-icon size="16">mdi-calendar-range</v-icon>일정</div>
            <v-row dense>
              <v-col cols="3"><PmsDatePicker v-model="form.planStartDate" label="계획시작일" :required="true" /></v-col>
              <v-col cols="3"><PmsDatePicker v-model="form.planEndDate" label="계획종료일" :required="true" /></v-col>
              <v-col cols="3" v-if="formEditMode"><PmsDatePicker v-model="form.actualStartDate" label="실제시작일" /></v-col>
              <v-col cols="3" v-if="formEditMode"><PmsDatePicker v-model="form.actualEndDate" label="개발완료일" /></v-col>
            </v-row>
            <v-row dense v-if="formEditMode" class="mt-2" align="center">
              <v-col cols="auto">
                <v-btn size="x-small" variant="outlined" color="info" prepend-icon="mdi-calendar-sync" @click="autoGeneratePlans(form.pgmId)">주차계획 생성</v-btn>
              </v-col>
            </v-row>
          </div>

          <!-- 요구사항 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title grey"><v-icon size="16">mdi-format-list-checks</v-icon>요구사항</div>
            <v-row dense align="center">
              <v-col cols="4">
                <v-text-field :model-value="form.reqId || ''" label="요구사항ID" variant="outlined" density="compact" hide-details class="pms-form" readonly append-inner-icon="mdi-magnify" @click:append-inner="openReqPicker" @click="openReqPicker" placeholder="검색" />
              </v-col>
              <v-col cols="7">
                <v-text-field :model-value="form.reqName || ''" label="요구사항명" variant="outlined" density="compact" hide-details class="pms-form" readonly />
              </v-col>
              <v-col cols="1" v-if="form.reqId">
                <v-btn icon size="x-small" variant="text" color="grey" @click="clearReq" title="해제"><v-icon size="14">mdi-close</v-icon></v-btn>
              </v-col>
            </v-row>
          </div>

          <!-- 요구사항 검색 다이얼로그 -->
          <v-dialog v-model="reqPickerDialog" max-width="560" scrollable>
            <v-card>
              <v-card-title class="d-flex align-center" style="font-size:var(--pms-font-subtitle)">
                <v-icon size="16" class="mr-1">mdi-format-list-checks</v-icon>요구사항 검색
              </v-card-title>
              <v-divider />
              <div class="pa-3">
                <v-text-field v-model="reqSearchKeyword" placeholder="요구사항ID 또는 요구사항명 검색" prepend-inner-icon="mdi-magnify" variant="outlined" density="compact" hide-details clearable autofocus class="pms-form" />
              </div>
              <v-divider />
              <v-card-text class="pa-0" style="max-height:360px; overflow-y:auto">
                <div v-if="!reqSearchResults.length" class="text-center pa-6" style="color:var(--pms-text-hint); font-size:var(--pms-font-body)">검색 결과가 없습니다.</div>
                <div v-for="r in reqSearchResults" :key="r.requirementId" class="req-pick-item" @click="selectReq(r)">
                  <div class="d-flex align-center" style="gap:6px">
                    <v-chip size="x-small" variant="tonal" color="primary">{{ r.reqCode }}</v-chip>
                    <span style="font-size:var(--pms-font-body); font-weight:500">{{ r.reqName }}</span>
                  </div>
                  <div style="font-size:var(--pms-font-mini); color:var(--pms-text-hint); margin-top:2px">
                    {{ r.reqType || '' }} {{ r.business ? '· ' + r.business : '' }} {{ r.assigneeName ? '· ' + r.assigneeName : '' }}
                  </div>
                </div>
              </v-card-text>
              <v-divider />
              <v-card-actions class="pa-2">
                <v-spacer />
                <v-btn size="small" variant="text" @click="reqPickerDialog = false">닫기</v-btn>
              </v-card-actions>
            </v-card>
          </v-dialog>

          <!-- 비고 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title grey"><v-icon size="16">mdi-note-text</v-icon>비고</div>
            <v-textarea v-model="form.remark" rows="2" variant="outlined" density="compact" hide-details class="pms-form" auto-grow placeholder="특이사항, 제약조건 등" />
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="outlined" @click="formDialog = false">취소</v-btn>
          <v-btn size="small" color="primary" @click="save">저장</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 엑셀 업로드 다이얼로그 -->
    <v-dialog v-model="importDialog" max-width="480" persistent>
      <v-card>
        <v-card-title class="d-flex align-center" style="font-size:var(--pms-font-subtitle)">
          <v-icon size="16" class="mr-1">mdi-file-upload-outline</v-icon>개발목록 엑셀 임포트
        </v-card-title>
        <v-divider />
        <v-card-text>
          <!-- 임포트 방식 -->
          <div style="font-size:var(--pms-font-body); font-weight:600; margin-bottom:6px">임포트 방식</div>
          <v-radio-group v-model="importMode" inline hide-details class="mb-3">
            <v-radio label="기존 데이터에 추가" value="append" density="compact" />
            <v-radio label="전체 초기화 후 임포트" value="reset" density="compact" />
          </v-radio-group>

          <!-- 템플릿 다운로드 -->
          <v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-file-download-outline" class="mb-3" @click="downloadTemplate">템플릿 다운로드</v-btn>

          <!-- 파일 선택 -->
          <div class="import-file-area mb-3">
            <input type="file" accept=".xlsx,.xls" @change="onFileChange" />
          </div>

          <div style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">
            * 표시 항목은 필수 입력입니다. 중복된 프로그램ID는 {{ importMode === 'append' ? '갱신' : '새로 등록' }}됩니다.
          </div>

          <!-- 결과 -->
          <div v-if="importResult" class="mt-3 pa-3" style="background:var(--pms-surface); border:1px solid var(--pms-border); border-radius:var(--pms-radius)">
            <div style="font-size:var(--pms-font-body); font-weight:600; margin-bottom:4px">임포트 결과</div>
            <v-chip color="success" size="small" variant="tonal" class="mr-1">신규: {{ importResult.created }}건</v-chip>
            <v-chip color="info" size="small" variant="tonal" class="mr-1">갱신: {{ importResult.updated }}건</v-chip>
            <v-chip v-if="importResult.totalErrors" color="error" size="small" variant="tonal">오류: {{ importResult.totalErrors }}건</v-chip>
            <div v-for="(e, i) in importResult.errors" :key="i" style="font-size:var(--pms-font-caption); color:var(--pms-error); margin-top:4px">{{ e }}</div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="outlined" @click="importDialog = false">취소</v-btn>
          <v-btn size="small" color="primary" :loading="importing" @click="doImport">임포트</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <!-- 개발완료일 입력 다이얼로그 -->
    <v-dialog v-model="inlineDateDialog" max-width="320">
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">개발완료일 등록</v-card-title>
        <v-card-text>
          <div v-if="inlineDateItem" style="font-size:var(--pms-font-body); margin-bottom:8px">
            <span style="font-weight:600">{{ inlineDateItem.pgmCode }}</span> {{ inlineDateItem.pgmName }}
          </div>
          <PmsDatePicker v-model="inlineDateValue" label="개발완료일" :required="true" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="outlined" @click="inlineDateDialog = false">취소</v-btn>
          <v-btn size="small" color="primary" @click="saveInlineDate">저장</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </MainLayout>
</template>

<style scoped>
.stat-card {
  background: var(--pms-surface); border: 1px solid var(--pms-border);
  border-radius: var(--pms-radius); padding: 8px 12px; border-left: 3px solid var(--pms-border);
}
.sc-pct { font-size: 22px; font-weight: 700; line-height: 1.2; }
.sc-sub { font-size: 12px; color: var(--pms-text-secondary); font-weight: 500; }
.sc-label { font-size: var(--pms-font-caption); color: var(--pms-text-hint); margin-top: 2px; }
.pms-table-row-clickable { cursor: pointer; }
.pms-table-row-clickable:hover { background: var(--pms-hover, #f5f5f5); }
.req-pick-item {
  padding: 8px 16px; border-bottom: 1px solid var(--pms-border-light, #eee);
  cursor: pointer; transition: background 0.15s;
}
.req-pick-item:hover { background: var(--pms-hover, #f5f5f5); }
.import-file-area {
  border: 1px dashed var(--pms-border, #ccc);
  border-radius: var(--pms-radius, 4px);
  padding: 12px 16px;
  background: var(--pms-surface, #fafafa);
}
.import-file-area input[type="file"] {
  font-size: var(--pms-font-body, 11px);
}
</style>
