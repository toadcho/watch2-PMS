<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import UserTreePicker from '@/components/common/UserTreePicker.vue'
import { issueService, riskService } from '@/services/issueRisk'
import { projectService } from '@/services/projects'
import { useDialog } from '@/composables/useDialog'

const { showAlert, showConfirm } = useDialog()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)

const project = ref<any>(null)
const members = ref<any[]>([])
const myRole = ref<any>(null)
const isPmsAdmin = computed(() => myRole.value?.isPmsAdmin || false)
// 상태변경 권한: 종료 상태가 아니고 (PMS관리자 또는 담당자 본인)
const canChangeStatus = computed(() => {
  if (!selectedItem.value) return false
  const closedStatuses = ['Solved', 'Cancelled', 'Resolved', 'Closed']
  if (closedStatuses.includes(selectedItem.value.status)) return false
  if (isPmsAdmin.value) return true
  return selectedItem.value.assigneeName === authStore.user?.userName
})
const activeTab = ref((route.query.tab as string) || 'issue')
const items = ref<any[]>([])
const loading = ref(false)
const selectedItem = ref<any>(null)
const detailLoading = ref(false)
const keyword = ref('')
const filterStatus = ref('')
const filterCategory = ref('')
const filterImportance = ref('')
const filterUrgency = ref('')
const filterPhase = ref('')

// 편집
const editMode = ref(false)
const isNew = ref(false)
const form = ref<any>({})
const dirty = ref(false)

// 상태변경 다이얼로그
const statusDialog = ref(false)
const statusForm = ref({ status: '', content: '', changeDate: '' })

// 팀 옵션 (투입인력에서 추출)
const teamOptions = computed(() => {
  const set = new Set<string>()
  members.value.forEach(m => { if (m.user?.department) set.add(m.user.department) })
  return ['', ...Array.from(set).sort()]
})

// 범주/유형 옵션
const ISSUE_CATEGORIES: Record<string, string[]> = {
  '기술': ['아키텍처 변경', '기술 호환성 문제', '성능 병목', '보안 취약점 발견', '개발환경 장애', '연계 인터페이스 오류', '행정망/업무망 분리 환경 이슈', 'GS인증 관련 품질 이슈'],
  '요구사항': ['요구사항 변경/추가 요청', '요구사항 해석 차이', '요구사항 누락 발견', '업무 프로세스 변경', '담당자 교체에 따른 재해석', '감리 지적에 의한 재정의'],
  '일정/공정': ['마일스톤 지연', '선행작업 미완료', '검수/인수 일정 변경', '감리 일정 조율', '단계별 산출물 제출 지연'],
  '인력/자원': ['핵심 인력 이탈', '투입 인력 역량 부족', '발주기관 협조 인력 부재', '하도급 업체 인력 관리', '장비/인프라 장애'],
  '이해관계자': ['발주기관/수행사 의사결정 지연', '현업 부서 간 의견 충돌', '감리법인 해석 차이', 'PMO 커뮤니케이션 문제'],
  '계약/행정': ['계약 범위 해석 분쟁', '대가 산정 이견', '하도급 분쟁', '선급금/기성금 지급 지연', '지체상금 문제'],
  '품질/산출물': ['산출물 품질 미달', '감리 지적사항 조치', '테스트 결함 과다', '코드 품질 기준 미충족', '정적분석 위반'],
  '기타': ['기타'],
}
const RISK_CATEGORIES: Record<string, string[]> = {
  '기술': ['신기술/미검증 기술 적용 불확실성', '레거시 연계 실패', '대용량 데이터 이행 정합성', '보안인증(ISMS) 미충족', '클라우드 전환 성능 저하'],
  '일정': ['요구사항 변경 누적→공기 초과', '외부 연계기관 협조 지연', '감리/검수 반려 재작업', '연말 집중 검수 병목'],
  '인력/자원': ['핵심 개발자 이직', '기술 전문가 수급 난', '하도급 업체 부도/해지', '장비/인프라 조달 지연'],
  '범위': ['Scope creep(범위 잠식)', '과도한 추가 요구', '타 사업 범위 중복/충돌', 'RFP 대비 업무량 과소 산정'],
  '외부환경': ['법규/제도 변경(개인정보보호법,전자정부법)', '정부 정책 전환', '예산 삭감/이월', '조직개편→사업 방향 변경'],
  '계약/재무': ['저가 수주→원가 초과', '추가 비용 계약 변경 불가', '하도급 대금 분쟁', '지체상금 부과 가능성'],
  '품질': ['테스트 커버리지 부족→운영 장애', '감리 부적합 판정', '성능 목표 미달', 'UAT 실패 가능성'],
  '기타': ['기타'],
}
const categoryOptions = computed(() => {
  const cats = activeTab.value === 'issue' ? ISSUE_CATEGORIES : RISK_CATEGORIES
  return ['', ...Object.keys(cats)]
})
const subTypeOptions = computed(() => {
  const cats = activeTab.value === 'issue' ? ISSUE_CATEGORIES : RISK_CATEGORIES
  const cat = form.value.category
  return cat && cats[cat] ? ['', ...cats[cat]] : ['']
})

