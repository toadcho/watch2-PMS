<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import UserTreePicker from '@/components/common/UserTreePicker.vue'
import PmsDatePicker from '@/components/common/PmsDatePicker.vue'
import { useDialog } from '@/composables/useDialog'
const { showAlert, showConfirm, showPrompt } = useDialog()
import { wbsService } from '@/services/wbs'
import { userService } from '@/services/users'
import { projectService } from '@/services/projects'
import { deliverableService } from '@/services/deliverables'
import api from '@/services/api'
import type { WbsTask, User, Project } from '@/types'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)

const project = ref<Project | null>(null)
const tree = ref<WbsTask[]>([])
const flatTasks = ref<WbsTask[]>([])
const users = ref<User[]>([])
const loading = ref(false)
const viewMode = ref<'tree' | 'gantt'>('tree')

// 프로젝트 역할 기반 권한
const myRole = ref<any>(null)
const isPmsAdmin = computed(() => myRole.value?.isPmsAdmin || false)
const isLeader = computed(() => myRole.value?.isLeader || false)
const isMember = computed(() => myRole.value?.isMember || false)
const canEdit = computed(() => isPmsAdmin.value || isLeader.value || isMember.value)
const isReadOnly = computed(() => !canEdit.value)

// WBS 구조 잠금 (실적 등록 시)
const wbsLocked = ref(false)
const wbsForceUnlock = ref(false)
const canModifyStructure = computed(() => isPmsAdmin.value && (!wbsLocked.value || wbsForceUnlock.value))

// 태스크 다이얼로그
const dialog = ref(false)
const editMode = ref(false)
const editId = ref<number | null>(null)
const form = ref({
  wbsCode: '', taskName: '', parentTaskId: null as number | null,
  phase: '', planStart: '', planEnd: '',
  baselineStart: '', baselineEnd: '',
  actualStart: '', actualEnd: '',
  duration: null as number | null, actualMd: null as number | null,
  progressRate: 0, actualRate: 0, weight: 1,
  taskRole: '', assigneeId: '',
})

// 실적 등록 다이얼로그 (팀장/팀원용)
const actualDialog = ref(false)
const actualTaskId = ref<number | null>(null)
const actualTaskName = ref('')
const actualPlanStart = ref('')
const actualPlanEnd = ref('')
const actualPlanProgress = ref(0)
const actualMaxRate = ref(100)
const actualForm = ref({ actualStart: '', actualEnd: '', actualRate: 0 })
const actualSaving = ref(false)
const actualReadOnly = ref(false) // 승인 역할자: 실적 읽기 전용, 산출물 승인만 가능
const actualCompleted = ref(false)  // 실적 100% + 종료일 등록 → 수정 불가
const actualWaitingApproval = ref(false) // 승인 대기 중 → 수정 불가
const actualDeliverables = ref<any[]>([])  // 태스크의 산출물 + 승인 현황

// DEPTH_LABELS는 프로젝트의 approvalLine 기반으로 동적 생성
const DEPTH_LABELS = computed<Record<number, string>>(() => {
  const line = ((project.value as any)?.approvalLine || []) as any[]
  if (Array.isArray(line) && line.length > 0) {
    const map: Record<number, string> = {}
    for (const s of line) if (s.depth > 0) map[s.depth] = s.role
    return map
  }
  return { 1: 'PL', 2: 'QA', 3: 'PMO', 4: 'Customer' }
})

const ROLE_DEPTH_MAP = computed<Record<string, number>>(() => {
  const line = ((project.value as any)?.approvalLine || []) as any[]
  if (Array.isArray(line) && line.length > 0) {
    const map: Record<string, number> = {}
    for (const s of line) if (s.depth > 0 && s.role) map[s.role] = s.depth
    return map
  }
  return { 'PL': 1, 'QA': 2, 'PMO': 3, 'Customer': 4 }
})

const DEPTH_MAX = computed<number>(() => {
  const line = ((project.value as any)?.approvalLine || []) as any[]
  if (Array.isArray(line) && line.length > 0) {
    return Math.max(...line.filter((s: any) => s.depth > 0).map((s: any) => s.depth))
  }
  return 4
})

async function openActualDialog(task: any) {
  actualTaskId.value = task.taskId
  actualTaskName.value = task.taskName
  actualPlanStart.value = task.planStart ? String(task.planStart).substring(0, 10) : '-'
  actualPlanEnd.value = task.planEnd ? String(task.planEnd).substring(0, 10) : '-'
  actualPlanProgress.value = task.progressRate || 0
  actualMaxRate.value = 100
  actualRateGuide.value = ''
  actualCompleted.value = false
  actualWaitingApproval.value = false
  actualDeliverables.value = []
  // 실적 진행률 조정/저장은 담당자(또는 PMSAdmin)만 가능
  // 그 외(PL/QA/PMO/Customer 등)는 산출물 승인/반려만 가능 (실적 읽기 전용)
  const isAssignee = task.assigneeId === authStore.user?.userId
  actualReadOnly.value = !isAssignee && !isPmsAdmin.value
  actualForm.value = {
    actualStart: task.actualStart ? String(task.actualStart).substring(0, 10) : '',
    actualEnd: task.actualEnd ? String(task.actualEnd).substring(0, 10) : '',
    actualRate: task.actualRate || 0,
  }
  // 승인 프로세스 상한 + 산출물 목록 조회 (승인 프로세스 활성 시만)
  if (approvalEnabled.value) {
    try {
      const { approvalService } = await import('@/services/approval')
      const [rateRes] = await Promise.all([
        approvalService.getMaxRate(projectId, task.taskId),
      ])
      if (rateRes.success) actualMaxRate.value = rateRes.data.maxRate
      // 태스크 산출물 승인 현황 조회
      const docs = taskDeliverables.value.get(task.taskId) || []
      const detailPromises = docs.map((d: any) => approvalService.getDeliverableStatus(projectId, d.docId).catch(() => null))
      const details = await Promise.all(detailPromises)
      actualDeliverables.value = details.filter(Boolean).map((r: any) => r.data)
    } catch {}
  }

  // 이미 완료된 태스크 (100% + 종료일)
  if (actualForm.value.actualRate >= 100 && actualForm.value.actualEnd) {
    actualCompleted.value = true
  } else {
    // 승인 대기 중 판별: 실적이 상한과 같고, 산출물 중 승인요청 상태가 있으면
    const hasApprovalPending = actualDeliverables.value.some((d: any) =>
      d.approvals?.some((a: any) => a.status === '승인요청')
    )
    if (hasApprovalPending && actualForm.value.actualRate >= actualMaxRate.value) {
      actualWaitingApproval.value = true
    }
    // 담당자 + 승인 프로세스 ON: 상한 상향 감지 시 슬라이더를 상한까지 자동 이동
    const taskAssignee = flatTasks.value.find(t => t.taskId === actualTaskId.value)?.assigneeId === authStore.user?.userId
    if (approvalEnabled.value && taskAssignee && actualMaxRate.value > actualForm.value.actualRate && actualForm.value.actualRate > 0) {
      actualForm.value.actualRate = actualMaxRate.value
      actualRateGuide.value = actualMaxRate.value >= 100
        ? `승인 완료로 실적 진행률이 100%로 상향되었습니다. 실제 종료일을 등록하고 저장해주세요.`
        : `승인 완료로 실적 진행률이 ${actualMaxRate.value}%로 상향되었습니다. 저장 버튼을 눌러 다음 단계 승인요청을 진행하세요.`
    }
  }

  actualDialog.value = true
}

async function markComplete(doc: any) {
  try {
    const { approvalService } = await import('@/services/approval')
    const res = await approvalService.completeDeliverable(projectId, doc.docId)
    await showAlert(res.message)
    // 다이얼로그 새로고침
    if (actualTaskId.value) {
      const task = flatTasks.value.find(t => t.taskId === actualTaskId.value)
      if (task) await openActualDialog(task)
      // 모든 산출물이 작성완료 이상이면 실적 80% 디폴트 설정
      const allCompleted = actualDeliverables.value.every((d: any) => d.status === '작성완료' || d.approvalDepth > 0)
      if (allCompleted && actualForm.value.actualRate < actualMaxRate.value) {
        actualForm.value.actualRate = actualMaxRate.value
        actualRateGuide.value = `실적 진행률이 ${actualMaxRate.value}%로 설정되었습니다. 실제 시작일을 등록하고 저장 버튼을 눌러주세요.`
      }
    }
  } catch (err: any) { showAlert(err.response?.data?.message || '처리 실패', { color: 'error' }) }
}

async function requestApproval(doc: any) {
  try {
    const { approvalService } = await import('@/services/approval')
    const res = await approvalService.requestApproval(projectId, doc.docId)
    await showAlert(res.message)
    if (actualTaskId.value) {
      const task = flatTasks.value.find(t => t.taskId === actualTaskId.value)
      if (task) await openActualDialog(task)
    }
  } catch (err: any) { showAlert(err.response?.data?.message || '요청 실패', { color: 'error' }) }
}

// 프로젝트 승인 프로세스 활성 여부
const approvalEnabled = computed(() => (project.value as any)?.approvalEnabled || false)

// 나에게 승인요청이 온 태스크 ID 집합
const pendingApprovalTaskIds = ref<Set<number>>(new Set())

// 현재 사용자가 태스크 담당자인지
const isTaskAssignee = computed(() => {
  if (!actualTaskId.value) return false
  const task = flatTasks.value.find(t => t.taskId === actualTaskId.value)
  return task?.assigneeId === authStore.user?.userId
})

// 승인 타임라인 칩 색상 결정
// - 현재 depth까지 완료: success(초록)
// - 현재 depth 승인요청 중: orange
// - 반려 이력 있고 아직 그 depth가 최신 상태: error(빨강)
// - 그 외(대기/초기화): grey
function depthChipColor(doc: any, depth: number): string {
  if (doc.approvalDepth >= depth) return 'success'
  const approval = doc.approvals?.find((a: any) => a.depth === depth)
  if (!approval) return 'grey'
  // 승인요청 중: orange
  if (approval.status === '승인요청') return 'orange'
  // 반려: 현재 반려 상태가 유효한 경우만 (재요청 시작되면 대기)
  if (approval.status === '반려' && doc.status === '반려' && depth === doc.approvalDepth + 1) return 'error'
  return 'grey'
}

// 현재 사용자가 승인라인에 있는 역할인지 (프로젝트 결재라인 기반)
function isApprovalRole(): boolean {
  const myMemberRole = myRole.value?.role || ''
  return !!ROLE_DEPTH_MAP.value[myMemberRole]
}

// 현재 사용자가 해당 산출물의 승인권자인지 판별
function isApproverForDoc(doc: any): boolean {
  const myMemberRole = myRole.value?.role || ''
  const myDepth = ROLE_DEPTH_MAP.value[myMemberRole]
  if (!myDepth) return false
  return myDepth === doc.approvalDepth + 1
}

// 현재 사용자가 요청자(태스크 담당자)인지 판별
function isRequesterForDoc(doc: any): boolean {
  return doc.task?.assigneeId === authStore.user?.userId ||
    flatTasks.value.find(t => t.taskId === actualTaskId.value)?.assigneeId === authStore.user?.userId
}

// 모든 산출물이 같은 depth까지 승인 완료되었는지
const allDocsAtSameDepth = computed(() => {
  if (!actualDeliverables.value.length) return false
  const depths = actualDeliverables.value.map((d: any) => d.approvalDepth)
  const minDepth = Math.min(...depths)
  return depths.every(d => d === minDepth) && minDepth < DEPTH_MAX.value &&
    !actualDeliverables.value.some((d: any) => d.approvals?.find((a: any) => a.depth === minDepth + 1 && a.status === '승인요청'))
})

const nextApprovalDepth = computed(() => {
  if (!actualDeliverables.value.length) return DEPTH_MAX.value + 1
  const minDepth = Math.min(...actualDeliverables.value.map((d: any) => d.approvalDepth))
  return minDepth + 1
})

// 승인 대상자 선택 다이얼로그
const approverDialog = ref(false)
const approverList = ref<any[]>([])
const selectedApprover = ref<string>('')
const approverNextRole = ref('')

async function requestNextApproval() {
  if (!actualTaskId.value) return
  const depth = nextApprovalDepth.value

  // depth 1 (팀장): 자동 지정
  if (depth === 1) {
    await doRequestNext(undefined)
    return
  }

  // depth >= 2: 대상자 선택 (프로젝트 결재라인 기반)
  const role = DEPTH_LABELS.value[depth]
  if (!role) return

  try {
    const { approvalService } = await import('@/services/approval')
    const res = await approvalService.getApprovers(projectId, role)
    if (res.success) {
      approverList.value = res.data
      approverNextRole.value = role
      selectedApprover.value = res.data.length === 1 ? res.data[0].userId : ''
      approverDialog.value = true
    }
  } catch (err: any) { showAlert(err.response?.data?.message || '조회 실패', { color: 'error' }) }
}

async function doRequestNext(approverId?: string) {
  if (!actualTaskId.value) return
  try {
    const { approvalService } = await import('@/services/approval')
    const res = await approvalService.requestNextForTask(projectId, actualTaskId.value, approverId)
    await showAlert(res.message)
    approverDialog.value = false
    actualDialog.value = false
    await fetchAll()
  } catch (err: any) { showAlert(err.response?.data?.message || '요청 실패', { color: 'error' }) }
}

const actualRateGuide = ref('')

