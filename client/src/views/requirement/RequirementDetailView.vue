<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import UserTreePicker from '@/components/common/UserTreePicker.vue'
import { requirementService } from '@/services/requirements'
import { projectService } from '@/services/projects'
import { useDialog } from '@/composables/useDialog'

const { showAlert, showConfirm } = useDialog()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)
const requirementId = route.params.requirementId as string

const isNew = requirementId === 'new'
const editMode = ref(isNew)
const item = ref<any>(null)
const project = ref<any>(null)
const dirty = ref(false)
const loading = ref(false)

const myRole = ref<any>(null)
const isPmsAdmin = computed(() => myRole.value?.isPmsAdmin || false)
// 수정 권한: PMS관리자 또는 담당자 본인
const canEdit = computed(() => {
  if (isPmsAdmin.value) return true
  if (!item.value || !authStore.user) return false
  return item.value.assigneeName === authStore.user.userName
})
const members = ref<any[]>([])

const changeMode = ref(false)
const changeReason = ref('')
const assigneeUserId = ref('')
const reviewerUserId = ref('')

// UserTreePicker 선택 시 이름 동기화
function onAssigneeChange(userId: string) {
  assigneeUserId.value = userId
  const m = members.value.find((m: any) => (m.user?.userId || m.userId) === userId)
  form.value.assigneeName = m ? (m.user?.userName || m.userName || userId) : userId
  dirty.value = true
}
function onReviewerChange(userId: string) {
  reviewerUserId.value = userId
  const m = members.value.find((m: any) => (m.user?.userId || m.userId) === userId)
  form.value.reviewerName = m ? (m.user?.userName || m.userName || userId) : userId
  dirty.value = true
}

const form = ref<Record<string, any>>({
  reqCode: '', reqName: '', reqDetail: '',
  sourceType: '', derivationPhase: '', reqType: '', progressStatus: '미분류',
  statusChangeReason: '',
  importance: '', difficulty: '',
  reviewOpinion: '',
  business: '', funcName: '', subFuncName: '',
  sourceCategory: '', sourceDesc: '',
  requesterName: '', requesterDept: '', assigneeName: '', reviewerName: '',
})

// 옵션
const sourceTypeOptions = ['신규', '개선', '현행', '기타']
const derivationPhaseOptions = ['분석', '설계', '구현']
const reqTypeOptions = ['기능', '비기능']
const statusOptions = ['미분류', '수용', '대체', '제외', '통합']
const sourceCategoryOptions = ['', '제안요청', '기술협상', '회의', '기타']
const levelOptions = ['상', '중', '하']
const reasonRequiredStatuses = ['대체', '통합', '제외']

const statusColors: Record<string, string> = { '미분류': 'grey', '수용': 'green', '확정': 'indigo', '대체': 'orange', '통합': 'purple', '제외': 'red' }
const needsReason = computed(() => reasonRequiredStatuses.includes(form.value.progressStatus))

async function fetchDetail() {
  if (isNew) return
  loading.value = true
  try {
    const res = await requirementService.getDetail(projectId, Number(requirementId))
    if (res.success) { item.value = res.data; loadForm() }
  } catch (err) { console.error(err) }
  finally { loading.value = false }
}
function loadForm() {
  if (!item.value) return
  const i = item.value
  form.value = {
    reqCode: i.reqCode || '', reqName: i.reqName || '', reqDetail: i.reqDetail || '',
    sourceType: i.sourceType || '', derivationPhase: i.derivationPhase || '',
    reqType: i.reqType || '', progressStatus: i.progressStatus || '미분류',
    statusChangeReason: i.statusChangeReason || '',
    importance: i.importance || '', difficulty: i.difficulty || '',
    reviewOpinion: i.reviewOpinion || '',
    business: i.business || '', funcName: i.funcName || '',
    subFuncName: i.subFuncName || '',
    sourceCategory: i.sourceCategory || '', sourceDesc: i.sourceDesc || '',
    requesterName: i.requesterName || '', requesterDept: i.requesterDept || '',
    assigneeName: i.assigneeName || '', reviewerName: i.reviewerName || '',
  }
  // 이름으로 userId 역매핑
  if (members.value.length) {
    const findByName = (name: string) => members.value.find((m: any) => (m.user?.userName || m.userName) === name)
    const a = findByName(i.assigneeName)
    if (a) assigneeUserId.value = a.user?.userId || a.userId || ''
    const r = findByName(i.reviewerName)
    if (r) reviewerUserId.value = r.user?.userId || r.userId || ''
  }
}
async function fetchInit() {
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
      // members 로드 후 userId 역매핑
      syncUserIds()
    }
  } catch {}
}