const issueStatuses = ['Opened', 'Progressed', 'Solved', 'Cancelled']
const riskStatuses = ['Opened', 'Accepted', 'Resolved', 'Closed']
const statusOptions = computed(() => activeTab.value === 'issue' ? issueStatuses : riskStatuses)
const statusFilterOptions = computed(() => [{ title: '전체', value: '' }, ...statusOptions.value.map(s => ({ title: s, value: s }))])
const categoryFilterOptions = computed(() => [{ title: '전체', value: '' }, ...Object.keys(activeTab.value === 'issue' ? ISSUE_CATEGORIES : RISK_CATEGORIES).map(c => ({ title: c, value: c }))])
const phaseOptions = ['', '착수/계획', '분석', '설계', '구현', '시험', '이행']
const levelOptions = ['', '상', '중', '하']
const approachOptions = ['', '완화', '수용', '회피', '전이']

const statusColor: Record<string, string> = { Opened: 'error', Progressed: 'warning', Solved: 'success', Cancelled: 'grey', Accepted: 'info', Resolved: 'success', Closed: 'grey' }

const svc = computed(() => activeTab.value === 'issue' ? issueService : riskService)
const titleField = computed(() => activeTab.value === 'issue' ? 'issueTitle' : 'riskName')
const idField = computed(() => activeTab.value === 'issue' ? 'issueId' : 'riskId')

async function fetchList() {
  loading.value = true
  try {
    const params: any = {}
    if (keyword.value) params.keyword = keyword.value
    if (filterStatus.value) params.status = filterStatus.value
    if (filterCategory.value) params.category = filterCategory.value
    if (filterImportance.value) params.importance = filterImportance.value
    if (filterUrgency.value) params.urgency = filterUrgency.value
    if (filterPhase.value) params.phase = filterPhase.value
    const res = await svc.value.getList(projectId, params)
    if (res.success) {
      items.value = res.data
      // 현재 선택된 항목이 필터 결과에 없으면 상세 초기화
      if (selectedItem.value && !res.data.find((i: any) => i[idField.value] === selectedItem.value[idField.value])) {
        selectedItem.value = null
      }
    }
  } catch (err) { console.error(err) }
  finally { loading.value = false }
}

async function selectItem(item: any) {
  if (editMode.value) return
  detailLoading.value = true
  try {
    const id = item[idField.value]
    console.log('[selectItem]', idField.value, id)
    const res = await svc.value.getDetail(projectId, id)
    if (res.success) { selectedItem.value = res.data; editMode.value = false; isNew.value = false }
  } catch (err: any) {
    console.error('[selectItem error]', err?.response?.data || err)
    showAlert(err?.response?.data?.message || '상세 조회 실패', { color: 'error' })
  }
  finally { detailLoading.value = false }
}

function openCreate() {
  isNew.value = true; editMode.value = true; selectedItem.value = null; dirty.value = false
  form.value = activeTab.value === 'issue'
    ? { issueTitle: '', category: '', subType: '', phase: '', teamDept: '', content: '', impact: '', importance: '중', urgency: '중', status: 'Opened', assigneeName: '', relatedClient: '', identifiedAt: new Date().toISOString().substring(0, 10), expectedEndAt: '', resolution: '', shareTarget: '', internalExternal: '내부', requestToClient: '', requestFromClient: '', remark: '', relatedRiskId: '' }
    : { riskName: '', category: '', subType: '', phase: '', teamDept: '', content: '', impact: '', impactLevel: '중', probability: '중', approach: '완화', status: 'Opened', assigneeName: '', relatedClient: '', identifiedAt: new Date().toISOString().substring(0, 10), expectedAt: '', actionHistory: '', contingencyPlan: '', internalExternal: '내부', occurrenceRate: '', remark: '' }
}

function startEdit() {
  if (!selectedItem.value) return
  editMode.value = true; isNew.value = false; dirty.value = false
  const i = selectedItem.value
  form.value = { ...i, identifiedAt: i.identifiedAt?.substring(0, 10) || '', expectedEndAt: i.expectedEndAt?.substring(0, 10) || '', resolvedAt: i.resolvedAt?.substring(0, 10) || '' }
}

function cancelEdit() { editMode.value = false; isNew.value = false; dirty.value = false }