async function approveDoc(doc: any) {
  if (!(await showConfirm(`"${doc.docName}" 산출물을 승인하시겠습니까?`))) return
  try {
    const { approvalService } = await import('@/services/approval')
    const res = await approvalService.approve(projectId, doc.docId)
    const suggested = res.suggestedRate
    await showAlert(res.message)
    // 다이얼로그 새로고침
    if (actualTaskId.value) {
      const task = flatTasks.value.find(t => t.taskId === actualTaskId.value)
      if (task) await openActualDialog(task)
    }
    // 담당자에게 상한 상향 안내 (값은 자동 변경하지 않음)
    if (suggested && isTaskAssignee.value && actualForm.value.actualRate < suggested) {
      actualRateGuide.value = suggested >= 100
        ? `승인 완료로 실적 진행률 상한이 100%로 상향되었습니다. 실적 조정 후 저장해주세요.`
        : `실적 진행률 상한이 ${suggested}%로 상향되었습니다. 실적 조정 후 저장해주세요.`
    }
  } catch (err: any) { showAlert(err.response?.data?.message || '승인 실패', { color: 'error' }) }
}

async function rejectDoc(doc: any) {
  const comment = await showPrompt(`"${doc.docName}" 반려 사유를 입력하세요:`, { title: '반려', label: '반려 사유' })
  if (comment === null) return
  try {
    const { approvalService } = await import('@/services/approval')
    const res = await approvalService.reject(projectId, doc.docId, comment)
    await showAlert(res.message)
    if (actualTaskId.value) {
      const task = flatTasks.value.find(t => t.taskId === actualTaskId.value)
      if (task) await openActualDialog(task)
    }
  } catch (err: any) { showAlert(err.response?.data?.message || '반려 실패', { color: 'error' }) }
}

async function withdrawAllApprovals() {
  if (!actualTaskId.value) return
  const multi = actualDeliverables.value.length > 1
  const msg = multi ? '모든 산출물의 승인요청을 회수하시겠습니까?' : '승인요청을 회수하시겠습니까?'
  if (!(await showConfirm(msg))) return
  try {
    const { approvalService } = await import('@/services/approval')
    const res = await approvalService.withdrawTask(projectId, actualTaskId.value)
    await showAlert(res.message)
    const task = flatTasks.value.find(t => t.taskId === actualTaskId.value)
    if (task) await openActualDialog(task)
  } catch (err: any) { showAlert(err.response?.data?.message || '회수 실패', { color: 'error' }) }
}

async function withdrawApproval(doc: any) {
  if (!(await showConfirm(`"${doc.docName}" 승인요청을 회수하시겠습니까?`))) return
  try {
    const { approvalService } = await import('@/services/approval')
    const res = await approvalService.withdraw(projectId, doc.docId)
    await showAlert(res.message)
    if (actualTaskId.value) {
      const task = flatTasks.value.find(t => t.taskId === actualTaskId.value)
      if (task) await openActualDialog(task)
    }
  } catch (err: any) { showAlert(err.response?.data?.message || '회수 실패', { color: 'error' }) }
}

// 작성완료 안 된 산출물이 있는지
const hasUncompletedDocs = computed(() => {
  return actualDeliverables.value.some((d: any) => d.status === '등록' || d.status === '작성중')
})

// 반려 건 존재 여부
const hasRejectedDocs = computed(() => {
  return actualDeliverables.value.some((d: any) => d.status === '반려')
})

// 저장 시 다음 단계 승인요청이 필요한지 판단 (담당자만 승인요청 가능)
const needsApprovalRequest = computed(() => {
  if (!isTaskAssignee.value && !isPmsAdmin.value) return false  // 담당자 또는 PMSAdmin만
  if (!actualDeliverables.value.length) return false
  if (actualForm.value.actualRate < actualMaxRate.value) return false
  if (hasRejectedDocs.value) return false // 반려 건은 별도 처리
  if (hasUncompletedDocs.value) return true
  return allDocsAtSameDepth.value && nextApprovalDepth.value >= 2 && nextApprovalDepth.value <= DEPTH_MAX.value
})

// 반려 건 재요청이 필요한지 (담당자만)
const needsReRequest = computed(() => {
  if (!isTaskAssignee.value && !isPmsAdmin.value) return false
  return hasRejectedDocs.value && actualForm.value.actualRate >= actualMaxRate.value
})

const saveButtonLabel = computed(() => {
  if (needsReRequest.value) return '수정완료 및 재승인요청'
  if (hasUncompletedDocs.value && actualForm.value.actualRate >= actualMaxRate.value) return '저장 및 PL 승인요청'
  if (needsApprovalRequest.value) return `저장 및 ${DEPTH_LABELS.value[nextApprovalDepth.value]} 승인요청`
  return '저장'
})

async function saveActual() {
  if (!actualTaskId.value) return
  if (!actualForm.value.actualStart) {
    await showAlert('실제 시작일을 입력해주세요.', { color: 'warning' })
    return
  }
  if (actualForm.value.actualEnd && actualForm.value.actualRate < 100) {
    await showAlert('실적 진행률이 100%가 아니면 실제 종료일을 등록할 수 없습니다.', { color: 'warning' })
    return
  }
  if (actualForm.value.actualRate >= 100 && !actualForm.value.actualEnd) {
    await showAlert('실적 진행률이 100%입니다. 실제 종료일을 입력해주세요.', { color: 'warning' })
    return
  }
  actualSaving.value = true
  try {
    // 1. 실적 저장
    await wbsService.update(projectId, actualTaskId.value, {
      actualStart: actualForm.value.actualStart || undefined,
      actualEnd: actualForm.value.actualEnd || undefined,
      actualRate: actualForm.value.actualRate,
    })

    // 1-0. 반려 건 재요청
    if (needsReRequest.value) {
      const { approvalService } = await import('@/services/approval')
      const res = await approvalService.reRequestForTask(projectId, actualTaskId.value)
      await showAlert(`실적이 저장되었습니다. ${res.message}`)
      actualDialog.value = false
      await fetchAll()
      return
    }

    // 1-1. 작성완료 안 된 산출물 일괄 작성완료 + PL 승인요청
    if (hasUncompletedDocs.value && actualForm.value.actualRate >= actualMaxRate.value) {
      const { approvalService } = await import('@/services/approval')
      // 각 산출물 작성완료
      for (const doc of actualDeliverables.value) {
        if (doc.status === '등록' || doc.status === '작성중') {
          await approvalService.completeDeliverable(projectId, doc.docId)
        }
      }
      // PL 일괄 승인요청 (depth 1은 approverId 불필요)
      await approvalService.requestNextForTask(projectId, actualTaskId.value)
      await showAlert('실적이 저장되었습니다. PL에게 승인 요청되었습니다.')
      actualDialog.value = false
      await fetchAll()
      return
    }

    // 2. 다음 단계 승인요청 (프로젝트 결재라인 기반)
    if (needsApprovalRequest.value) {
      const depth = nextApprovalDepth.value
      const role = DEPTH_LABELS.value[depth]

      const { approvalService } = await import('@/services/approval')
      const approversRes = await approvalService.getApprovers(projectId, role)

      if (approversRes.success && approversRes.data.length > 0) {
        if (approversRes.data.length === 1) {
          // 1명이면 바로 요청
          await approvalService.requestNextForTask(projectId, actualTaskId.value, approversRes.data[0].userId)
          await showAlert(`실적이 저장되었습니다. ${approversRes.data[0].userName}(${role})에게 승인 요청되었습니다.`)
        } else {
          // 여러명이면 선택 다이얼로그
          approverList.value = approversRes.data
          approverNextRole.value = role
          selectedApprover.value = ''
          actualDialog.value = false
          await fetchAll()
          approverDialog.value = true
          return
        }
      }
    } else {
      await showAlert('실적이 저장되었습니다.')
    }

    actualDialog.value = false
    await fetchAll()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '저장 실패', { color: 'error' })
  } finally {
    actualSaving.value = false
  }
}

// 부모 태스크의 자식 가중치 합계
function childWeightSum(taskId: number): string {
  const children = flatTasks.value.filter(t => t.parentTaskId === taskId)
  if (!children.length) return ''
  const sum = Math.round(children.reduce((s, c) => s + ((c as any).weight || 0), 0) * 100) / 100
  return sum + '%'
}

// 가중치 검증
const weightWarnings = ref<any[]>([])
const weightCheckDone = ref(false)

async function checkWeights() {
  try {
    const { data } = await api.get(`/projects/${projectId}/wbs/weight-check`)
    if (data.success) {
      weightWarnings.value = data.data.warnings
      weightCheckDone.value = true
    }
  } catch {}
}

// 베이스라인 설정
async function resetActuals() {
  if (!(await showConfirm('모든 태스크의 실적(실제시작/종료/진행률)과 산출물 승인 이력을 초기화합니다.\n\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?', { title: '실적 초기화', color: 'error' }))) return
  if (!(await showConfirm('정말 초기화하시겠습니까? 모든 실적 데이터가 삭제됩니다.', { title: '최종 확인', color: 'error' }))) return
  try {
    const { data } = await api.post(`/projects/${projectId}/wbs/reset-actuals`)
    if (data.success) {
      await showAlert(data.message)
      await fetchAll()
    }
  } catch (err: any) { showAlert(err.response?.data?.message || '초기화 실패', { color: 'error' }) }
}


// 가중치 자동산정 (MD 비율)
async function calcWeights() {
  if (!(await showConfirm('태스크 가중치를 계획MD 비율로 자동 산정합니다.\n기존 가중치가 덮어씌워집니다. 계속하시겠습니까?'))) return
  try {
    const { data } = await api.post(`/projects/${projectId}/wbs/calc-weights`)
    if (data.success) { showAlert(data.message); fetchAll() }
  } catch (err: any) { showAlert(err.response?.data?.message || '가중치 산정 실패', { color: 'error' }) }
}

// 스케줄 자동산정
const scheduleResult = ref<any>(null)
const scheduling = ref(false)

// 스케줄 검증/산정
const scheduleDialog = ref(false)
const scheduleMode = ref<'check' | 'apply'>('check')

function openScheduleDialog() {
  scheduleMode.value = 'check'
  scheduleDialog.value = true
}

async function runSchedule() {
  scheduling.value = true
  try {
    const mode = scheduleMode.value
    const { data } = await api.post(`/projects/${projectId}/wbs/schedule`, { mode })
    if (data.success) {
      scheduleResult.value = data.data
      scheduleDialog.value = false
      fetchAll()
    } else {
      showAlert(data.message || '실패', { color: 'error' })
    }
  } catch (err: any) {
    showAlert(err.response?.data?.message || '스케줄 산정 중 오류', { color: 'error' })
  } finally {
    scheduling.value = false
  }
}

// 선후행 관계
interface DepEntry { predecessorId: number | null; depType: string; lagDays: number }
const formDeps = ref<DepEntry[]>([])
const depTypes = [
  { title: 'FS (완료→시작)', value: 'FS' },
  { title: 'FF (완료→완료)', value: 'FF' },
  { title: 'SS (시작→시작)', value: 'SS' },
  { title: 'SF (시작→완료)', value: 'SF' },
]

function addDep() {
  formDeps.value.push({ predecessorId: null, depType: 'FS', lagDays: 0 })
}
function removeDep(idx: number) {
  formDeps.value.splice(idx, 1)
}

// 선행작업 후보 (자기 자신 제외)
const depPredecessorOptions = computed(() => {
  return flatTasks.value
    .filter(t => t.taskId !== editId.value)
    .map(t => ({
      title: `${'─'.repeat(Math.min(t.depth - 1, 3))} ${t.taskName}`,
      value: t.taskId,
    }))
})

// 산출물 (태스크와 함께 등록)
interface DeliverableEntry { docType: string; docName: string }
const formDeliverables = ref<DeliverableEntry[]>([])
const projectDocTypes = ref<{ title: string; value: string }[]>([])

async function fetchProjectDocTypes() {
  try {
    const { mgmtDeliverableService } = await import('@/services/mgmtDeliverables')
    const res = await mgmtDeliverableService.getAllDeliverables(projectId)
    if (res.success && res.data?.length) {
      projectDocTypes.value = res.data.map((d: any) => {
        const prefix = d.source === 'management' ? `[관리] ` : `[${d.phase || '방법론'}] `
        return { title: `${prefix}${d.docName}`, value: d.docName }
      })
    }
  } catch {}
}
// 태스크별 산출물 맵 (표시용)
const taskDeliverables = ref(new Map<number, any[]>())

function addDeliverable() {
  formDeliverables.value.push({ docType: '', docName: '' })
}
function removeDeliverable(idx: number) {
  formDeliverables.value.splice(idx, 1)
}
// docType 선택 시 docName 자동 채움
function onDocTypeChange(idx: number) {
  const entry = formDeliverables.value[idx]
  if (entry.docType) {
    entry.docName = entry.docType
  }
}

const phases = ['분석', '설계', '구현', '시험', '이행']

// 임포트
const importDialog = ref(false)
const importFile = ref<File | null>(null)
const importClear = ref(false)
const importResult = ref<any>(null)
const importing = ref(false)

function onImportFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  importFile.value = input.files?.[0] || null
}