function syncUserIds() {
  if (!item.value || !members.value.length) return
  const findByName = (name: string) => members.value.find((m: any) => (m.user?.userName || m.userName) === name)
  const a = findByName(item.value.assigneeName)
  if (a) assigneeUserId.value = a.user?.userId || a.userId || ''
  const r = findByName(item.value.reviewerName)
  if (r) reviewerUserId.value = r.user?.userId || r.userId || ''
}
function startEdit() {
  if (item.value?.isBaselined) { changeMode.value = true; changeReason.value = '' }
  editMode.value = true; dirty.value = false
}
function cancelEdit() {
  if (isNew) { router.push(`/projects/${projectId}/requirements`); return }
  editMode.value = false; changeMode.value = false; loadForm(); dirty.value = false
}
async function save() {
  if (!form.value.reqCode) { await showAlert('요구사항ID는 필수입니다.', { color: 'error' }); return }
  if (!form.value.reqName) { await showAlert('요구사항명은 필수입니다.', { color: 'error' }); return }
  if (!form.value.reqDetail) { await showAlert('요구사항 내용은 필수입니다.', { color: 'error' }); return }
  if (!form.value.sourceType) { await showAlert('도출유형은 필수입니다.', { color: 'error' }); return }
  if (!form.value.derivationPhase) { await showAlert('도출단계는 필수입니다.', { color: 'error' }); return }
  if (!form.value.reqType) { await showAlert('요구사항유형은 필수입니다.', { color: 'error' }); return }
  if (!form.value.importance) { await showAlert('중요도는 필수입니다.', { color: 'error' }); return }
  if (!form.value.difficulty) { await showAlert('난이도는 필수입니다.', { color: 'error' }); return }
  if (needsReason.value && !form.value.statusChangeReason) { await showAlert(`진행상태 '${form.value.progressStatus}'인 경우 변경사유를 입력해야 합니다.`, { color: 'error' }); return }
  try {
    if (isNew) {
      const res = await requirementService.create(projectId, form.value)
      if (res.success) { await showAlert('저장이 완료되었습니다.'); router.replace(`/projects/${projectId}/requirements/${res.data.requirementId}`) }
    } else if (changeMode.value) {
      if (!changeReason.value) { await showAlert('변경 사유를 입력해주세요.', { color: 'error' }); return }
      if (!(await showConfirm('변경관리 내용을 저장하시겠습니까?\n변경 이력이 기록됩니다.'))) return
      const res = await requirementService.change(projectId, Number(requirementId), { ...form.value, changeReason: changeReason.value })
      if (res.success) { item.value = res.data; loadForm(); editMode.value = false; changeMode.value = false; dirty.value = false; await showAlert('저장이 완료되었습니다.') }
    } else {
      const res = await requirementService.update(projectId, Number(requirementId), form.value)
      if (res.success) { item.value = res.data; loadForm(); editMode.value = false; dirty.value = false; await showAlert('저장이 완료되었습니다.') }
    }
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
}
async function deleteReq() {
  if (!(await showConfirm('이 요구사항을 삭제하시겠습니까?'))) return
  try { const res = await requirementService.remove(projectId, Number(requirementId)); if (res.success) { await showAlert('삭제되었습니다.'); router.push(`/projects/${projectId}/requirements`) } }
  catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}
async function baselineReq() {
  if (!item.value) return
  // 확정 필수값 검증 (변경불가 항목 + 주요 항목)
  const missing: string[] = []
  if (!form.value.reqCode) missing.push('요구사항ID')
  if (!form.value.reqName) missing.push('요구사항명')
  if (!form.value.reqDetail) missing.push('요구사항 내용')
  if (!form.value.sourceType) missing.push('도출유형')
  if (!form.value.derivationPhase) missing.push('도출단계')
  if (!form.value.sourceCategory) missing.push('요구사항 출처구분')
  if (!form.value.sourceDesc) missing.push('요구사항 출처상세')
  if (!form.value.reqType) missing.push('요구사항유형')
  if (!form.value.importance) missing.push('중요도')
  if (!form.value.difficulty) missing.push('난이도')
  if (missing.length) {
    await showAlert(`필수항목이 누락되어 확정할 수 없습니다.\n\n${missing.join(', ')}`, { color: 'error' })
    return
  }
  const confirmed = await showConfirm(`현재 내용을 저장하고 요구사항을 확정합니다.\n\n확정 후에는 요구사항ID, 요구사항명, 요구사항 내용,\n도출유형, 도출단계, 출처구분, 출처상세를 수정할 수 없으며,\n변경 시 변경관리를 통해서만 가능합니다.\n\n계속하시겠습니까?`, { title: '요구사항 확정', color: 'warning' })
  if (!confirmed) return
  try {
    const saveRes = await requirementService.update(projectId, Number(requirementId), form.value)
    if (!saveRes.success) { await showAlert(saveRes.message || '저장 실패', { color: 'error' }); return }
    const res = await requirementService.baseline(projectId, Number(requirementId))
    if (res.success) { item.value = res.data; loadForm(); editMode.value = false; await showAlert(res.message) }
  } catch (err: any) { showAlert(err.response?.data?.message || '확정 실패', { color: 'error' }) }
}
function fmtDate(d: string | null) { return d ? d.substring(0, 10) : '-' }
function fmtDT(d: string | null) { return d ? new Date(d).toLocaleString('ko-KR') : '-' }

const fieldLabels: Record<string, string> = {
  sourceType: '도출유형', reqType: '요구사항유형', progressStatus: '진행상태',
  statusChangeReason: '변경사유', derivationPhase: '도출단계',
  sourceCategory: '출처구분', sourceDesc: '출처상세',
  business: '업무명', funcName: '기능명', subFuncName: '세부기능명',
  reviewOpinion: '적용방안(검토의견)', requesterName: '요청자', requesterDept: '요청부서',
  assigneeName: '담당자', reviewerName: '검토자', importance: '중요도', difficulty: '난이도',
}

onMounted(async () => { await Promise.all([fetchDetail(), fetchInit()]) })
</script>

<template>
  <MainLayout>
    <!-- 헤더 -->
    <v-row class="mb-1" align="center" dense>
      <v-col cols="auto">
        <v-btn icon size="small" variant="text" @click="router.push(`/projects/${projectId}/requirements`)"><v-icon>mdi-arrow-left</v-icon></v-btn>
      </v-col>
      <v-col>
        <span class="pms-page-title">
          <template v-if="isNew">요구사항 등록</template>
          <template v-else-if="item"><span class="pms-code">{{ item.reqCode }}</span><span class="ml-2">{{ item.reqName }}</span></template>
          <template v-else>로딩 중...</template>
        </span>
        <span class="pms-page-subtitle">{{ project?.projectName }}</span>
      </v-col>
      <v-col cols="auto" class="d-flex align-center ga-1" v-if="!isNew && item && !editMode">
        <v-chip v-if="item.isBaselined" color="indigo" variant="tonal" size="small"><v-icon size="12" start>mdi-lock</v-icon>확정</v-chip>
        <v-chip v-else :color="statusColors[item.progressStatus] || 'grey'" variant="tonal" size="small">{{ item.progressStatus }}</v-chip>
        <template v-if="canEdit">
          <v-divider vertical class="mx-1" />
          <v-btn color="primary" variant="outlined" size="x-small" prepend-icon="mdi-pencil" @click="startEdit">{{ item.isBaselined ? '변경관리' : '수정' }}</v-btn>
          <v-btn v-if="!item.isBaselined && isPmsAdmin" color="error" variant="outlined" size="x-small" prepend-icon="mdi-delete" @click="deleteReq">삭제</v-btn>
        </template>
      </v-col>
    </v-row>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

    <!-- ===== 보기 모드 ===== -->
    <template v-if="!editMode && item">
      <div class="pms-card mb-3">
        <table class="pms-detail-table">
          <tbody>
            <!-- 상단: 확정 시 변경불가 항목 -->
            <tr><td class="pms-detail-label">요구사항ID</td><td class="pms-detail-value"><span class="pms-code">{{ item.reqCode }}</span></td><td class="pms-detail-label">요구사항명</td><td class="pms-detail-value" colspan="3">{{ item.reqName }}</td></tr>
            <tr><td class="pms-detail-label">요구사항 내용</td><td class="pms-detail-value dt-pre" colspan="5">{{ item.reqDetail || '-' }}</td></tr>
            <tr>
              <td class="pms-detail-label">도출유형</td><td class="pms-detail-value">{{ item.sourceType || '-' }}</td>
              <td class="pms-detail-label">도출단계</td><td class="pms-detail-value">{{ item.derivationPhase || '-' }}</td>
              <td class="pms-detail-label">요구사항유형</td>
              <td class="pms-detail-value"><v-chip v-if="item.reqType" :color="item.reqType === '기능' ? 'teal' : 'orange'" size="x-small" variant="tonal" style="font-size:9px">{{ item.reqType }}</v-chip><span v-else>-</span></td>
            </tr>
            <tr>
              <td class="pms-detail-label">진행상태</td>
              <td class="pms-detail-value"><v-chip :color="statusColors[item.progressStatus] || 'grey'" size="x-small" variant="tonal" style="font-size:9px">{{ item.progressStatus }}</v-chip></td>
              <td class="pms-detail-label">진행상태 변경사유</td><td class="pms-detail-value" colspan="3">{{ item.statusChangeReason || '-' }}</td>
            </tr>
            <tr>
              <td class="pms-detail-label">요구사항 출처구분</td><td class="pms-detail-value">{{ item.sourceCategory || '-' }}</td>
              <td class="pms-detail-label">요구사항 출처상세</td><td class="pms-detail-value" colspan="3">{{ item.sourceDesc || '-' }}</td>
            </tr>
            <tr>
              <td class="pms-detail-label">중요도</td><td class="pms-detail-value">{{ item.importance || '-' }}</td>
              <td class="pms-detail-label">난이도</td><td class="pms-detail-value">{{ item.difficulty || '-' }}</td>
              <td class="pms-detail-label">확정일</td><td class="pms-detail-value">{{ item.isBaselined ? fmtDate(item.completedAt) : '-' }}</td>
            </tr>
            <tr><td class="pms-detail-label">적용방안(검토의견)</td><td class="pms-detail-value dt-pre" colspan="5">{{ item.reviewOpinion || '-' }}</td></tr>
          </tbody>
        </table>
        <v-divider />
        <table class="pms-detail-table">
          <tbody>
            <!-- 하단: 변경관리 가능 항목 -->
            <tr>
              <td class="pms-detail-label">업무명</td><td class="pms-detail-value">{{ item.business || '-' }}</td>
              <td class="pms-detail-label">기능명</td><td class="pms-detail-value">{{ item.funcName || '-' }}</td>
              <td class="pms-detail-label">세부기능명</td><td class="pms-detail-value">{{ item.subFuncName || '-' }}</td>
            </tr>
            <tr>
              <td class="pms-detail-label">요청자 <span class="dt-hint">발주기관</span></td><td class="pms-detail-value">{{ item.requesterName || '-' }}</td>
              <td class="pms-detail-label">요청부서 <span class="dt-hint">발주기관</span></td><td class="pms-detail-value">{{ item.requesterDept || '-' }}</td>
              <td class="pms-detail-label">담당자 <span class="dt-hint">사업자</span></td><td class="pms-detail-value">{{ item.assigneeName || '-' }}</td>
            </tr>
            <tr>
              <td class="pms-detail-label">검토자 <span class="dt-hint">사업자</span></td><td class="pms-detail-value">{{ item.reviewerName || '-' }}</td>
              <td class="pms-detail-label">등록일</td><td class="pms-detail-value">{{ fmtDT(item.createdAt) }}</td>
              <td></td><td></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 변경 이력 -->
      <div v-if="item.isBaselined && item.histories?.length" class="pms-card mb-3">
        <div class="pms-section-header">변경 이력 ({{ item.histories.length }}건)</div>
        <table class="pms-detail-table">
          <thead><tr>
            <th class="dt-th" width="40">#</th><th class="dt-th" width="60">유형</th>
            <th class="dt-th">변경 항목</th><th class="dt-th" width="180">변경 사유</th>
            <th class="dt-th" width="70">변경자</th><th class="dt-th" width="130">변경일시</th>
          </tr></thead>
          <tbody>
            <tr v-for="(h, idx) in item.histories" :key="h.historyId">
              <td class="text-center">{{ item.histories.length - idx }}</td>
              <td class="text-center"><v-chip :color="statusColors[h.changeType] || 'grey'" size="x-small" variant="tonal" style="font-size:9px">{{ h.changeType }}</v-chip></td>
              <td><div v-for="(val, fld) in (h.changedFields || {})" :key="fld" style="font-size:10px; line-height:1.6"><span class="font-weight-bold">{{ fieldLabels[fld as string] || fld }}:</span> <span class="text-red">{{ (val as any).before || '(없음)' }}</span> → <span class="text-green">{{ (val as any).after || '(없음)' }}</span></div></td>
              <td>{{ h.changeReason || '-' }}</td>
              <td class="text-center">{{ h.changedByName || h.changedBy }}</td>
              <td class="text-center" style="font-size:10px">{{ fmtDT(h.changedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ===== 편집 모드 ===== -->
    <template v-if="editMode">
      <div v-if="changeMode" class="pms-alert-info mb-3">
        <div class="mb-2"><v-icon size="14" class="mr-1">mdi-lock</v-icon>확정된 요구사항입니다. 요구사항ID, 요구사항명, 요구사항 내용, 도출유형, 도출단계, 출처구분, 출처상세는 변경할 수 없습니다.</div>
        <v-textarea v-model="changeReason" label="변경 사유 *" variant="outlined" density="compact" rows="2" hide-details style="font-size:var(--pms-font-body)" @update:model-value="dirty = true" />
      </div>

      <div class="pms-card mb-3">
        <div class="pms-card-body pms-form">

          <!-- 요구사항 정의 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title">
              <v-icon size="16">mdi-file-document-edit</v-icon>요구사항 정의
              <v-chip v-if="changeMode" size="x-small" color="warning" variant="tonal" class="ml-auto">확정 후 변경불가</v-chip>
            </div>
            <v-row dense class="mb-1">
              <v-col cols="12" md="3">
                <v-text-field v-model="form.reqCode" label="요구사항ID" :disabled="!isNew || changeMode" @update:model-value="dirty = true">
                  <template #label>요구사항ID<span class="pms-required">*</span></template>
                </v-text-field>
              </v-col>
              <v-col cols="12" md="9">
                <v-text-field v-model="form.reqName" :disabled="changeMode" @update:model-value="dirty = true">
                  <template #label>요구사항명<span class="pms-required">*</span></template>
                </v-text-field>
              </v-col>
            </v-row>
            <v-textarea v-model="form.reqDetail" rows="4" class="mb-1" :disabled="changeMode" @update:model-value="dirty = true">
              <template #label>요구사항 내용 (상세)<span class="pms-required">*</span></template>
            </v-textarea>
          </div>

          <!-- 분류/출처 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title green">
              <v-icon size="16">mdi-tag-multiple</v-icon>분류 및 출처
              <v-chip v-if="changeMode" size="x-small" color="warning" variant="tonal" class="ml-auto">확정 후 변경불가</v-chip>
            </div>
            <v-row dense>
              <v-col cols="6" md="2">
                <v-select v-model="form.sourceType" :items="sourceTypeOptions" :disabled="changeMode" @update:model-value="dirty = true">
                  <template #label>도출유형<span class="pms-required">*</span></template>
                </v-select>
              </v-col>
              <v-col cols="6" md="2">
                <v-select v-model="form.derivationPhase" :items="derivationPhaseOptions" :disabled="changeMode" @update:model-value="dirty = true">
                  <template #label>도출단계<span class="pms-required">*</span></template>
                </v-select>
              </v-col>
              <v-col cols="6" md="3">
                <v-select v-model="form.sourceCategory" :items="sourceCategoryOptions" label="요구사항 출처구분" :disabled="changeMode" @update:model-value="dirty = true" />
              </v-col>
              <v-col cols="6" md="5">
                <v-text-field v-model="form.sourceDesc" label="요구사항 출처상세" :disabled="changeMode" @update:model-value="dirty = true" />
              </v-col>
            </v-row>
          </div>

          <!-- 요구사항 확정 -->
          <div v-if="!isNew && item && isPmsAdmin && !changeMode" class="d-flex align-center justify-end mb-3" style="gap:8px">
            <v-chip v-if="item.isBaselined" color="indigo" variant="tonal" size="small">
              <v-icon size="12" start>mdi-lock</v-icon>확정일 {{ fmtDate(item.completedAt) }}
            </v-chip>
            <v-btn v-if="!item.isBaselined" color="primary" variant="flat" size="small" prepend-icon="mdi-check-decagram" @click="baselineReq">요구사항확정</v-btn>
          </div>

          <!-- 평가/상태 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title orange">
              <v-icon size="16">mdi-clipboard-check</v-icon>평가 및 진행
            </div>
            <v-row dense class="mb-1">
              <v-col cols="6" md="2">
                <v-select v-model="form.importance" :items="levelOptions" @update:model-value="dirty = true">
                  <template #label>중요도<span class="pms-required">*</span></template>
                </v-select>
              </v-col>
              <v-col cols="6" md="2">
                <v-select v-model="form.difficulty" :items="levelOptions" @update:model-value="dirty = true">
                  <template #label>난이도<span class="pms-required">*</span></template>
                </v-select>
              </v-col>
              <v-col cols="6" md="3">
                <v-select v-model="form.reqType" :items="reqTypeOptions" @update:model-value="dirty = true">
                  <template #label>요구사항유형<span class="pms-required">*</span></template>
                </v-select>
              </v-col>
              <v-col cols="6" md="3">
                <v-select v-model="form.progressStatus" :items="statusOptions" label="진행상태" @update:model-value="dirty = true" />
              </v-col>
            </v-row>
            <v-text-field
              v-if="needsReason || form.statusChangeReason"
              v-model="form.statusChangeReason"
              :label="needsReason ? '진행상태 변경사유 *' : '진행상태 변경사유'"
              :placeholder="needsReason ? '대체, 제외, 통합 선택 시 사유 기재' : ''"
              class="mb-1" hide-details
              @update:model-value="dirty = true"
            />
          </div>

          <!-- 검토의견 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title grey">
              <v-icon size="16">mdi-message-text</v-icon>검토의견
            </div>
            <v-textarea v-model="form.reviewOpinion" label="적용방안 (검토의견)" rows="3" @update:model-value="dirty = true" />
          </div>

          <!-- 업무/기능 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title grey">
              <v-icon size="16">mdi-briefcase</v-icon>업무 및 기능
            </div>
            <v-row dense>
              <v-col cols="12" md="4">
                <v-text-field v-model="form.business" label="업무명" @update:model-value="dirty = true" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model="form.funcName" label="기능명" @update:model-value="dirty = true" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model="form.subFuncName" label="세부기능명" @update:model-value="dirty = true" />
              </v-col>
            </v-row>
          </div>

          <!-- 담당자 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title grey">
              <v-icon size="16">mdi-account-group</v-icon>담당자 정보
            </div>
            <v-row dense>
              <v-col cols="6" md="3">
                <v-text-field v-model="form.requesterName" label="요청자 (발주기관)" @update:model-value="dirty = true" />
              </v-col>
              <v-col cols="6" md="3">
                <v-text-field v-model="form.requesterDept" label="요청부서 (발주기관)" @update:model-value="dirty = true" />
              </v-col>
              <v-col cols="6" md="3">
                <UserTreePicker v-model="assigneeUserId" :members="members" label="담당자 (사업자)" @update:model-value="onAssigneeChange" />
              </v-col>
              <v-col cols="6" md="3">
                <UserTreePicker v-model="reviewerUserId" :members="members" label="검토자 (사업자)" @update:model-value="onReviewerChange" />
              </v-col>
            </v-row>
          </div>

        </div>
      </div>

      <!-- 저장/취소 -->
      <div class="d-flex justify-end ga-2 mb-4">
        <v-btn variant="outlined" size="small" @click="cancelEdit">취소</v-btn>
        <v-btn color="primary" size="small" @click="save">저장</v-btn>
      </div>
    </template>
  </MainLayout>
</template>

<style scoped>
/* 뷰 전용 스타일 — 글로벌 pms-* 클래스는 design-system.css에서 제공 */
.dt-pre { white-space: pre-wrap; word-break: break-word; }
.dt-hint { font-weight: 400; font-size: var(--pms-font-mini); color: var(--pms-text-hint); }
.dt-th {
  background: var(--pms-surface-variant);
  font-size: var(--pms-font-caption) !important;
  font-weight: 600;
  text-align: center;
  padding: 4px 6px !important;
  border-bottom: 2px solid var(--pms-border-dark) !important;
}
</style>