async function save() {
  const title = form.value[titleField.value]
  if (!title) { await showAlert(`${activeTab.value === 'issue' ? '이슈' : '리스크'} 제목은 필수입니다.`, { color: 'error' }); return }
  try {
    if (isNew.value) {
      const res = await svc.value.create(projectId, form.value)
      if (res.success) { editMode.value = false; isNew.value = false; fetchList(); selectedItem.value = res.data; await showAlert('저장이 완료되었습니다.') }
    } else {
      const res = await svc.value.update(projectId, selectedItem.value[idField.value], form.value)
      if (res.success) { editMode.value = false; fetchList(); selectedItem.value = res.data; await showAlert('저장이 완료되었습니다.') }
    }
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
}

async function deleteItem() {
  if (!selectedItem.value) return
  if (!(await showConfirm('삭제하시겠습니까?'))) return
  try {
    await svc.value.remove(projectId, selectedItem.value[idField.value])
    selectedItem.value = null; editMode.value = false; fetchList()
    await showAlert('삭제되었습니다.')
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

function openStatusChange() {
  if (!selectedItem.value) return
  statusForm.value = { status: selectedItem.value.status, content: '', changeDate: new Date().toISOString().substring(0, 10) }
  statusDialog.value = true
}

async function saveStatusChange() {
  if (!(await showConfirm('상태를 변경하시겠습니까?'))) return
  try {
    const res = await svc.value.update(projectId, selectedItem.value[idField.value], { status: statusForm.value.status, statusChangeContent: statusForm.value.content })
    if (res.success) { statusDialog.value = false; await showAlert('상태가 변경되었습니다.'); selectItem(selectedItem.value); fetchList() }
  } catch (err: any) { showAlert(err.response?.data?.message || '상태 변경 실패', { color: 'error' }) }
}

function fmtDate(d: string | null) { return d ? d.substring(0, 10) : '-' }
function fmtDT(d: string | null) { return d ? new Date(d).toLocaleString('ko-KR') : '-' }

// 공유여부 체크박스 ↔ 문자열 변환
const shareTargetArr = computed({
  get: () => (form.value.shareTarget || '').split(',').filter((s: string) => s),
  set: (val: string[]) => { form.value.shareTarget = val.join(','); dirty.value = true },
})

// 담당자 UserTreePicker
const assigneeUserId = ref('')
function onAssigneeChange(userId: string) {
  assigneeUserId.value = userId
  const m = members.value.find((m: any) => (m.user?.userId || m.userId) === userId)
  form.value.assigneeName = m ? (m.user?.userName || m.userName || userId) : userId
  dirty.value = true
}
const clientPickerDialog = ref(false)
const clientUserId = ref('')
function openClientPicker() { clientPickerDialog.value = true }
function onClientChange(userId: string) {
  clientUserId.value = userId
  const m = members.value.find((m: any) => (m.user?.userId || m.userId) === userId)
  form.value.relatedClient = m ? (m.user?.userName || m.userName || userId) : userId
  dirty.value = true
  clientPickerDialog.value = false
}

watch(activeTab, () => { selectedItem.value = null; editMode.value = false; isNew.value = false; filterStatus.value = ''; filterCategory.value = ''; filterImportance.value = ''; filterUrgency.value = ''; filterPhase.value = ''; keyword.value = ''; fetchList() })

onMounted(async () => {
  try {
    const [p, m, r] = await Promise.all([
      projectService.getDetail(projectId),
      projectService.getMembers(projectId).catch(() => null),
      projectService.getMyRole(projectId).catch(() => null),
    ])
    if (p.success) project.value = p.data
    if (m?.success) members.value = m.data
    if (r?.success) myRole.value = r.data
  } catch {}
  fetchList()
})
</script>

<template>
  <MainLayout>
    <v-row class="mb-1" align="center" dense>
      <v-col cols="auto"><v-btn icon size="small" variant="text" @click="router.push(`/projects/${projectId}`)"><v-icon>mdi-arrow-left</v-icon></v-btn></v-col>
      <v-col><span class="pms-page-title">이슈/리스크 관리</span><span class="pms-page-subtitle">{{ project?.projectName }}</span></v-col>
    </v-row>

    <!-- 탭 -->
    <v-tabs v-model="activeTab" density="compact" class="mb-2">
      <v-tab value="issue" size="small"><v-icon size="14" start>mdi-alert-circle</v-icon>이슈</v-tab>
      <v-tab value="risk" size="small"><v-icon size="14" start>mdi-shield-alert</v-icon>리스크</v-tab>
    </v-tabs>

    <!-- 필터 1행: 범주, 상태, 중요도/영향도 -->
    <v-row class="mb-1" dense align="center">
      <v-col cols="6" md="2">
        <v-select v-model="filterCategory" :items="categoryFilterOptions" label="범주" hide-details class="pms-filter" @update:model-value="fetchList" />
      </v-col>
      <v-col cols="6" md="2">
        <v-select v-model="filterStatus" :items="statusFilterOptions" label="상태" hide-details class="pms-filter" @update:model-value="fetchList" />
      </v-col>
      <v-col cols="6" md="1">
        <v-select v-model="filterImportance" :items="[{title:'전체',value:''},...levelOptions.filter(v=>v).map(v=>({title:v,value:v}))]" :label="activeTab==='issue'?'중요도':'영향도'" hide-details class="pms-filter" @update:model-value="fetchList" />
      </v-col>
      <v-col cols="6" md="1" v-if="activeTab==='issue'">
        <v-select v-model="filterUrgency" :items="[{title:'전체',value:''},...levelOptions.filter(v=>v).map(v=>({title:v,value:v}))]" label="긴급성" hide-details class="pms-filter" @update:model-value="fetchList" />
      </v-col>
      <v-col cols="6" md="1">
        <v-select v-model="filterPhase" :items="[{title:'전체',value:''},...phaseOptions.filter(v=>v).map(v=>({title:v,value:v}))]" label="단계" hide-details class="pms-filter" @update:model-value="fetchList" />
      </v-col>
    </v-row>
    <!-- 필터 2행: 담당자, 제목 검색, 등록 버튼 -->
    <v-row class="mb-2" dense align="center">
      <v-col cols="12" md="4">
        <v-text-field v-model="keyword" placeholder="제목, 내용 검색" prepend-inner-icon="mdi-magnify" hide-details clearable class="pms-filter" @keyup.enter="fetchList" @click:clear="keyword='';fetchList()" />
      </v-col>
      <v-col cols="auto" class="ml-auto">
        <v-btn color="primary" size="x-small" prepend-icon="mdi-plus" @click="openCreate">등록</v-btn>
      </v-col>
    </v-row>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

    <div class="d-flex" style="gap:0; min-height:500px; border:1px solid var(--pms-border); border-radius:var(--pms-radius); overflow:hidden">
      <!-- 좌: 목록 -->
      <div style="width:420px; min-width:420px; border-right:1px solid var(--pms-border-light); overflow-y:auto; background:var(--pms-surface)">
        <div v-if="!items.length" class="text-center py-8" style="color:var(--pms-text-hint); font-size:var(--pms-font-body)">등록된 {{ activeTab === 'issue' ? '이슈' : '리스크' }}가 없습니다.</div>
        <div v-for="item in items" :key="item[idField]" class="list-item" :class="{ 'list-selected': selectedItem && selectedItem[idField] === item[idField] }" @click="selectItem(item)">
          <div class="d-flex align-center ga-1">
            <v-chip :color="statusColor[item.status] || 'grey'" size="x-small" variant="tonal">{{ item.status }}</v-chip>
            <v-chip v-if="item.category" size="x-small" variant="outlined">{{ item.category }}</v-chip>
            <v-spacer />
            <span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ fmtDate(item.identifiedAt || item.createdAt) }}</span>
          </div>
          <div class="list-title mt-1">{{ item[titleField] }}</div>
          <div class="d-flex align-center ga-2 mt-1" style="font-size:var(--pms-font-mini); color:var(--pms-text-secondary)">
            <span v-if="item.assigneeName"><v-icon size="10">mdi-account</v-icon> {{ item.assigneeName }}</span>
            <span v-if="item.teamDept">{{ item.teamDept }}</span>
            <span v-if="activeTab==='issue' && item.importance">중요도:{{ item.importance }}</span>
            <span v-if="activeTab==='risk' && item.impactLevel">영향도:{{ item.impactLevel }}</span>
          </div>
        </div>
      </div>

      <!-- 우: 상세/편집 -->
      <div style="flex:1; overflow-y:auto; background:var(--pms-bg)">
        <!-- 미선택 -->
        <div v-if="!selectedItem && !isNew" class="d-flex align-center justify-center" style="height:100%">
          <div class="text-center" style="color:var(--pms-text-hint)">
            <v-icon size="48" color="grey-lighten-1">mdi-file-document-outline</v-icon>
            <div class="mt-2" style="font-size:var(--pms-font-body)">좌측에서 {{ activeTab === 'issue' ? '이슈' : '리스크' }}를 선택하세요</div>
          </div>
        </div>

        <!-- 보기 모드 -->
        <div v-else-if="!editMode && selectedItem" class="pa-4">
          <div class="d-flex align-center mb-2">
            <v-chip :color="statusColor[selectedItem.status]" size="small" variant="tonal" class="mr-2">{{ selectedItem.status }}</v-chip>
            <span style="font-size:var(--pms-font-subtitle); font-weight:600">{{ selectedItem[titleField] }}</span>
            <v-spacer />
            <v-btn v-if="canChangeStatus" size="x-small" variant="outlined" color="info" prepend-icon="mdi-swap-horizontal" class="mr-1" @click="openStatusChange">상태변경</v-btn>
            <v-btn v-if="isPmsAdmin" size="x-small" variant="outlined" prepend-icon="mdi-pencil" class="mr-1" @click="startEdit">수정</v-btn>
            <v-btn v-if="isPmsAdmin && selectedItem.status === 'Opened'" size="x-small" variant="outlined" color="error" prepend-icon="mdi-delete" @click="deleteItem">삭제</v-btn>
          </div>
          <div class="pms-card">
            <table class="pms-detail-table">
              <tbody>
                <tr>
                  <td class="pms-detail-label">ID</td><td class="pms-detail-value">{{ selectedItem[idField] }}</td>
                  <td class="pms-detail-label">상태</td>
                  <td class="pms-detail-value"><v-chip :color="statusColor[selectedItem.status]||'grey'" size="x-small" variant="tonal">{{ selectedItem.status }}</v-chip></td>
                </tr>
                <tr>
                  <td class="pms-detail-label">범주</td><td class="pms-detail-value">{{ selectedItem.category || '-' }}</td>
                  <td class="pms-detail-label">세부유형</td><td class="pms-detail-value">{{ selectedItem.subType || '-' }}</td>
                </tr>
                <tr>
                  <td class="pms-detail-label">제목</td><td class="pms-detail-value" colspan="3">{{ selectedItem[titleField] }}</td>
                </tr>
                <tr>
                  <td class="pms-detail-label">단계</td><td class="pms-detail-value">{{ selectedItem.phase || '-' }}</td>
                  <td class="pms-detail-label">팀구분</td><td class="pms-detail-value">{{ selectedItem.teamDept || '-' }}</td>
                </tr>
                <tr>
                  <td class="pms-detail-label">발생일</td><td class="pms-detail-value">{{ fmtDate(selectedItem.identifiedAt) }}</td>
                  <td class="pms-detail-label">담당자</td><td class="pms-detail-value">{{ selectedItem.assigneeName || '-' }}</td>
                </tr>
                <tr v-if="activeTab==='issue'">
                  <td class="pms-detail-label">중요도</td><td class="pms-detail-value">{{ selectedItem.importance || '-' }}</td>
                  <td class="pms-detail-label">긴급성</td><td class="pms-detail-value">{{ selectedItem.urgency || '-' }}</td>
                </tr>
                <tr v-if="activeTab==='risk'">
                  <td class="pms-detail-label">영향도</td><td class="pms-detail-value">{{ selectedItem.impactLevel || '-' }}</td>
                  <td class="pms-detail-label">가능성</td><td class="pms-detail-value">{{ selectedItem.probability || '-' }}</td>
                </tr>
                <tr v-if="activeTab==='risk'">
                  <td class="pms-detail-label">접근방안</td><td class="pms-detail-value">{{ selectedItem.approach || '-' }}</td>
                  <td class="pms-detail-label">발생확률</td><td class="pms-detail-value">{{ selectedItem.occurrenceRate != null ? selectedItem.occurrenceRate + '%' : '-' }}</td>
                </tr>
                <tr>
                  <td class="pms-detail-label">공유대상</td><td class="pms-detail-value">{{ selectedItem.shareTarget || '-' }}</td>
                  <td class="pms-detail-label">관련고객명</td><td class="pms-detail-value">{{ selectedItem.relatedClient || '-' }}</td>
                </tr>
                <tr>
                  <td class="pms-detail-label">내부/외부</td><td class="pms-detail-value">{{ selectedItem.internalExternal || '-' }}</td>
                  <td class="pms-detail-label"></td><td class="pms-detail-value"></td>
                </tr>
                <tr>
                  <td class="pms-detail-label">{{ activeTab==='issue'?'해결예정일':'발생가능시점' }}</td>
                  <td class="pms-detail-value">{{ activeTab==='issue' ? fmtDate(selectedItem.expectedEndAt) : (selectedItem.expectedAt || '-') }}</td>
                  <td class="pms-detail-label">해결일</td><td class="pms-detail-value">{{ fmtDate(selectedItem.resolvedAt) }}</td>
                </tr>
                <tr>
                  <td class="pms-detail-label">최종상태변경일</td>
                  <td class="pms-detail-value">{{ selectedItem.statusHistory?.length ? fmtDT(selectedItem.statusHistory[0].changeDate) : '-' }}</td>
                  <td class="pms-detail-label">최종상태변경자</td>
                  <td class="pms-detail-value">{{ selectedItem.statusHistory?.length ? (selectedItem.statusHistory[0].changedByName || selectedItem.statusHistory[0].changedBy) : '-' }}</td>
                </tr>
                <tr>
                  <td class="pms-detail-label">등록자</td><td class="pms-detail-value">{{ selectedItem.createdByName || selectedItem.createdBy || '-' }}</td>
                  <td class="pms-detail-label">등록일</td><td class="pms-detail-value">{{ fmtDT(selectedItem.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
            <v-divider />
            <div class="pa-3">
              <div class="pms-form-group-title grey mb-2"><v-icon size="14">mdi-text-box</v-icon>내용 (현상/원인/예상문제점/해결가능방안/내외부)</div>
              <div style="white-space:pre-wrap; font-size:var(--pms-font-body); color:var(--pms-text-primary); min-height:40px">{{ selectedItem.content || '-' }}</div>
            </div>
            <v-divider />
            <div class="pa-3">
              <div class="pms-form-group-title grey mb-2"><v-icon size="14">mdi-alert</v-icon>영향 (범위/일정/자원)</div>
              <div style="white-space:pre-wrap; font-size:var(--pms-font-body)">{{ selectedItem.impact || '-' }}</div>
            </div>
            <v-divider />
            <div class="pa-3">
              <div class="pms-form-group-title grey mb-2"><v-icon size="14">mdi-wrench</v-icon>{{ activeTab==='issue'?'해결방법 및 조치사항':'조치내역' }}</div>
              <div style="white-space:pre-wrap; font-size:var(--pms-font-body)">{{ (activeTab==='issue' ? selectedItem.resolution : selectedItem.actionHistory) || '-' }}</div>
            </div>
            <template v-if="activeTab==='issue'">
              <v-divider />
              <div class="pa-3">
                <div class="pms-form-group-title grey mb-2"><v-icon size="14">mdi-arrow-right-bold</v-icon>요청사항 (프로젝트팀 → 추진단)</div>
                <div style="white-space:pre-wrap; font-size:var(--pms-font-body)">{{ selectedItem.requestToClient || '-' }}</div>
              </div>
              <v-divider />
              <div class="pa-3">
                <div class="pms-form-group-title grey mb-2"><v-icon size="14">mdi-arrow-left-bold</v-icon>요청사항 (추진단 → 프로젝트팀)</div>
                <div style="white-space:pre-wrap; font-size:var(--pms-font-body)">{{ selectedItem.requestFromClient || '-' }}</div>
              </div>
            </template>
            <template v-if="activeTab==='risk'">
              <v-divider />
              <div class="pa-3">
                <div class="pms-form-group-title grey mb-2"><v-icon size="14">mdi-shield-check</v-icon>비상대처계획</div>
                <div style="white-space:pre-wrap; font-size:var(--pms-font-body)">{{ selectedItem.contingencyPlan || '-' }}</div>
              </div>
            </template>
            <v-divider v-if="selectedItem.remark" />
            <div v-if="selectedItem.remark" class="pa-3">
              <div class="pms-form-group-title grey mb-2"><v-icon size="14">mdi-note-text</v-icon>비고</div>
              <div style="white-space:pre-wrap; font-size:var(--pms-font-body)">{{ selectedItem.remark }}</div>
            </div>
            <!-- 관련 리스크 (이슈만) -->
            <template v-if="activeTab==='issue' && selectedItem.relatedRiskId">
              <v-divider />
              <div class="pa-3">
                <div class="pms-form-group-title orange mb-2"><v-icon size="14">mdi-link</v-icon>관련 리스크</div>
                <div style="font-size:var(--pms-font-body)">리스크 ID: {{ selectedItem.relatedRiskId }}</div>
              </div>
            </template>
          </div>
          <!-- 상태변경 이력 -->
          <div v-if="selectedItem.statusHistory?.length" class="pms-card mt-3">
            <div class="pms-section-header" style="background:var(--pms-info-light)">상태변경 이력 ({{ selectedItem.statusHistory.length }}건)</div>
            <table class="pms-detail-table">
              <thead><tr><th class="dt-th" width="40">#</th><th class="dt-th">상태</th><th class="dt-th">변경내용</th><th class="dt-th" width="80">변경자</th><th class="dt-th" width="130">변경일시</th></tr></thead>
              <tbody>
                <tr v-for="(h, idx) in selectedItem.statusHistory" :key="h.historyId">
                  <td class="text-center">{{ selectedItem.statusHistory.length - idx }}</td>
                  <td class="text-center"><v-chip :color="statusColor[h.status]||'grey'" size="x-small" variant="tonal">{{ h.status }}</v-chip></td>
                  <td>{{ h.changeContent || '-' }}</td>
                  <td class="text-center">{{ h.changedByName || h.changedBy }}</td>
                  <td class="text-center" style="font-size:var(--pms-font-caption)">{{ fmtDT(h.changeDate) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 편집 모드 -->
        <div v-else-if="editMode" class="pa-4 pms-form">
          <div class="mb-2" style="font-size:var(--pms-font-subtitle); font-weight:600">{{ isNew ? (activeTab==='issue'?'이슈 등록':'리스크 등록') : '수정' }}</div>
          <div class="pms-card mb-3"><div class="pms-card-body">
            <!-- 제목 -->
            <div class="pms-form-group">
              <div class="pms-form-group-title"><v-icon size="14">mdi-text-short</v-icon>기본 정보</div>
              <v-text-field v-model="form[titleField]" :label="(activeTab==='issue'?'이슈':'리스크')+' 제목 *'" class="mb-1" @update:model-value="dirty=true" />
              <v-row dense>
                <v-col cols="6" md="2"><v-select v-model="form.category" :items="categoryOptions" label="범주" @update:model-value="() => { form.subType=''; dirty=true }" /></v-col>
                <v-col cols="6" md="3"><v-select v-model="form.subType" :items="subTypeOptions" label="세부유형" @update:model-value="dirty=true" /></v-col>
                <v-col cols="6" md="2"><v-select v-model="form.status" :items="statusOptions" label="상태" @update:model-value="dirty=true" /></v-col>
                <v-col cols="6" md="2"><v-select v-model="form.phase" :items="phaseOptions" label="단계" @update:model-value="dirty=true" /></v-col>
                <v-col cols="6" md="3"><v-select v-model="form.teamDept" :items="teamOptions" label="팀구분" @update:model-value="dirty=true" /></v-col>
              </v-row>
            </div>
            <!-- 평가 -->
            <div class="pms-form-group">
              <div class="pms-form-group-title orange"><v-icon size="14">mdi-gauge</v-icon>평가</div>
              <v-row dense>
                <template v-if="activeTab==='issue'">
                  <v-col cols="6" md="3"><v-select v-model="form.importance" :items="levelOptions" label="중요도" @update:model-value="dirty=true" /></v-col>
                  <v-col cols="6" md="3"><v-select v-model="form.urgency" :items="levelOptions" label="긴급성" @update:model-value="dirty=true" /></v-col>
                </template>
                <template v-else>
                  <v-col cols="6" md="2"><v-select v-model="form.impactLevel" :items="levelOptions" label="영향도" @update:model-value="dirty=true" /></v-col>
                  <v-col cols="6" md="2"><v-select v-model="form.probability" :items="levelOptions" label="가능성" @update:model-value="dirty=true" /></v-col>
                  <v-col cols="6" md="2"><v-select v-model="form.approach" :items="approachOptions" label="접근방안" @update:model-value="dirty=true" /></v-col>
                  <v-col cols="6" md="3"><v-text-field v-model.number="form.occurrenceRate" label="발생확률 (%)" type="number" min="0" max="100" @update:model-value="dirty=true" /></v-col>
                </template>
              </v-row>
            </div>
            <!-- 담당/일정 -->
            <div class="pms-form-group">
              <div class="pms-form-group-title grey"><v-icon size="14">mdi-account-group</v-icon>담당 및 일정</div>
              <v-row dense class="mb-1">
                <v-col cols="6" md="3"><UserTreePicker v-model="assigneeUserId" :members="members" label="담당자" @update:model-value="onAssigneeChange" /></v-col>
                <v-col cols="6" md="3">
                  <v-text-field v-model="form.relatedClient" label="관련고객명" append-inner-icon="mdi-account-search" @click:append-inner="openClientPicker" @update:model-value="dirty=true" />
                </v-col>
                <v-col cols="6" md="3"><v-text-field v-model="form.identifiedAt" label="식별일" type="date" @update:model-value="dirty=true" /></v-col>
                <v-col cols="6" md="3" v-if="activeTab==='issue'"><v-text-field v-model="form.expectedEndAt" label="해결예정일" type="date" @update:model-value="dirty=true" /></v-col>
                <v-col cols="6" md="3" v-if="activeTab==='risk'"><v-text-field v-model="form.expectedAt" label="발생가능시점" @update:model-value="dirty=true" /></v-col>
              </v-row>
              <v-row dense>
                <v-col cols="12" md="6">
                  <div style="font-size:var(--pms-font-label); color:var(--pms-text-label); margin-bottom:4px">공유여부</div>
                  <div class="d-flex ga-3">
                    <v-checkbox v-model="shareTargetArr" value="관리자" label="관리자" density="compact" hide-details class="mt-0" />
                    <v-checkbox v-model="shareTargetArr" value="TM" label="TM" density="compact" hide-details class="mt-0" />
                    <v-checkbox v-model="shareTargetArr" value="Customer" label="Customer" density="compact" hide-details class="mt-0" />
                    <v-checkbox v-model="shareTargetArr" value="기타" label="기타" density="compact" hide-details class="mt-0" />
                  </div>
                </v-col>
                <v-col cols="6" md="3"><v-select v-model="form.internalExternal" :items="['내부','외부']" label="내부/외부" @update:model-value="dirty=true" /></v-col>
              </v-row>
            </div>
            <!-- 내용 -->
            <div class="pms-form-group">
              <div class="pms-form-group-title green"><v-icon size="14">mdi-text-box</v-icon>내용 및 영향</div>
              <v-textarea v-model="form.content" label="내용 (현상/원인/예상문제점/해결방안/내외부)" rows="5" class="mb-1" @update:model-value="dirty=true" />
              <v-textarea v-model="form.impact" label="영향 (범위/일정/자원)" rows="3" @update:model-value="dirty=true" />
            </div>
            <!-- 조치 -->
            <div class="pms-form-group">
              <div class="pms-form-group-title grey"><v-icon size="14">mdi-wrench</v-icon>조치</div>
              <v-textarea v-if="activeTab==='issue'" v-model="form.resolution" label="해결방법 및 조치사항" rows="3" class="mb-1" @update:model-value="dirty=true" />
              <v-textarea v-if="activeTab==='risk'" v-model="form.actionHistory" label="조치내역" rows="3" class="mb-1" @update:model-value="dirty=true" />
              <v-textarea v-if="activeTab==='risk'" v-model="form.contingencyPlan" label="비상대처계획" rows="2" class="mb-1" @update:model-value="dirty=true" />
              <v-textarea v-if="activeTab==='issue'" v-model="form.requestToClient" label="요청사항 (프로젝트팀→추진단)" rows="2" class="mb-1" @update:model-value="dirty=true" />
              <v-textarea v-if="activeTab==='issue'" v-model="form.requestFromClient" label="요청사항 (추진단→프로젝트팀)" rows="2" class="mb-1" @update:model-value="dirty=true" />
              <v-textarea v-model="form.remark" label="비고" rows="2" @update:model-value="dirty=true" />
            </div>
          </div></div>
          <div class="d-flex justify-end ga-2">
            <v-btn variant="outlined" size="small" @click="cancelEdit">취소</v-btn>
            <v-btn color="primary" size="small" @click="save">저장</v-btn>
          </div>
        </div>
      </div>
    </div>

    <!-- 상태변경 다이얼로그 -->
    <v-dialog v-model="statusDialog" max-width="600">
      <v-card class="pms-form">
        <v-card-title class="d-flex align-center" style="font-size:13px; font-weight:600">
          <v-icon size="16" class="mr-1" color="info">mdi-swap-horizontal</v-icon>{{ activeTab==='issue'?'이슈':'리스크' }} 상태 변경
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-4">
          <!-- 상태이력 -->
          <div v-if="selectedItem?.statusHistory?.length" class="mb-3">
            <div class="pms-form-group-title grey mb-2"><v-icon size="14">mdi-history</v-icon>상태이력</div>
            <table class="pms-detail-table">
              <thead><tr><th class="dt-th">상태변경일</th><th class="dt-th">상태</th><th class="dt-th">상태변경내용</th><th class="dt-th">변경자</th></tr></thead>
              <tbody>
                <tr v-for="h in selectedItem.statusHistory" :key="h.historyId">
                  <td class="text-center" style="font-size:var(--pms-font-caption)">{{ fmtDT(h.changeDate) }}</td>
                  <td class="text-center"><v-chip :color="statusColor[h.status]||'grey'" size="x-small" variant="tonal">{{ h.status }}</v-chip></td>
                  <td>{{ h.changeContent || '-' }}</td>
                  <td class="text-center">{{ h.changedByName || h.changedBy }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <v-divider v-if="selectedItem?.statusHistory?.length" class="mb-3" />

          <!-- 상태 변경 폼 -->
          <div class="pms-form-group-title mb-2"><v-icon size="14">mdi-pencil</v-icon>상태 변경</div>
          <table class="pms-detail-table mb-3">
            <tbody>
              <tr><td class="pms-detail-label" width="80">ID</td><td class="pms-detail-value">{{ selectedItem?.[idField] }}</td><td class="pms-detail-label" width="80">범주</td><td class="pms-detail-value">{{ selectedItem?.category || '-' }}</td></tr>
              <tr><td class="pms-detail-label">제목</td><td class="pms-detail-value" colspan="3">{{ selectedItem?.[titleField] }}</td></tr>
            </tbody>
          </table>
          <v-row dense class="mb-2">
            <v-col cols="6">
              <v-select v-model="statusForm.status" :items="statusOptions" label="상태 *" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="statusForm.changeDate" label="상태변경일" type="date" />
            </v-col>
          </v-row>
          <v-textarea v-model="statusForm.content" label="변경내용" rows="3" placeholder="상태 변경 사유 및 내용을 입력하세요" />
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-4 py-2">
          <v-spacer />
          <v-btn variant="outlined" size="small" @click="statusDialog=false">취소</v-btn>
          <v-btn color="primary" size="small" @click="saveStatusChange">저장</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 관련고객명 선택 다이얼로그 -->
    <v-dialog v-model="clientPickerDialog" max-width="480" scrollable>
      <v-card>
        <v-card-title style="font-size:13px; font-weight:600">관련고객명 선택</v-card-title>
        <v-divider />
        <v-card-text class="pa-0">
          <UserTreePicker v-model="clientUserId" :members="members" label="관련고객명" @update:model-value="onClientChange" />
        </v-card-text>
      </v-card>
    </v-dialog>
  </MainLayout>
</template>

<style scoped>
.list-item { padding:8px 12px; border-bottom:1px solid var(--pms-border-light); cursor:pointer; transition:background 0.15s; }
.list-item:hover { background:var(--pms-surface-hover); }
.list-selected { background:rgba(var(--v-theme-primary),0.1) !important; border-left:3px solid var(--pms-primary); }
.list-title { font-size:var(--pms-font-body); font-weight:600; line-height:1.3; }
.dt-th { background:var(--pms-surface-variant); font-size:var(--pms-font-caption) !important; font-weight:600; text-align:center; padding:4px 6px !important; border-bottom:2px solid var(--pms-border-dark) !important; }
</style>