async function doImport() {
  if (!importFile.value) return
  importing.value = true
  try {
    const fd = new FormData()
    fd.append('file', importFile.value)
    fd.append('clearExisting', String(importClear.value))
    const { data } = await api.post(`/projects/${projectId}/wbs/import`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    if (data.success) {
      importDialog.value = false
      importFile.value = null
      importResult.value = data.data
      fetchAll()
    } else {
      showAlert(data.message || '임포트 실패', { color: 'error' })
    }
  } catch (err: any) {
    showAlert(err.response?.data?.message || '임포트 중 오류가 발생했습니다.', { color: 'error' })
  } finally {
    importing.value = false
  }
}

function downloadTemplate() {
  const token = localStorage.getItem('token')
  window.open(`/api/v1/projects/${projectId}/wbs/import-template?token=${token}`, '_blank')
}

function doExport() {
  const token = localStorage.getItem('token')
  window.open(`/api/v1/projects/${projectId}/wbs/export?token=${token}`, '_blank')
}

async function fetchAll() {
  loading.value = true
  fetchProjectDocTypes()
  try {
    const [projRes, treeRes, flatRes, docRes] = await Promise.all([
      projectService.getDetail(projectId),
      wbsService.getTree(projectId),
      wbsService.getFlat(projectId),
      deliverableService.getList(projectId, { size: 1000 }),
    ])
    try {
      const roleRes = await projectService.getMyRole(projectId)
      if (roleRes.success) myRole.value = roleRes.data
    } catch { /* 역할 미조회 시 기본값 유지 */ }
    // 나에게 온 승인요청 태스크 목록 로드 (승인 프로세스 활성 시만)
    if (approvalEnabled.value) {
      try {
        const { approvalService } = await import('@/services/approval')
        const pendingRes = await approvalService.getPending(projectId)
        if (pendingRes.success) {
          const ids = new Set<number>()
          for (const a of pendingRes.data) {
            if (a.taskId) ids.add(Number(a.taskId))
          }
          pendingApprovalTaskIds.value = ids
        }
      } catch { pendingApprovalTaskIds.value = new Set() }
    } else {
      pendingApprovalTaskIds.value = new Set()
    }
    if (projRes.success) project.value = projRes.data
    if (treeRes.success) tree.value = treeRes.data
    // 산출물을 태스크별로 그룹핑
    if (docRes.success) {
      const map = new Map<number, any[]>()
      for (const d of docRes.data) {
        const tid = d.taskId
        if (!map.has(tid)) map.set(tid, [])
        map.get(tid)!.push(d)
      }
      taskDeliverables.value = map
    }
    if (flatRes.success) {
      flatTasks.value = flatRes.data
      // 재조회 시 펴기 상태 유지
      collapsed.value = new Set()
    }
  } catch (err) {
    console.error('Fetch WBS error:', err)
  } finally {
    loading.value = false
    checkWeights()
    await fetchUsers()
    // 잠금 상태 확인
    wbsLocked.value = flatTasks.value.some((t: any) => t.actualStart || t.actualEnd || (t.actualRate && t.actualRate > 0))
    // 비관리자: 본인 담당자 자동 필터 (첫 진입 시만)
    if (!isPmsAdmin.value && userFilter.value === 'all' && authStore.user?.userId) {
      userFilter.value = authStore.user.userId
    }
  }
}

// 프로젝트 투입인력에서 담당자 후보 로드
const members = ref<any[]>([])

async function fetchUsers() {
  if (members.value.length) return
  try {
    const r = await projectService.getMembers(projectId)
    if (r.success) {
      members.value = r.data
      // users도 호환용으로 채움
      users.value = r.data.map((m: any) => ({
        userId: m.user?.userId || m.userId,
        userName: m.user?.userName || '',
        department: m.user?.department || '',
        position: m.user?.position || '',
      }))
    }
  } catch {}
}

// 기준일 포함 + 리프 + 본인 담당 태스크 하이라이트
function isActiveTask(task: any): boolean {
  // 리프만
  const isLeaf = !hasChildren(task.taskId)
  if (!isLeaf) return false
  // 계획기간에 기준일 포함
  if (!task.planStart || !task.planEnd) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const ps = new Date(task.planStart); ps.setHours(0, 0, 0, 0)
  const pe = new Date(task.planEnd); pe.setHours(0, 0, 0, 0)
  if (today < ps || today > pe) return false
  // 본인 담당 (관리자는 전체)
  if (isPmsAdmin.value) return true
  const uid = authStore.user?.userId
  if (task.assigneeId === uid) return true
  // 팀장: 소속 팀원
  if (isLeader.value) {
    const m = members.value.find((m: any) => (m.user?.userId || m.userId) === task.assigneeId)
    return (m?.user?.department || m?.department) === authStore.user?.department
  }
  return false
}

// 실적 등록 가능 여부 판단
function canEditActual(task: any): boolean {
  // 리프 태스크만
  const isLeaf = !task.children?.length && !flatTasks.value.some((c: any) => c.parentTaskId === task.taskId)
  if (!isLeaf) return false
  // 이미 완료된 태스크는 편집 불가
  if ((task as any).actualRate >= 100 && task.actualEnd) return false

  const userId = authStore.user?.userId
  const userDept = authStore.user?.department

  // 본인 담당 태스크: 모든 역할에서 실적 등록 가능 (PM 포함)
  if (task.assigneeId === userId || (task as any).assigneeName === authStore.user?.userName) return true

  // PMS관리자/팀장/팀원만 타인 태스크 편집 가능
  if (!canEdit.value) return false

  if (isLeader.value) {
    // 팀장: 소속 부서 태스크도 가능
    const assigneeMember = members.value.find((m: any) => (m.user?.userId || m.userId) === task.assigneeId)
    const assigneeDept = assigneeMember?.user?.department || assigneeMember?.department
    return assigneeDept === userDept
  }
  return false
}

// 업무 필터 (depth 2 기준)
const activeTaskFilter = ref(false)  // 기준일 태스크만 표시
const businessFilter = ref<string>('all')  // 'all' | taskId
const businessOptions = computed(() => {
  const depth2 = flatTasks.value.filter(t => t.depth === 2)
  return [
    { title: '전체 업무', value: 'all' },
    ...depth2.map(t => ({ title: `${t.wbsCode} ${t.taskName}`, value: String(t.taskId) })),
  ]
})

// 단계(공정) 필터
const phaseFilter = ref<string>('all')
const phaseFilterOptions = computed(() => {
  const phases = new Set<string>()
  let targetTasks = flatTasks.value
  if (businessFilter.value !== 'all') {
    const biz = flatTasks.value.find(t => t.taskId === Number(businessFilter.value))
    if (biz) {
      const prefix = biz.wbsCode + '.'
      targetTasks = flatTasks.value.filter(t => t.wbsCode?.startsWith(prefix))
    }
  }
  for (const t of targetTasks) {
    if ((t as any).phase) phases.add((t as any).phase)
  }
  return [
    { title: '전체 단계', value: 'all' },
    ...['분석', '설계', '구현', '시험', '이행'].filter(p => phases.has(p)).map(p => ({ title: p, value: p })),
  ]
})

// 사용자 필터
const userFilter = ref<string>('all')  // 'all' | userId
const userFilterOptions = computed(() => {
  // 선택된 업무 + 단계에 배정된 담당자 목록
  let targetTasks = flatTasks.value
  if (businessFilter.value !== 'all') {
    const biz = flatTasks.value.find(t => t.taskId === Number(businessFilter.value))
    if (biz) {
      const prefix = biz.wbsCode + '.'
      targetTasks = flatTasks.value.filter(t => t.wbsCode?.startsWith(prefix))
    }
  }
  if (phaseFilter.value !== 'all') {
    targetTasks = targetTasks.filter(t => (t as any).phase === phaseFilter.value)
  }

  const assigneeIds = new Set<string>()
  for (const t of targetTasks) {
    if ((t as any).assigneeId) assigneeIds.add((t as any).assigneeId)
  }

  const userList: { title: string; value: string }[] = [{ title: '전체 담당자', value: 'all' }]
  for (const m of members.value) {
    const uid = m.user?.userId || m.userId
    if (assigneeIds.has(uid)) {
      const name = m.user?.userName || m.userName || uid
      const dept = m.user?.department || m.department || ''
      userList.push({ title: `${name} (${dept})`, value: uid })
    }
  }
  return userList
})

// 업무 변경 시 단계/사용자 필터 초기화
function onBusinessFilterChange() {
  phaseFilter.value = 'all'
  const myId = authStore.user?.userId || ''
  const hasMe = userFilterOptions.value.some(o => o.value === myId)
  userFilter.value = hasMe ? myId : 'all'
}

function onPhaseFilterChange() {
  const myId = authStore.user?.userId || ''
  const hasMe = userFilterOptions.value.some(o => o.value === myId)
  userFilter.value = hasMe ? myId : 'all'
}

// 비관리자 자동 필터: 로그인 사용자의 부서에 해당하는 업무만
function autoFilterByDept() {
  if (isPmsAdmin.value) return // 관리자는 전체
  const userDept = authStore.user?.department
  if (!userDept) return
  // 해당 부서 인원이 배정된 depth 2 업무 찾기
  const depth2 = flatTasks.value.filter(t => t.depth === 2)
  for (const biz of depth2) {
    const bizDescendants = flatTasks.value.filter(t => t.wbsCode?.startsWith(biz.wbsCode + '.'))
    const hasDeptMember = bizDescendants.some(t => {
      const member = members.value.find((m: any) => (m.user?.userId || m.userId) === (t as any).assigneeId)
      const assigneeDept = member?.user?.department || member?.department
      return assigneeDept === userDept
    })
    if (hasDeptMember) {
      businessFilter.value = String(biz.taskId)
      // 본인 자동 선택
      userFilter.value = authStore.user?.userId || 'all'
      return
    }
  }
}

// 접기/펴기
const collapsed = ref(new Set<number>())

function toggleCollapse(taskId: number) {
  const s = new Set(collapsed.value)
  if (s.has(taskId)) s.delete(taskId)
  else s.add(taskId)
  collapsed.value = s
}

function collapseAll() {
  const s = new Set<number>()
  for (const t of flatTasks.value) {
    // 자식이 있는 태스크만 접기
    if (flatTasks.value.some(c => c.parentTaskId === t.taskId)) {
      s.add(t.taskId)
    }
  }
  collapsed.value = s
}

function expandAll() {
  collapsed.value = new Set()
}

// 접힌 상태를 고려한 표시용 태스크 목록
const visibleTasks = computed(() => {
  const hiddenParents = new Set<number>()
  const result: WbsTask[] = []

  // 1단계: 업무 필터
  let filtered = flatTasks.value
  if (businessFilter.value !== 'all') {
    const bizId = Number(businessFilter.value)
    const biz = flatTasks.value.find(t => t.taskId === bizId)
    if (biz) {
      const bizWbs = biz.wbsCode + '.'
      filtered = flatTasks.value.filter(t =>
        t.depth === 1 || t.taskId === bizId || (t.wbsCode && t.wbsCode.startsWith(bizWbs))
      )
    }
  }

  // 2단계: 단계(공정) 필터 — 해당 단계 태스크 + 상위 계층 유지
  if (phaseFilter.value !== 'all') {
    const ph = phaseFilter.value
    const matchIds = new Set<number>()
    for (const t of filtered) {
      if ((t as any).phase === ph) matchIds.add(t.taskId)
    }
    const keepIds = new Set<number>(matchIds)
    for (const tid of matchIds) {
      let current = filtered.find(t => t.taskId === tid)
      while (current?.parentTaskId) {
        keepIds.add(current.parentTaskId)
        current = filtered.find(t => t.taskId === current!.parentTaskId)
      }
    }
    filtered = filtered.filter(t => keepIds.has(t.taskId))
  }

  // 3단계: 사용자 필터 — 해당 담당자 태스크 + 상위 계층 유지
  if (userFilter.value !== 'all') {
    const uid = userFilter.value
    // 담당자가 일치하는 리프 태스크의 ID
    const matchIds = new Set<number>()
    for (const t of filtered) {
      if ((t as any).assigneeId === uid) matchIds.add(t.taskId)
    }
    // 상위 계층 포함 (리프 → 루트까지 부모 추적)
    const keepIds = new Set<number>(matchIds)
    for (const tid of matchIds) {
      let current = filtered.find(t => t.taskId === tid)
      while (current?.parentTaskId) {
        keepIds.add(current.parentTaskId)
        current = filtered.find(t => t.taskId === current!.parentTaskId)
      }
    }
    filtered = filtered.filter(t => keepIds.has(t.taskId))
  }

  // 2.5단계: 기준일 태스크 필터
  if (activeTaskFilter.value) {
    const matchIds = new Set<number>()
    for (const t of filtered) {
      if (isActiveTask(t)) matchIds.add(t.taskId)
    }
    const keepIds2 = new Set<number>(matchIds)
    for (const tid of matchIds) {
      let current = filtered.find(t => t.taskId === tid)
      while (current?.parentTaskId) {
        keepIds2.add(current.parentTaskId)
        current = filtered.find(t => t.taskId === current!.parentTaskId)
      }
    }
    filtered = filtered.filter(t => keepIds2.has(t.taskId))
  }

  // 3단계: 접기/펴기
  for (const t of filtered) {
    if (t.parentTaskId && hiddenParents.has(t.parentTaskId)) {
      hiddenParents.add(t.taskId)
      continue
    }
    result.push(t)
    if (collapsed.value.has(t.taskId)) {
      hiddenParents.add(t.taskId)
    }
  }
  return result
})

// 자식 존재 여부 (화살표 아이콘 표시용)
function hasChildren(taskId: number): boolean {
  return flatTasks.value.some(t => t.parentTaskId === taskId)
}

// 오늘 기준일
const today = new Date().toISOString().substring(0, 10)

// 단계 자식 목록 (가중 평균 공통 유틸)
function getStageChildren() {
  const roots = flatTasks.value.filter(t => !t.parentTaskId)
  if (!roots.length) return []
  const rootId = roots.length === 1 ? roots[0].taskId : null
  return rootId
    ? flatTasks.value.filter(t => t.parentTaskId === rootId)
    : roots
}

// 전체 계획진척률 = Σ(단계 가중치 × 단계 계획진척률)
const totalProgress = computed(() => {
  if (!flatTasks.value.length) return 0
  const roots = flatTasks.value.filter(t => !t.parentTaskId)
  if (!roots.length) return 0

  // 루트가 1개면 그 루트의 자식들로 가중 평균
  if (roots.length === 1) {
    const rootId = roots[0].taskId
    const children = flatTasks.value.filter(t => t.parentTaskId === rootId)
    if (!children.length) return roots[0].progressRate

    const totalWeight = children.reduce((s, c) => s + ((c as any).weight || 0), 0)
    if (totalWeight > 0) {
      return Math.round(children.reduce((s, c) => s + c.progressRate * ((c as any).weight || 0), 0) / totalWeight * 10) / 10
    }
    return Math.round(children.reduce((s, c) => s + c.progressRate, 0) / children.length * 10) / 10
  }

  // 루트가 여러개면 가중 평균
  const totalWeight = roots.reduce((s, t) => s + ((t as any).weight || 0), 0)
  if (totalWeight > 0) {
    return Math.round(roots.reduce((s, t) => s + t.progressRate * ((t as any).weight || 0), 0) / totalWeight * 10) / 10
  }
  return Math.round(roots.reduce((s, t) => s + t.progressRate, 0) / roots.length * 10) / 10
})

// 전체 실적진척률 = Σ(단계 가중치 × 단계 실적진척률)
const totalActualProgress = computed(() => {
  const children = getStageChildren()
  if (!children.length) return 0
  const totalWeight = children.reduce((s, c) => s + ((c as any).weight || 0), 0)
  if (totalWeight > 0) {
    return Math.round(children.reduce((s, c) => s + ((c as any).actualRate || 0) * ((c as any).weight || 0), 0) / totalWeight * 10) / 10
  }
  return Math.round(children.reduce((s, c) => s + ((c as any).actualRate || 0), 0) / children.length * 10) / 10
})

// 플랫 목록에서 부모 후보
const parentOptions = computed(() => {
  return flatTasks.value
    .filter(t => t.depth < 5 && t.taskId !== editId.value)
    .map(t => ({
      title: `${'─'.repeat(t.depth - 1)} ${t.taskName}`,
      value: t.taskId,
    }))
})

function openCreate(parentId?: number) {
  fetchUsers()
  editMode.value = false
  editId.value = null
  form.value = {
    wbsCode: '', taskName: '', parentTaskId: parentId || null,
    phase: '', planStart: '', planEnd: '',
    baselineStart: '', baselineEnd: '',
    actualStart: '', actualEnd: '',
    duration: null as number | null, actualMd: null as number | null,
    progressRate: 0, actualRate: 0, weight: 1,
    taskRole: '', assigneeId: '',
  }
  formDeliverables.value = []
  formDeps.value = []
  dialog.value = true
}

const editIsParent = ref(false)
const editHasActual = ref(false) // 실적이 등록된 태스크

function openEdit(task: WbsTask) {
  fetchUsers()
  editMode.value = true
  editId.value = task.taskId
  editIsParent.value = hasChildren(task.taskId)
  editHasActual.value = !!task.actualStart || !!task.actualEnd || ((task as any).actualRate > 0)
  form.value = {
    wbsCode: (task as any).wbsCode || '',
    taskName: task.taskName,
    parentTaskId: task.parentTaskId || null,
    phase: task.phase || '',
    planStart: task.planStart?.substring(0, 10) || '',
    planEnd: task.planEnd?.substring(0, 10) || '',
    baselineStart: (task as any).baselineStart?.substring(0, 10) || '',
    baselineEnd: (task as any).baselineEnd?.substring(0, 10) || '',
    actualStart: task.actualStart?.substring(0, 10) || '',
    actualEnd: task.actualEnd?.substring(0, 10) || '',
    duration: (task as any).duration || null,
    actualMd: (task as any).actualMd || null,
    progressRate: task.progressRate,
    actualRate: (task as any).actualRate || 0,
    weight: (task as any).weight ?? 1,
    taskRole: (task as any).taskRole || '',
    assigneeId: task.assigneeId || '',
  }
  // 기존 산출물 로드
  const existing = taskDeliverables.value.get(task.taskId) || []
  formDeliverables.value = existing.map((d: any) => ({ docType: d.docType, docName: d.docName }))
  // 기존 선후행 로드
  const preds = (task as any).predecessors || []
  formDeps.value = preds.map((d: any) => ({ predecessorId: d.predecessorId, depType: d.depType, lagDays: d.lagDays }))
  dialog.value = true
}

async function save() {
  try {
    // 실적 입력 시 유효성 검증
    if (form.value.actualEnd && form.value.actualRate < 100) {
      await showAlert('실적 진행률이 100%가 아니면 실제 종료일을 등록할 수 없습니다.', { color: 'warning' })
      return
    }
    if (form.value.actualRate >= 100 && !form.value.actualEnd) {
      await showAlert('실적 진행률이 100%입니다. 실제 종료일을 입력해주세요.', { color: 'warning' })
      return
    }
    if (form.value.actualRate > 0 && !form.value.actualStart) {
      await showAlert('실적이 입력되었습니다. 실제 시작일을 입력해주세요.', { color: 'warning' })
      return
    }

    const payload: any = { ...form.value }
    if (!payload.phase) delete payload.phase
    if (!payload.assigneeId) delete payload.assigneeId

    let taskId: number
    if (editMode.value && editId.value) {
      await wbsService.update(projectId, editId.value, payload)
      taskId = editId.value
    } else {
      const res = await wbsService.create(projectId, payload)
      taskId = res.data.taskId
    }

    // 산출물 동기화: 삭제 + 추가
    const newDocs = formDeliverables.value.filter(d => d.docType && d.docName)
    const existingDocs = taskDeliverables.value.get(taskId) || []

    // 기존에 있었는데 폼에서 제거된 산출물 삭제
    for (const existing of existingDocs) {
      const stillExists = newDocs.find((d: any) => d.docType === existing.docType && d.docName === existing.docName)
      if (!stillExists) {
        try { await deliverableService.remove(projectId, existing.docId) } catch {}
      }
    }

    // 폼에 있는데 기존에 없는 산출물 추가
    for (const doc of newDocs) {
      const dup = existingDocs.find((e: any) => e.docType === doc.docType && e.docName === doc.docName)
      if (dup) continue
      const fd = new FormData()
      fd.append('taskId', String(taskId))
      fd.append('docType', doc.docType)
      fd.append('docName', doc.docName)
      await deliverableService.create(projectId, fd)
    }

    // 선후행 관계 등록 (새로 추가된 것만)
    const newDeps = formDeps.value.filter(d => d.predecessorId)
    for (const dep of newDeps) {
      try {
        await api.post(`/projects/${projectId}/wbs/${taskId}/dependencies`, dep)
      } catch {} // 중복은 무시
    }

    dialog.value = false
    await showAlert('저장이 완료되었습니다.')
    fetchAll()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '저장 실패', { color: 'error' })
  }
}

async function removeTask(taskId: number) {
  if (!(await showConfirm('해당 태스크를 삭제하시겠습니까?'))) return
  try {
    await wbsService.remove(projectId, taskId)
    fetchAll()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' })
  }
}

function baselineMd(task: any): string {
  const bs = task.baselineStart
  const be = task.baselineEnd
  if (!bs || !be) return ''
  const start = new Date(bs)
  const end = new Date(be)
  let count = 0
  const cur = new Date(start)
  while (cur <= end) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return String(count)
}

function formatDate(d?: string) {
  if (!d) return ''
  const s = d.substring(0, 10)  // YYYY-MM-DD
  return s.substring(2)         // YY-MM-DD (공간 절약)
}

function getPhaseColor(phase?: string) {
  const c: Record<string, string> = { '분석': 'blue', '설계': 'purple', '구현': 'green', '시험': 'orange', '이행': 'teal' }
  return c[phase || ''] || 'grey'
}

// 간트차트 계산
const ganttRange = computed(() => {
  if (!project.value) return { start: new Date(), end: new Date(), totalDays: 1 }
  const start = new Date(project.value.startDate)
  const end = new Date(project.value.endDate)
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
  return { start, end, totalDays }
})

function ganttBar(task: WbsTask) {
  const { start, totalDays } = ganttRange.value
  const ps = task.planStart ? new Date(task.planStart) : null
  const pe = task.planEnd ? new Date(task.planEnd) : null
  if (!ps || !pe) return { left: '0%', width: '0%' }
  const leftDays = Math.max(0, (ps.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  const durDays = Math.max(1, (pe.getTime() - ps.getTime()) / (1000 * 60 * 60 * 24))
  return {
    left: `${(leftDays / totalDays) * 100}%`,
    width: `${(durDays / totalDays) * 100}%`,
  }
}

// 간트 월 헤더
const ganttMonths = computed(() => {
  if (!project.value) return []
  const { start, end, totalDays } = ganttRange.value
  const months: { label: string; left: string; width: string }[] = []
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cur <= end) {
    const mStart = new Date(Math.max(cur.getTime(), start.getTime()))
    const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0)
    const mEndClamped = new Date(Math.min(mEnd.getTime(), end.getTime()))
    const leftDays = (mStart.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    const durDays = (mEndClamped.getTime() - mStart.getTime()) / (1000 * 60 * 60 * 24) + 1
    months.push({
      label: `${cur.getFullYear()}.${String(cur.getMonth() + 1).padStart(2, '0')}`,
      left: `${(leftDays / totalDays) * 100}%`,
      width: `${(durDays / totalDays) * 100}%`,
    })
    cur.setMonth(cur.getMonth() + 1)
  }
  return months
})

// 간트차트 의존관계 화살표 좌표 계산
const ganttRowHeight = 30
const ganttLabelWidth = 220

const depLinks = computed(() => {
  const links: { key: string; path: string; color: string; type: string }[] = []
  const { start, totalDays } = ganttRange.value
  if (!totalDays || !visibleTasks.value.length) return links

  // taskId → row index (visible 기준)
  const taskRowMap = new Map<number, number>()
  visibleTasks.value.forEach((t, i) => taskRowMap.set(t.taskId, i))

  // taskId → bar 좌표 (% → px는 비율로 계산)
  function getBarPx(task: WbsTask) {
    const ps = task.planStart ? new Date(task.planStart) : null
    const pe = task.planEnd ? new Date(task.planEnd) : null
    if (!ps || !pe) return null
    const leftDays = Math.max(0, (ps.getTime() - start.getTime()) / 86400000)
    const rightDays = Math.max(0, (pe.getTime() - start.getTime()) / 86400000)
    // 반환: 비율 (0~1)
    return { left: leftDays / totalDays, right: rightDays / totalDays }
  }

  for (const task of visibleTasks.value) {
    const preds = (task as any).predecessors || []
    const succRow = taskRowMap.get(task.taskId)
    if (succRow === undefined) continue

    for (const dep of preds) {
      const predRow = taskRowMap.get(dep.predecessorId)
      if (predRow === undefined) continue

      const predTask = visibleTasks.value[predRow]
      if (!predTask) continue

      const predBar = getBarPx(predTask)
      const succBar = getBarPx(task)
      if (!predBar || !succBar) continue

      // 좌표 계산 (SVG는 gantt-bar-area 기준, left는 비율 * 100%)
      // SVG는 bar-area 위에 absolute로 놓이므로 px 대신 %로 계산
      // 하지만 SVG path는 px이 필요 → 가상 너비 1000px 기준으로 계산
      const W = 780  // bar-area 가상 너비 (1000 - 220)

      let x1: number, y1: number, x2: number, y2: number
      const depType = dep.depType || 'FS'
      const color = { FS: '#E53935', SS: '#1565C0', FF: '#2E7D32', SF: '#E65100' }[depType] || '#E53935'

      const predCenterY = predRow * ganttRowHeight + ganttRowHeight / 2
      const succCenterY = succRow * ganttRowHeight + ganttRowHeight / 2

      switch (depType) {
        case 'FS': // 선행 끝 → 후행 시작
          x1 = predBar.right * W
          y1 = predCenterY
          x2 = succBar.left * W
          y2 = succCenterY
          break
        case 'SS': // 선행 시작 → 후행 시작
          x1 = predBar.left * W
          y1 = predCenterY
          x2 = succBar.left * W
          y2 = succCenterY
          break
        case 'FF': // 선행 끝 → 후행 끝
          x1 = predBar.right * W
          y1 = predCenterY
          x2 = succBar.right * W
          y2 = succCenterY
          break
        case 'SF': // 선행 시작 → 후행 끝
          x1 = predBar.left * W
          y1 = predCenterY
          x2 = succBar.right * W
          y2 = succCenterY
          break
        default:
          x1 = predBar.right * W; y1 = predCenterY
          x2 = succBar.left * W; y2 = succCenterY
      }

      // L자 경로 (수직→수평→수직)
      const midY = (y1 + y2) / 2
      let path: string
      if (Math.abs(y1 - y2) < 3) {
        // 같은 행 → 직선
        path = `M ${x1} ${y1} L ${x2} ${y2}`
      } else if (x2 > x1 + 10) {
        // 후행이 오른쪽 → 꺾임
        const bendX = x1 + 8
        path = `M ${x1} ${y1} L ${bendX} ${y1} L ${bendX} ${y2} L ${x2} ${y2}`
      } else {
        // 후행이 왼쪽이거나 겹침 → 아래로 우회
        const offset = 12
        const outX = Math.max(x1, x2) + offset
        path = `M ${x1} ${y1} L ${outX} ${y1} L ${outX} ${midY} L ${Math.min(x1, x2) - offset} ${midY} L ${Math.min(x1, x2) - offset} ${y2} L ${x2} ${y2}`
      }

      links.push({
        key: `${dep.predecessorId}-${task.taskId}`,
        path,
        color,
        type: depType.toLowerCase(),
      })
    }
  }
  return links
})

// 컬럼 리사이즈 드래그 — colgroup의 col width를 변경
const colWidths = ref([70, 220, 46, 46, 60, 72, 72, 72, 72, 38, 70, 70, 40, 40, 66])

function startResize(colIdx: number, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const startW = colWidths.value[colIdx]

  function onMove(ev: MouseEvent) {
    ev.preventDefault()
    const diff = ev.clientX - startX
    colWidths.value[colIdx] = Math.max(30, startW + diff)
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// 쿼리 파라미터로 태스크 위치 이동
const highlightWbs = ref<string | null>(null)

onMounted(async () => {
  await fetchAll()
  const targetWbs = route.query.task as string
  if (targetWbs) {
    // taskId(숫자) 또는 wbsCode(문자열) 모두 지원
    const isTaskId = /^\d+$/.test(targetWbs)
    const targetTask = isTaskId
      ? flatTasks.value.find(t => String(t.taskId) === targetWbs)
      : flatTasks.value.find(t => t.wbsCode === targetWbs)
    const wbsCode = targetTask?.wbsCode || targetWbs
    highlightWbs.value = wbsCode

    if (targetTask) {
      // depth 2 업무 찾기
      const parts = wbsCode.split('.')
      for (let i = parts.length; i >= 2; i--) {
        const prefix = parts.slice(0, i).join('.')
        const biz = flatTasks.value.find(t => t.wbsCode === prefix && t.depth === 2)
        if (biz) { businessFilter.value = String(biz.taskId); break }
      }
      // 담당자 필터 해제 (승인자가 접근할 수 있도록)
      userFilter.value = 'all'
      // DOM 업데이트 후 스크롤
      setTimeout(() => {
        const el = document.querySelector(`[data-wbs="${wbsCode}"]`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 300)
      // 승인 역할이면 자동으로 실적 등록(승인) 다이얼로그 열기
      // 또는 담당자가 승인완료 알림으로 접근한 경우도 자동 오픈 + 슬라이더 자동 설정
      const fromApproval = route.query.fromApproval === '1'
      const isAssignee = targetTask.assigneeId === authStore.user?.userId
      if ((isApprovalRole() && !hasChildren(targetTask.taskId)) || (fromApproval && isAssignee)) {
        setTimeout(async () => {
          await openActualDialog(targetTask)
          // 담당자가 알림으로 접근한 경우: 반려 / 승인완료 상황별 처리
          if (fromApproval && isAssignee) {
            if (hasRejectedDocs.value) {
              // 반려 알림: 별도 슬라이더 조작 없음 (가이드는 alert 영역에서 표시)
              actualRateGuide.value = ''
            } else if (actualMaxRate.value > actualForm.value.actualRate) {
              // 승인완료 알림: 상한으로 슬라이더 이동
              actualForm.value.actualRate = actualMaxRate.value
              actualRateGuide.value = actualMaxRate.value >= 100
                ? `승인 완료로 실적 진행률이 100%로 설정되었습니다. 실제 종료일을 등록하고 저장해주세요.`
                : `승인 완료로 실적 진행률이 ${actualMaxRate.value}%로 설정되었습니다. 저장 버튼을 눌러 확정하세요.`
            }
          }
        }, 500)
      }
      // 3초 후 하이라이트 제거
      setTimeout(() => { highlightWbs.value = null }, 4000)
    }
  }
})
</script>

<template>
  <MainLayout>
    <!-- 헤더 1줄 -->
    <v-row class="mb-1" align="center" dense>
      <v-col cols="auto">
        <v-btn icon size="small" variant="text" @click="router.push(`/projects/${projectId}`)"><v-icon>mdi-arrow-left</v-icon></v-btn>
      </v-col>
      <v-col>
        <span class="text-subtitle-1 font-weight-bold">WBS / 일정 관리</span>
        <span class="text-caption text-grey ml-2">{{ project?.projectName }}</span>
      </v-col>
      <v-col cols="auto" class="d-flex align-center ga-2">
        <v-chip variant="outlined" size="small" prepend-icon="mdi-calendar-today">기준일 {{ today }}</v-chip>
        <v-chip color="primary" variant="tonal" size="small">계획 {{ totalProgress }}%</v-chip>
        <v-chip color="success" variant="tonal" size="small">실적 {{ totalActualProgress }}%</v-chip>
      </v-col>
    </v-row>
    <!-- 헤더 2줄: 도구 버튼 -->
    <v-row class="mb-3" dense>
      <v-col cols="auto" class="d-flex align-center flex-wrap ga-1">
        <v-select v-model="businessFilter" :items="businessOptions" variant="outlined" density="compact" hide-details class="filter-select" style="max-width:200px" @update:model-value="onBusinessFilterChange" />
        <v-select v-model="phaseFilter" :items="phaseFilterOptions" variant="outlined" density="compact" hide-details class="filter-select" style="max-width:110px" @update:model-value="onPhaseFilterChange" />
        <v-select v-model="userFilter" :items="userFilterOptions" variant="outlined" density="compact" hide-details class="filter-select" style="max-width:180px" />
        <v-divider vertical class="mx-1" />
        <v-btn
          :variant="activeTaskFilter ? 'flat' : 'outlined'" size="x-small"
          :color="activeTaskFilter ? 'amber-darken-2' : undefined"
          prepend-icon="mdi-calendar-check"
          @click="activeTaskFilter = !activeTaskFilter"
        >기준일</v-btn>
        <v-btn variant="text" size="x-small" prepend-icon="mdi-unfold-less-horizontal" @click="collapseAll">접기</v-btn>
        <v-btn variant="text" size="x-small" prepend-icon="mdi-unfold-more-horizontal" @click="expandAll">펴기</v-btn>
        <v-divider vertical class="mx-1" />
        <v-btn-toggle v-model="viewMode" mandatory density="compact">
          <v-btn value="tree" size="x-small"><v-icon size="x-small">mdi-file-tree</v-icon></v-btn>
          <v-btn value="gantt" size="x-small"><v-icon size="x-small">mdi-chart-gantt</v-icon></v-btn>
        </v-btn-toggle>
        <v-divider vertical class="mx-1" />
        <v-btn v-if="canModifyStructure" color="orange" variant="outlined" size="x-small" prepend-icon="mdi-calendar-clock" @click="openScheduleDialog">스케줄</v-btn>
        <v-btn v-if="canModifyStructure" variant="outlined" size="x-small" prepend-icon="mdi-file-upload-outline" @click="importDialog = true">엑셀 업로드</v-btn>
        <v-btn variant="outlined" size="x-small" prepend-icon="mdi-file-download-outline" @click="doExport">엑셀 다운로드</v-btn>
        <v-btn v-if="canModifyStructure" color="primary" size="x-small" prepend-icon="mdi-plus" @click="openCreate()">추가</v-btn>
        <v-chip v-if="isPmsAdmin && wbsLocked && !wbsForceUnlock" size="x-small" variant="tonal" color="error" class="ml-1">
          <v-icon start size="12">mdi-lock</v-icon> 구조 잠금
        </v-chip>
        <v-btn v-if="isPmsAdmin && wbsLocked && !wbsForceUnlock" size="x-small" variant="text" color="error" @click="wbsForceUnlock = true">잠금 해제</v-btn>
        <v-btn v-if="isPmsAdmin && wbsLocked" size="x-small" variant="outlined" color="error" prepend-icon="mdi-restore" @click="resetActuals">실적 초기화</v-btn>
      </v-col>
    </v-row>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <!-- 임포트 결과 -->
    <v-alert v-if="importResult" :type="importResult.corrections?.length ? 'warning' : 'success'" density="compact" closable class="mb-4" @click:close="importResult = null">
      <div class="font-weight-bold">임포트 완료 — {{ importResult.imported }}개 태스크 (시트: {{ importResult.sheet }})</div>
      <div v-if="importResult.parentFixed" class="text-caption mt-1">부모 태스크 일정 자동 집계: {{ importResult.parentFixed }}건 (자식 min/max 기준)</div>
      <div v-if="importResult.corrections?.length" class="mt-2">
        <div class="text-caption font-weight-bold">주말 일자 Working Day 보정 {{ importResult.corrections.length }}건:</div>
        <div v-for="(c, i) in importResult.corrections.slice(0, 20)" :key="i" class="text-caption mt-1">
          <strong>{{ c.wbsCode }} {{ c.taskName }}</strong> {{ c.field }}: {{ c.before }} → <span class="text-success">{{ c.after }}</span>
        </div>
        <div v-if="importResult.corrections.length > 20" class="text-caption mt-1 text-grey">외 {{ importResult.corrections.length - 20 }}건...</div>
      </div>
      <div v-else class="text-caption mt-1">주말 일자 보정 없음 (모두 Working Day)</div>
    </v-alert>

    <!-- 스케줄 결과 -->
    <v-alert v-if="scheduleResult" :type="scheduleResult.conflicts?.length ? 'warning' : 'success'" density="compact" closable class="mb-4" @click:close="scheduleResult = null">
      <div class="font-weight-bold mb-1">
        {{ scheduleResult.mode === 'check' ? '스케줄 검증 완료' : '스케줄 적용 완료' }}
        {{ scheduleResult.mode === 'apply' ? `— ${scheduleResult.updated}개 태스크 일정 변경` : '' }}
      </div>
      <div class="text-caption">계약기간: {{ scheduleResult.projectStart }} ~ {{ scheduleResult.projectEnd }}</div>
      <div v-for="(w, i) in scheduleResult.warnings" :key="'w'+i" class="text-caption mt-1 text-error">{{ w }}</div>
      <div v-if="scheduleResult.conflicts?.length" class="mt-2">
        <div class="text-caption font-weight-bold text-error">선후행 불일치 {{ scheduleResult.conflicts.length }}건:</div>
        <div v-for="(c, i) in scheduleResult.conflicts" :key="'c'+i" class="text-caption mt-1">
          <strong>{{ c.wbsCode }} {{ c.taskName }}</strong> [{{ c.depType }}] ← {{ c.predName }}<br/>
          <span class="text-grey-darken-1">{{ c.issue }}</span>
        </div>
      </div>
      <div v-else class="text-caption mt-1 text-success">선후행 불일치 없음</div>
    </v-alert>

    <!-- 가중치 경고 -->
    <v-alert v-if="weightCheckDone && weightWarnings.length" type="warning" density="compact" closable class="mb-4" @click:close="weightCheckDone = false">
      <div class="font-weight-bold mb-1">가중치 합계가 100%가 아닌 그룹이 있습니다</div>
      <div v-for="w in weightWarnings" :key="w.taskId" class="mb-2">
        <div class="text-body-2">
          <strong>{{ w.wbsCode }} {{ w.taskName }}</strong> — 하위 합계: <span :class="w.childrenSum > 100 ? 'text-error' : 'text-warning'">{{ w.childrenSum }}%</span>
          ({{ w.diff > 0 ? w.diff + '% 부족' : Math.abs(w.diff) + '% 초과' }})
        </div>
        <div class="text-caption text-grey">
          <span v-for="(c, i) in w.children" :key="i">{{ c.wbsCode }} {{ c.taskName }}({{ c.weight }}%){{ i < w.children.length - 1 ? ', ' : '' }}</span>
        </div>
      </div>
    </v-alert>

    <!-- 트리 뷰 -->
    <v-card v-if="viewMode === 'tree'" class="elevation-1 wbs-table-card">
      <div style="overflow-x:auto" v-if="flatTasks.length">
        <table class="wbs-table">
          <colgroup>
            <col v-for="(w, i) in colWidths" :key="i" :style="{ width: w + 'px' }" />
          </colgroup>
          <thead>
            <tr class="wbs-header-group">
              <th colspan="3"></th>
              <th colspan="2">기본정보</th>
              <th colspan="2" class="hg-plan">계획</th>
              <th colspan="2" class="hg-actual">실제진행</th>
              <th></th>
              <th colspan="2">진행률</th>
              <th colspan="3"></th>
            </tr>
            <tr>
              <th>WBS<span class="col-resize" @mousedown="startResize(0, $event)"></span></th>
              <th>태스크명<span class="col-resize" @mousedown="startResize(1, $event)"></span></th>
              <th>단계<span class="col-resize" @mousedown="startResize(2, $event)"></span></th>
              <th>역할<span class="col-resize" @mousedown="startResize(3, $event)"></span></th>
              <th>담당<span class="col-resize" @mousedown="startResize(4, $event)"></span></th>
              <th class="th-plan">시작<span class="col-resize" @mousedown="startResize(5, $event)"></span></th>
              <th class="th-plan">종료<span class="col-resize" @mousedown="startResize(6, $event)"></span></th>
              <th class="th-actual">시작<span class="col-resize" @mousedown="startResize(7, $event)"></span></th>
              <th class="th-actual">종료<span class="col-resize" @mousedown="startResize(8, $event)"></span></th>
              <th>지연<span class="col-resize" @mousedown="startResize(9, $event)"></span></th>
              <th>계획진행<span class="col-resize" @mousedown="startResize(10, $event)"></span></th>
              <th>실적진행<span class="col-resize" @mousedown="startResize(11, $event)"></span></th>
              <th>선행<span class="col-resize" @mousedown="startResize(12, $event)"></span></th>
              <th>산출물<span class="col-resize" @mousedown="startResize(13, $event)"></span></th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in visibleTasks" :key="task.taskId" :data-wbs="task.wbsCode" :class="{ 'row-root': task.depth === 1, 'row-parent': hasChildren(task.taskId) && task.depth > 1, 'row-active-task': isActiveTask(task), 'row-highlight': highlightWbs === task.wbsCode }">
              <td class="col-wbs">{{ (task as any).wbsCode || '' }}</td>
              <td class="col-name">
                <span :style="{ paddingLeft: (task.depth - 1) * 14 + 'px' }" class="d-inline-flex align-center">
                  <v-icon
                    v-if="hasChildren(task.taskId)"
                    size="14"
                    class="mr-1 toggle-icon"
                    @click="toggleCollapse(task.taskId)"
                  >{{ collapsed.has(task.taskId) ? 'mdi-chevron-right' : 'mdi-chevron-down' }}</v-icon>
                  <span v-else-if="task.depth > 1" class="mr-1" style="width:14px;display:inline-block"></span>
                  <span :class="hasChildren(task.taskId) ? 'font-weight-bold' : ''">{{ task.taskName }}</span>
                </span>
              </td>
              <td class="col-xs">
                <v-chip v-if="task.phase" :color="getPhaseColor(task.phase)" size="x-small" variant="tonal" label>{{ task.phase }}</v-chip>
              </td>
              <td class="col-xs text-truncate">{{ (task as any).taskRole || '' }}</td>
              <td class="col-sm text-truncate">{{ task.assigneeName || '' }}</td>
              <td class="col-date td-plan">{{ formatDate(task.planStart) }}</td>
              <td class="col-date td-plan">{{ formatDate(task.planEnd) }}</td>
              <td class="col-date td-actual">{{ formatDate(task.actualStart) }}</td>
              <td class="col-date td-actual">{{ formatDate(task.actualEnd) }}</td>
              <td class="col-xxs text-center" :class="{ 'delay-minus': (task as any).delayDays > 0, 'delay-plus': (task as any).delayDays < 0 }">
                {{ (task as any).delayDays != null ? ((task as any).delayDays > 0 ? '+' : '') + (task as any).delayDays : '' }}
              </td>
              <td class="col-prog">
                <v-progress-linear :model-value="task.progressRate" color="primary" height="14" rounded>
                  <span style="font-size:10px">{{ task.progressRate }}%</span>
                </v-progress-linear>
              </td>
              <td class="col-prog">
                <v-progress-linear :model-value="(task as any).actualRate || 0" color="success" height="14" rounded>
                  <span style="font-size:10px">{{ (task as any).actualRate || 0 }}%</span>
                </v-progress-linear>
              </td>
              <td class="col-xs">
                <template v-if="(task as any).predecessors?.length">
                  <span v-for="dep in (task as any).predecessors.slice(0,2)" :key="dep.depId" class="dep-tag">{{ dep.depType }}{{ dep.lagDays ? (dep.lagDays>0?'+':'') + dep.lagDays + 'd' : '' }}</span>
                </template>
              </td>
              <td class="col-doc">
                <template v-if="taskDeliverables.get(task.taskId)?.length">
                  <v-tooltip location="top">
                    <template #activator="{ props }">
                      <span v-bind="props" class="doc-badge">
                        <span class="doc-tag">{{ taskDeliverables.get(task.taskId)![0].docType }}</span>
                        <span v-if="taskDeliverables.get(task.taskId)!.length > 1" class="doc-more">+{{ taskDeliverables.get(task.taskId)!.length - 1 }}</span>
                      </span>
                    </template>
                    <div style="font-size:11px;max-width:250px">
                      <div v-for="d in taskDeliverables.get(task.taskId)!" :key="d.docId" class="mb-1">
                        <strong>{{ d.docType }}</strong> {{ d.docName !== d.docType ? '- ' + d.docName : '' }}
                      </div>
                    </div>
                  </v-tooltip>
                </template>
              </td>
              <td class="col-act">
                <template v-if="isPmsAdmin && !hasChildren(task.taskId) && !((task as any).actualRate >= 100 && task.actualEnd)">
                  <v-btn v-if="canModifyStructure" icon size="18" variant="text" density="compact" @click="openCreate(task.taskId)"><v-icon size="14">mdi-plus</v-icon></v-btn>
                  <v-btn icon size="18" variant="text" density="compact" @click="openEdit(task)"><v-icon size="14">mdi-pencil</v-icon></v-btn>
                  <v-btn v-if="canModifyStructure" icon size="18" variant="text" density="compact" color="error" @click="removeTask(task.taskId)"><v-icon size="14">mdi-delete</v-icon></v-btn>
                </template>
                <template v-else-if="canEditActual(task)">
                  <v-btn size="x-small" variant="tonal" color="success" density="compact" style="min-width:24px; height:22px; padding:0 4px" @click="openActualDialog(task)">
                    <v-icon size="14">mdi-pencil-box-outline</v-icon>
                    <v-tooltip activator="parent" location="top">실적 등록</v-tooltip>
                  </v-btn>
                </template>
                <template v-else-if="approvalEnabled && !hasChildren(task.taskId) && isApprovalRole() && pendingApprovalTaskIds.has(task.taskId)">
                  <v-btn size="x-small" variant="tonal" color="orange" density="compact" style="min-width:24px; height:22px; padding:0 6px; font-size:10px; font-weight:600" @click="openActualDialog(task)">
                    <v-icon size="13" class="mr-1">mdi-check-decagram</v-icon>승인
                    <v-tooltip activator="parent" location="top">산출물 승인처리</v-tooltip>
                  </v-btn>
                </template>
                <template v-else-if="!hasChildren(task.taskId) && (task as any).actualRate >= 100 && task.actualEnd">
                  <v-btn size="x-small" variant="tonal" color="blue-grey" density="compact" style="min-width:24px; height:22px; padding:0 4px" @click="openActualDialog(task)">
                    <v-icon size="14">mdi-check-circle</v-icon>
                    <v-tooltip activator="parent" location="top">실적 완료 (조회)</v-tooltip>
                  </v-btn>
                </template>
              </td>
          </tr>
          </tbody>
        </table>
      </div>
      <v-card-text v-else class="text-center pa-8 text-grey">
        등록된 태스크가 없습니다. 태스크 추가 버튼을 눌러 WBS를 구성하세요.
      </v-card-text>
    </v-card>

    <!-- 간트차트 뷰 -->
    <v-card v-if="viewMode === 'gantt'" class="elevation-1">
      <div v-if="flatTasks.length" style="overflow-x:auto" ref="ganttScrollRef">
        <div :style="{ minWidth: '1000px', position: 'relative' }">
          <!-- 월 헤더 -->
          <div style="position:relative;height:28px;background:#f5f5f5;border-bottom:1px solid #ddd;margin-left:220px">
            <div v-for="(m, i) in ganttMonths" :key="i"
              :style="{ position:'absolute', left: m.left, width: m.width, textAlign:'center', fontSize:'11px', lineHeight:'28px', borderRight:'1px solid #eee', color:'#666' }">
              {{ m.label }}
            </div>
          </div>
          <!-- 태스크 행 -->
          <div style="position:relative">
            <div v-for="(task, rowIdx) in visibleTasks" :key="task.taskId"
              :class="['gantt-row', { 'gantt-row-parent': hasChildren(task.taskId) }]">
              <!-- 태스크명 -->
              <div class="gantt-label">
                <span :style="{ paddingLeft: (task.depth - 1) * 8 + 'px' }" class="d-inline-flex align-center">
                  <v-icon v-if="hasChildren(task.taskId)" size="12" style="cursor:pointer" class="mr-1" @click="toggleCollapse(task.taskId)">{{ collapsed.has(task.taskId) ? 'mdi-chevron-right' : 'mdi-chevron-down' }}</v-icon>
                  <span v-if="(task as any).wbsCode" class="gantt-wbs-code">{{ (task as any).wbsCode }}</span>
                  <span class="text-truncate" :class="hasChildren(task.taskId) ? 'font-weight-bold' : ''">{{ task.taskName }}</span>
                </span>
              </div>
              <!-- 바 영역 -->
              <div class="gantt-bar-area" :data-task-id="task.taskId" :data-row="rowIdx">
                <!-- 진척률 바 (내부) -->
                <div
                  v-if="task.planStart && task.planEnd"
                  class="gantt-bar"
                  :style="{
                    left: ganttBar(task).left, width: ganttBar(task).width,
                    background: hasChildren(task.taskId)
                      ? 'linear-gradient(180deg, #1565C0 0%, #1976D2 100%)'
                      : 'linear-gradient(180deg, #42A5F5 0%, #64B5F6 100%)',
                  }"
                >
                  <!-- 진척률 채움 -->
                  <div class="gantt-bar-progress" :style="{ width: task.progressRate + '%' }"></div>
                  <span class="gantt-bar-text" v-if="parseFloat(ganttBar(task).width) > 4">{{ task.progressRate }}%</span>
                </div>
              </div>
            </div>

            <!-- 의존관계 화살표 SVG 오버레이 -->
            <svg class="gantt-dep-svg" :viewBox="`0 0 780 ${visibleTasks.length * 30}`" preserveAspectRatio="none" :style="{ height: visibleTasks.length * 30 + 'px' }">
              <defs>
                <marker id="arrow-fs" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#E53935" />
                </marker>
                <marker id="arrow-ss" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#1565C0" />
                </marker>
                <marker id="arrow-ff" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#2E7D32" />
                </marker>
                <marker id="arrow-sf" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#E65100" />
                </marker>
              </defs>
              <template v-for="link in depLinks" :key="link.key">
                <path :d="link.path" :stroke="link.color" stroke-width="1.5" fill="none" :marker-end="`url(#arrow-${link.type})`" />
              </template>
            </svg>
          </div>
        </div>
      </div>
      <v-card-text v-else class="text-center pa-8 text-grey">
        등록된 태스크가 없습니다.
      </v-card-text>
    </v-card>

    <!-- 태스크 다이얼로그 -->
    <v-dialog v-model="dialog" max-width="720">
      <v-card class="task-dialog">
        <v-card-title class="task-dialog-title">
          <v-icon start size="small">{{ editMode ? 'mdi-pencil' : 'mdi-plus-circle' }}</v-icon>
          {{ editMode ? '태스크 수정' : '태스크 추가' }}
        </v-card-title>
        <v-card-text class="task-dialog-body">
          <div class="text-caption text-grey mb-2"><span class="text-error">*</span> 필수 입력 항목</div>

          <!-- 1. 기본정보 -->
          <div class="d-flex align-center mb-2">
            <span class="text-subtitle-2">기본정보</span>
            <v-chip v-if="editMode && editHasActual" size="x-small" variant="tonal" color="warning" class="ml-2">실적 등록됨 — 일부 항목 수정 불가</v-chip>
          </div>
          <v-row dense>
            <v-col cols="3">
              <v-text-field v-model="form.wbsCode" label="WBS 코드" variant="outlined" density="compact" placeholder="자동" persistent-placeholder :disabled="editMode && editHasActual" />
            </v-col>
            <v-col cols="9">
              <v-text-field v-model="form.taskName" variant="outlined" density="compact" :rules="[v => !!v || '필수']">
                <template #label><span>태스크명 <span class="text-error">*</span></span></template>
              </v-text-field>
            </v-col>
          </v-row>
          <v-row dense>
            <v-col cols="4">
              <v-select v-model="form.parentTaskId" :items="[{ title: '(최상위)', value: null }, ...parentOptions]" label="상위 태스크" variant="outlined" density="compact" clearable :disabled="editMode && editHasActual" />
            </v-col>
            <v-col cols="3">
              <v-select v-model="form.phase" :items="phases" variant="outlined" density="compact" clearable :disabled="editMode && editHasActual">
                <template #label><span>공정단계 <span class="text-error">*</span></span></template>
              </v-select>
            </v-col>
            <v-col cols="2">
              <v-select v-model="form.taskRole" :items="['PMSAdmin', 'PL', 'TM', 'QA', 'PM', 'PMO', 'Customer', 'Inspector']" label="역할" variant="outlined" density="compact" clearable />
            </v-col>
            <v-col cols="3">
              <UserTreePicker v-model="form.assigneeId" :members="members" label="담당자" clearable />
            </v-col>
          </v-row>

          <!-- 2. 일정 -->
          <v-divider class="my-2" />
          <div class="d-flex align-center mb-2">
            <span class="text-subtitle-2">일정</span>
            <v-chip v-if="editMode && editIsParent" size="x-small" variant="tonal" color="grey" class="ml-2">부모 태스크 — 자식 태스크에서 자동 집계</v-chip>
          </div>
          <v-row dense>
            <v-col cols="3">
              <PmsDatePicker v-model="form.planStart" label="계획시작일" :required="true" :disabled="editMode && (editIsParent || editHasActual)" />
            </v-col>
            <v-col cols="3">
              <PmsDatePicker v-model="form.planEnd" label="계획종료일" :required="true" :disabled="editMode && (editIsParent || editHasActual)" />
            </v-col>
            <v-col cols="3">
              <PmsDatePicker v-model="form.actualStart" label="실제 시작일" :disabled="editMode && (editIsParent || editHasActual)" />
            </v-col>
            <v-col cols="3">
              <PmsDatePicker v-model="form.actualEnd" label="실제 종료일" :disabled="editMode && (editIsParent || editHasActual)" />
            </v-col>
          </v-row>

          <!-- 3. 실적 진행율 (수정 시, 리프만) -->
          <div v-if="editMode && !editIsParent">
            <v-divider class="my-2" />
            <!-- 계획 진척률 (읽기 전용) -->
            <div class="d-flex align-center mb-2">
              <span class="text-subtitle-2">계획 진척률</span>
              <v-chip size="x-small" variant="tonal" color="primary" class="ml-2">{{ form.progressRate }}%</v-chip>
            </div>
            <v-row dense align="center" class="mb-3">
              <v-col cols="9">
                <v-progress-linear :model-value="form.progressRate" color="primary" height="10" rounded />
              </v-col>
              <v-col cols="3">
                <v-text-field :model-value="form.progressRate" suffix="%" variant="outlined" density="compact" hide-details disabled />
              </v-col>
            </v-row>

            <div class="text-subtitle-2 mb-2">실적</div>
            <div v-if="editHasActual" class="text-caption text-grey mb-2">실적이 등록된 태스크입니다. 실적 변경은 실적 등록 화면에서 진행하세요.</div>
            <div v-else-if="!form.actualStart && form.actualRate > 0" class="text-caption text-error mb-2">실제 시작일을 먼저 등록해야 실적을 입력할 수 있습니다.</div>
            <v-row dense align="center">
              <v-col cols="9">
                <v-slider v-model="form.actualRate" :min="0" :max="100" :step="0.1" color="success" hide-details :disabled="editHasActual" />
              </v-col>
              <v-col cols="3">
                <v-text-field v-model.number="form.actualRate" type="number" min="0" max="100" step="0.1" suffix="%" variant="outlined" density="compact" hide-details :disabled="editHasActual" />
              </v-col>
            </v-row>
          </div>

          <!-- 4. 선후행 관계 -->
          <v-divider class="my-2" />
          <div class="d-flex align-center mb-2">
            <span class="text-subtitle-2">선후행 관계</span>
            <v-spacer />
            <v-btn v-if="!(editMode && editHasActual)" size="x-small" variant="text" color="primary" prepend-icon="mdi-plus" @click="addDep">추가</v-btn>
          </div>
          <div v-for="(dep, idx) in formDeps" :key="idx" class="d-flex align-center mb-2 ga-2">
            <v-select v-model="dep.predecessorId" :items="depPredecessorOptions" label="선행작업" variant="outlined" density="compact" hide-details style="flex:2" :disabled="editMode && editHasActual" />
            <v-select v-model="dep.depType" :items="depTypes" label="관계" variant="outlined" density="compact" hide-details style="flex:1" />
            <v-btn icon size="x-small" variant="text" color="error" @click="removeDep(idx)"><v-icon size="small">mdi-close</v-icon></v-btn>
          </div>
          <div v-if="!formDeps.length" class="text-caption text-grey mb-1">FS: 완료→시작 | SS: 동시시작 | FF: 동시완료 | SF: 시작→완료</div>

          <!-- 산출물 등록 -->
          <v-divider class="my-3" />
          <div class="d-flex align-center mb-2">
            <span class="text-subtitle-2">산출물</span>
            <v-spacer />
            <v-btn v-if="!(editMode && editHasActual)" size="x-small" variant="text" color="primary" prepend-icon="mdi-plus" @click="addDeliverable">추가</v-btn>
          </div>
          <div v-for="(d, idx) in formDeliverables" :key="idx" class="d-flex align-center mb-2 ga-2">
            <v-select
              v-model="d.docType"
              :items="projectDocTypes"
              label="산출물 유형"
              variant="outlined"
              density="compact"
              hide-details
              style="flex:1"
              no-data-text="설정에서 산출물을 정의해주세요"
              @update:model-value="onDocTypeChange(idx)"
            />
            <v-text-field
              v-model="d.docName"
              label="산출물명"
              variant="outlined"
              density="compact"
              hide-details
              style="flex:1"
            />
            <v-btn icon size="x-small" variant="text" color="error" @click="removeDeliverable(idx)">
              <v-icon size="small">mdi-close</v-icon>
            </v-btn>
          </div>
          <div v-if="!formDeliverables.length" class="text-caption text-grey mb-2">
            산출물 추가 버튼으로 이 태스크에 필요한 산출물을 등록하세요.
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="dialog = false">취소</v-btn>
          <v-btn color="primary" @click="save">저장</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 스케줄 다이얼로그 -->
    <v-dialog v-model="scheduleDialog" max-width="520">
      <v-card class="task-dialog">
        <v-card-title class="task-dialog-title">
          <v-icon start size="small">mdi-calendar-clock</v-icon> 스케줄 검증 / 산정
        </v-card-title>
        <v-card-text class="pa-4">
          <v-alert type="info" density="compact" variant="tonal" class="mb-4" style="font-size:11px">
            <div class="font-weight-bold mb-1">스케줄 기능 안내</div>
            <ul class="pl-4" style="line-height:1.6">
              <li><strong>검증</strong> — 선후행 관계가 설정된 태스크의 일정 정합성을 확인합니다. 일정은 변경되지 않습니다.</li>
              <li><strong>적용</strong> — 선후행 관계가 있는 태스크만 일정을 재산정합니다. 선후행이 없는 태스크의 일정은 유지됩니다.</li>
            </ul>
          </v-alert>

          <v-radio-group v-model="scheduleMode" density="compact" class="mb-2">
            <v-radio value="check" label="검증만 (일정 변경 없음, 불일치 항목만 표시)" />
            <v-radio value="apply" label="적용 (선후행 설정된 태스크만 일정 재산정)" />
          </v-radio-group>

          <v-alert v-if="scheduleMode === 'apply'" type="warning" density="compact" variant="tonal" style="font-size:11px">
            선후행 관계가 설정된 태스크의 변경계획 시작/종료일이 재산정됩니다.<br/>
            선후행이 없는 태스크는 기존 일정이 유지됩니다.
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="scheduleDialog = false">취소</v-btn>
          <v-btn :color="scheduleMode === 'check' ? 'primary' : 'orange'" :loading="scheduling" @click="runSchedule">
            {{ scheduleMode === 'check' ? '검증 실행' : '적용 실행' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 실적 등록 다이얼로그 (팀장/팀원용) -->
    <v-dialog v-model="actualDialog" max-width="400">
      <v-card class="actual-dialog">
        <v-card-title style="font-size:13px">
          <v-icon start size="small" color="success">mdi-clipboard-edit</v-icon>
          실적 등록
        </v-card-title>
        <v-card-text>
          <div class="actual-task-name mb-3">{{ actualTaskName }}</div>
          <v-row dense class="mb-2">
            <v-col cols="4">
              <div class="text-caption text-grey">계획 시작일</div>
              <div class="text-body-2">{{ actualPlanStart }}</div>
            </v-col>
            <v-col cols="4">
              <div class="text-caption text-grey">계획 종료일</div>
              <div class="text-body-2">{{ actualPlanEnd }}</div>
            </v-col>
            <v-col cols="4">
              <div class="text-caption text-grey">계획 진행률</div>
              <div class="d-flex align-center">
                <v-progress-linear :model-value="actualPlanProgress" color="primary" height="10" rounded style="flex:1" />
                <span class="text-body-2 font-weight-bold ml-2" style="min-width:40px">{{ actualPlanProgress }}%</span>
              </div>
            </v-col>
          </v-row>
          <v-divider class="mb-3" />

          <!-- 산출물 승인 현황 (승인 프로세스 활성 시만) -->
          <div v-if="approvalEnabled && actualDeliverables.length" class="mb-3">
            <div class="text-subtitle-2 mb-2">산출물 승인 현황</div>
            <div v-for="doc in actualDeliverables" :key="doc.docId" class="mb-3 pa-2" style="border:1px solid #e0e0e0; border-radius:4px">
              <div class="d-flex align-center mb-1">
                <span style="font-size:12px; font-weight:600">{{ doc.docName }}</span>
                <v-spacer />
                <v-chip size="x-small" :color="doc.status === '승인완료' ? 'success' : doc.status === '반려' ? 'error' : 'grey'" variant="tonal">{{ doc.status }}</v-chip>
              </div>

              <!-- 승인 타임라인 -->
              <div class="d-flex align-center ga-1 mb-2" style="font-size:10px">
                <v-chip size="x-small" :color="doc.approvalDepth >= 0 ? 'primary' : 'grey'" variant="tonal">작성</v-chip>
                <v-icon size="10" color="grey">mdi-chevron-right</v-icon>
                <template v-for="depth in Array.from({length: DEPTH_MAX}, (_, i) => i + 1)" :key="depth">
                  <v-chip
                    size="x-small"
                    :color="depthChipColor(doc, depth)"
                    variant="tonal"
                  >{{ DEPTH_LABELS[depth] }}</v-chip>
                  <v-icon v-if="depth < DEPTH_MAX" size="10" color="grey">mdi-chevron-right</v-icon>
                </template>
              </div>

              <!-- 액션 버튼 -->
              <div class="d-flex ga-1 flex-wrap">
                <template v-if="doc.status === '등록' || doc.status === '작성중'">
                  <v-chip size="x-small" color="grey" variant="tonal">작성중 — 저장 시 일괄 처리</v-chip>
                </template>
                <template v-else-if="doc.status === '반려'">
                  <div style="width:100%">
                    <v-chip size="x-small" color="error" variant="tonal" class="mb-1">
                      {{ isTaskAssignee || isPmsAdmin ? '반려됨 — 반려 사유 확인 후 조치 필요' : '반려됨' }}
                    </v-chip>
                    <div v-for="a in (doc.approvals || []).filter((a: any) => a.status === '반려' && a.comment)" :key="a.approvalId"
                      class="pa-2" style="background:#FFEBEE; border-left:3px solid #E53935; border-radius:4px; font-size:11px; margin-top:4px">
                      <div style="font-weight:600; color:#C62828">{{ DEPTH_LABELS[a.depth] }} 반려 사유</div>
                      <div style="color:#333; margin-top:2px; white-space:pre-wrap">{{ a.comment }}</div>
                    </div>
                  </div>
                </template>
                <template v-else-if="doc.approvalDepth >= DEPTH_MAX">
                  <v-chip size="x-small" color="success" variant="tonal">모든 승인 완료</v-chip>
                </template>
                <template v-else>
                  <template v-if="doc.approvals?.find((a: any) => a.depth === doc.approvalDepth + 1 && a.status === '승인요청')">
                    <v-chip size="x-small" color="orange" variant="tonal" class="mr-1">{{ DEPTH_LABELS[doc.approvalDepth + 1] }} 승인 대기중</v-chip>
                    <!-- 승인권자: 승인/반려 -->
                    <template v-if="isApproverForDoc(doc)">
                      <v-btn size="x-small" color="success" variant="tonal" @click="approveDoc(doc)" prepend-icon="mdi-check">승인</v-btn>
                      <v-btn size="x-small" color="error" variant="text" @click="rejectDoc(doc)" prepend-icon="mdi-close">반려</v-btn>
                    </template>
                    <!-- 요청자: 상태 표시만 (회수는 태스크 단위) -->
                  </template>
                  <template v-else>
                    <v-chip size="x-small" color="grey" variant="tonal">{{ DEPTH_LABELS[doc.approvalDepth + 1] || '다음' }} 대기 — 저장 시 일괄 요청</v-chip>
                  </template>
                </template>
              </div>
            </div>
            <v-divider class="mt-2" />
          </div>

          <!-- 반려 건 안내 -->
          <div v-if="needsReRequest && !actualCompleted" class="mb-3">
            <v-alert type="warning" variant="tonal" density="compact" style="font-size:11px">
              반려된 산출물이 있습니다. <b>반려 사유를 확인하고 필요한 조치</b>(산출물 수정, 관련 태스크 보완 등)<b>를 완료한 뒤 저장</b>하면 PL부터 재승인 절차가 다시 진행됩니다.
            </v-alert>
          </div>
          <!-- 승인요청 안내 (별도 버튼 없이 저장 시 자동) -->
          <div v-else-if="needsApprovalRequest && !actualCompleted" class="mb-3">
            <v-alert type="info" variant="tonal" density="compact" style="font-size:11px">
              <template v-if="hasUncompletedDocs">
                저장 시 산출물 작성완료 처리 및 PL에게 승인요청이 함께 진행됩니다.
              </template>
              <template v-else>
                저장 시 {{ DEPTH_LABELS[nextApprovalDepth] }}에게 {{ actualDeliverables.length }}건 승인요청이 함께 진행됩니다.
              </template>
            </v-alert>
          </div>

          <!-- 승인 대기 중 안내 + 일괄 회수 -->
          <v-alert v-if="actualWaitingApproval && !actualCompleted" type="info" variant="tonal" density="compact" class="mb-3" style="font-size:11px">
            <div class="d-flex align-center">
              <span>승인 대기 중입니다. 승인이 완료되면 다음 단계를 진행할 수 있습니다.</span>
              <v-spacer />
              <v-btn v-if="isRequesterForDoc(actualDeliverables[0])" size="x-small" color="grey" variant="tonal" @click="withdrawAllApprovals" prepend-icon="mdi-undo" class="ml-2">{{ actualDeliverables.length > 1 ? '일괄 회수' : '회수' }}</v-btn>
            </div>
          </v-alert>
          <!-- 완료 상태 안내 -->
          <v-alert v-if="actualCompleted" type="success" variant="tonal" density="compact" class="mb-3" style="font-size:11px">
            이 태스크의 실적 등록이 완료되었습니다. (100%)
          </v-alert>

          <!-- 실적 입력 -->
          <div style="margin-bottom:16px">
            <PmsDatePicker
              v-model="actualForm.actualStart"
              label="실제 시작일"
              :disabled="actualReadOnly || actualCompleted || actualWaitingApproval"
            />
          </div>
          <div style="margin-bottom:16px">
            <PmsDatePicker
              v-model="actualForm.actualEnd"
              label="실제 종료일"
              :disabled="actualReadOnly || actualCompleted || actualWaitingApproval || actualForm.actualRate < 100"
              :hint="!actualCompleted && actualForm.actualRate < 100 ? '실적 진행률 100% 시 입력 가능' : ''"
              persistent-hint
            />
          </div>
          <v-alert v-if="actualRateGuide && !actualCompleted" type="info" variant="tonal" density="compact" class="mb-2" style="font-size:11px">
            {{ actualRateGuide }}
          </v-alert>
          <div class="d-flex align-center mb-1">
            <span class="text-caption">실적 진행률</span>
            <v-chip v-if="approvalEnabled && !actualCompleted && actualMaxRate < 100" size="x-small" variant="tonal" color="warning" class="ml-2">상한 {{ actualMaxRate }}% (산출물 승인 필요)</v-chip>
          </div>
          <v-row align="center" dense>
            <v-col>
              <v-slider
                v-model="actualForm.actualRate"
                :max="actualCompleted ? 100 : actualMaxRate" :step="0.1"
                thumb-label
                color="success"
                hide-details
                :disabled="actualReadOnly || actualCompleted || actualWaitingApproval"
                @update:model-value="() => { if (actualForm.actualRate < 100) actualForm.actualEnd = '' }"
              />
            </v-col>
            <v-col cols="4">
              <v-text-field
                v-model.number="actualForm.actualRate"
                type="number" min="0" :max="actualCompleted ? 100 : actualMaxRate" step="0.1"
                variant="outlined" density="compact"
                suffix="%" hide-details
                style="min-width:80px"
                :disabled="actualReadOnly || actualCompleted"
                :readonly="actualReadOnly || actualCompleted"
              />
            </v-col>
          </v-row>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-4 py-3">
          <v-spacer />
          <v-btn variant="outlined" size="small" @click="actualDialog = false">{{ (actualCompleted || actualWaitingApproval || actualReadOnly) ? '닫기' : '취소' }}</v-btn>
          <v-btn v-if="!actualReadOnly && !actualCompleted && !actualWaitingApproval" color="primary" variant="flat" size="small" @click="saveActual" :loading="actualSaving" :prepend-icon="needsApprovalRequest || needsReRequest ? 'mdi-send' : 'mdi-content-save'">{{ saveButtonLabel }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 승인 대상자 선택 다이얼로그 -->
    <v-dialog v-model="approverDialog" max-width="360">
      <v-card>
        <v-card-title class="d-flex align-center py-3" style="font-size:13px">
          <v-icon start size="small" color="orange">mdi-account-check</v-icon>
          {{ approverNextRole }} 승인 대상자 선택
        </v-card-title>
        <v-divider />
        <v-card-text class="py-3">
          <div class="text-caption text-grey mb-3">승인을 요청할 {{ approverNextRole }} 담당자를 선택해주세요.</div>
          <v-list density="compact" class="pa-0">
            <v-list-item
              v-for="a in approverList" :key="a.userId"
              :active="selectedApprover === a.userId"
              @click="selectedApprover = a.userId"
              color="primary"
              rounded
              class="mb-1"
            >
              <template #prepend>
                <v-avatar size="28" :color="selectedApprover === a.userId ? 'primary' : 'grey-lighten-2'" variant="tonal">
                  <span style="font-size:11px; font-weight:600">{{ a.userName.charAt(0) }}</span>
                </v-avatar>
              </template>
              <v-list-item-title style="font-size:12px; font-weight:500">{{ a.userName }}</v-list-item-title>
              <v-list-item-subtitle style="font-size:10px">{{ a.department || '' }}</v-list-item-subtitle>
              <template #append>
                <v-icon v-if="selectedApprover === a.userId" size="16" color="primary">mdi-check-circle</v-icon>
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-4 py-2">
          <v-spacer />
          <v-btn size="small" variant="text" @click="approverDialog = false">취소</v-btn>
          <v-btn size="small" color="primary" :disabled="!selectedApprover" @click="doRequestNext(selectedApprover)" prepend-icon="mdi-send">승인요청</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 엑셀 업로드 다이얼로그 -->
    <v-dialog v-model="importDialog" max-width="520" persistent>
      <v-card class="pms-form">
        <v-card-title class="d-flex align-center py-3" style="font-size:14px; font-weight:600">
          <v-icon size="18" class="mr-2">mdi-file-upload-outline</v-icon>WBS 엑셀 업로드
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-4" style="font-size:var(--pms-font-body)">
          <!-- 업로드 방식 선택 -->
          <div class="mb-3">
            <div style="font-size:var(--pms-font-body); font-weight:600; margin-bottom:6px">업로드 방식</div>
            <v-radio-group v-model="importClear" inline hide-details density="compact" class="mt-0">
              <v-radio label="기존 데이터에 추가" :value="false" density="compact" />
              <v-radio label="전체 초기화 후 업로드" :value="true" density="compact" color="error" />
            </v-radio-group>
            <div v-if="importClear" class="mt-1" style="font-size:11px; color:var(--pms-error)">
              기존 WBS 데이터를 모두 삭제 후 업로드합니다. (산출물·선후행 포함)
            </div>
          </div>

          <v-divider class="mb-3" />

          <!-- 템플릿 다운로드 -->
          <v-btn variant="tonal" size="small" color="primary" prepend-icon="mdi-file-download-outline" class="mb-3" @click="downloadTemplate">템플릿 다운로드</v-btn>

          <!-- 파일 선택 -->
          <div class="pms-card pa-3 mb-2">
            <input type="file" accept=".xlsx,.xls" @change="onImportFileChange" style="font-size:12px" :disabled="importing" />
          </div>
          <div style="font-size:11px; color:var(--pms-text-hint)">
            * 필수 컬럼: WBS, 작업이름, 공정단계, 계획시작일, 계획종료일. 초기계획은 자동 설정됩니다.
          </div>

          <!-- Progress -->
          <div v-if="importing" class="mt-3">
            <v-progress-linear indeterminate color="primary" height="8" rounded />
            <div class="text-center mt-1" style="font-size:11px; color:var(--pms-text-secondary)">
              업로드 진행 중...
            </div>
          </div>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-4 py-2">
          <v-spacer />
          <v-btn variant="outlined" size="small" @click="importDialog = false" :disabled="importing">취소</v-btn>
          <v-btn color="primary" size="small" @click="doImport" :disabled="!importFile || importing" :loading="importing">업로드</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </MainLayout>
</template>

<style>
/* 전역: 드롭박스 메뉴 11px (다이얼로그에서 열리는 셀렉트 항목) */
.v-overlay .v-list-item-title { font-size: 11px !important; }
.v-overlay .v-list-item { min-height: 28px !important; }
/* 실적 등록 다이얼로그 태스크명 하이라이트 */
.actual-task-name {
  font-size: 13px;
  font-weight: 700;
  color: #1565C0;
  background: #E3F2FD;
  padding: 6px 12px;
  border-radius: 4px;
  border-left: 4px solid #1976d2;
}
/* 실적 등록 다이얼로그 폰트 통일 */
.actual-dialog .v-card-text { font-size: 12px !important; }
.actual-dialog .v-text-field input { font-size: 12px !important; }
.actual-dialog .v-field__input { font-size: 12px !important; }
.actual-dialog .v-label { font-size: 12px !important; }
.actual-dialog .v-field { min-height: 36px !important; }
.actual-dialog .v-messages { font-size: 10px !important; }
/* 필터 드롭박스 축소 */
.filter-select .v-field { min-height: 26px !important; height: 26px !important; }
.filter-select .v-field__input { font-size: 11px !important; padding: 0 8px !important; min-height: 26px !important; }
.filter-select .v-select__selection-text { font-size: 11px !important; }
.filter-select .v-field__append-inner .v-icon { font-size: 14px !important; }
</style>

<style scoped>
.wbs-table-card { font-size: 12px; }

.wbs-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}
.wbs-table th, .wbs-table td {
  padding: 4px 6px;
  border-bottom: 1px solid #e0e0e0;
  border-right: 1px solid #e8e8e8;
  white-space: nowrap;
  vertical-align: middle;
  font-size: 11px;
  line-height: 1.4;
}
.wbs-table th:last-child, .wbs-table td:last-child {
  border-right: none;
}
.wbs-table td.col-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wbs-table th {
  background: #f5f5f5;
  font-weight: 600;
  font-size: 11px;
  text-align: center;
  position: sticky;
  top: 0;
  z-index: 2;
  position: relative;
}
.col-resize {
  position: absolute;
  right: 0;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
}
.col-resize:hover {
  background: rgba(25, 118, 210, 0.5);
}

/* 컬럼 너비 */
.col-wbs    { text-align: left; color: #777; font-variant-numeric: tabular-nums; }
.col-name   { text-align: left !important; overflow: hidden; text-overflow: ellipsis; }
.col-xs     { text-align: center; }
.col-xxs    { text-align: center; }
.col-sm     { text-align: center; }
.col-date   { text-align: center; font-variant-numeric: tabular-nums; }
.col-prog   { }
.col-doc    { text-align: center; }
.col-act    { text-align: center; white-space: nowrap; }

/* 행 스타일 */
.wbs-table tr:hover { background: #fafafa; }
.row-root { background: #E3F2FD !important; }
.row-root td { font-weight: 700; font-size: 12px; color: #1565C0 !important; }
.row-root .dep-tag, .row-root .doc-tag { color: #1565C0; border-color: rgba(21,101,192,0.3); background: rgba(21,101,192,0.08); }
.row-parent { background: #f9f9f9; }
.row-parent td { font-weight: 500; }
.row-active-task { background: #FFF8E1 !important; }
.row-active-task > td:first-child { border-left: 4px solid #FFA000 !important; }
@keyframes highlight-flash {
  0%, 100% { background: transparent; }
  25%, 75% { background: #BBDEFB; }
}
.row-highlight { animation: highlight-flash 1.5s ease 2; background: #BBDEFB !important; }

/* 토글 아이콘 */
.toggle-icon { cursor: pointer; opacity: 0.7; }
.toggle-icon:hover { opacity: 1; }

/* 태그 */
.dep-tag {
  display: inline-block;
  padding: 1px 4px;
  margin-right: 2px;
  border: 1px solid #bdbdbd;
  border-radius: 3px;
  font-size: 9px;
  line-height: 1.3;
}
.doc-tag {
  display: inline-block;
  padding: 1px 4px;
  margin-right: 2px;
  background: #e0f2f1;
  color: #00695c;
  border-radius: 3px;
  font-size: 9px;
  line-height: 1.3;
  max-width: 70px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.doc-badge {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.doc-more {
  font-size: 9px;
  color: #999;
}

/* 헤더 그룹행 */
.wbs-header-group th {
  font-size: 10px !important;
  padding: 2px 4px !important;
  border-bottom: none !important;
  color: #666;
}
.hg-baseline { background: #E3F2FD !important; color: #1565C0 !important; }
.hg-plan { background: #FFF3E0 !important; color: #E65100 !important; }
.hg-actual { background: #E8F5E9 !important; color: #2E7D32 !important; }

.th-baseline { background: #E3F2FD !important; }
.th-plan { background: #FFF3E0 !important; }
.th-actual { background: #E8F5E9 !important; }

.td-baseline { background: #F5F9FF; color: #666; }
.td-plan { background: #FFFAF5; }
.td-actual { background: #F5FFF7; }

.delay-minus { color: #D32F2F !important; font-weight: 700; }
.delay-plus { color: #2E7D32 !important; }

.weight-warn {
  color: #E65100 !important;
  font-weight: 700 !important;
  background: #FFF3E0 !important;
}

/* 태스크 다이얼로그 */
.task-dialog { border-top: 3px solid #1565C0; }
.task-dialog-title {
  background: #F5F8FF;
  font-size: 14px !important;
  font-weight: 600;
  padding: 12px 20px !important;
  border-bottom: 1px solid #e0e0e0;
}
.task-dialog-body {
  padding: 14px 20px !important;
  font-size: 11px;
}
.task-dialog-body :deep(.v-field__input),
.task-dialog-body :deep(.v-label),
.task-dialog-body :deep(.v-select__selection-text),
.task-dialog-body :deep(.v-field__field),
.task-dialog-body :deep(.v-list-item-title),
.task-dialog-body :deep(.v-list-item),
.task-dialog-body :deep(input),
.task-dialog-body :deep(textarea),
.task-dialog-body :deep(.v-messages__message),
.task-dialog-body :deep(.v-input),
.task-dialog-body :deep(.v-slider .v-label) {
  font-size: 11px !important;
}
.task-dialog-body :deep(.v-input--density-compact .v-field) {
  min-height: 30px;
}
.task-dialog-body .text-subtitle-2 {
  font-size: 12px !important;
}

.gantt-wbs-code {
  font-size: 9px;
  color: #999;
  margin-right: 4px;
  flex-shrink: 0;
}

/* 간트차트 */
.gantt-row {
  position: relative;
  height: 30px;
  border-bottom: 1px solid #eee;
  display: flex;
  align-items: center;
}
.gantt-row:hover { background: #fafafa; }
.gantt-row-parent { background: #f5f8ff; }

.gantt-label {
  width: 220px;
  min-width: 220px;
  padding: 0 6px;
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border-right: 1px solid #ddd;
}

.gantt-bar-area {
  flex: 1;
  position: relative;
  height: 100%;
}

.gantt-bar {
  position: absolute;
  top: 5px;
  height: 20px;
  border-radius: 3px;
  min-width: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
  overflow: hidden;
}

.gantt-bar-progress {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: rgba(0,0,0,0.15);
  border-radius: 3px 0 0 3px;
}

.gantt-bar-text {
  position: relative;
  z-index: 1;
  font-size: 9px;
  color: white;
  text-shadow: 0 1px 1px rgba(0,0,0,0.3);
}

.gantt-dep-svg {
  position: absolute;
  top: 0;
  left: 220px;
  width: calc(100% - 220px);
  pointer-events: none;
  overflow: visible;
}
</style>
