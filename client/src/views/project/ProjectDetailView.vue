<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import UserTreePicker from '@/components/common/UserTreePicker.vue'
import { projectService } from '@/services/projects'
import api from '@/services/api'
import { userService } from '@/services/users'
import { milestoneService } from '@/services/milestones'
import { deliverableDefService } from '@/services/deliverableDefs'
import { useDialog } from '@/composables/useDialog'
import { useProjectTheme, THEME_PRESETS, type ThemeConfig } from '@/composables/useTheme'
import type { Project, User } from '@/types'

const { showAlert, showConfirm } = useDialog()
const { applyTheme, resetTheme, DEFAULT_THEME } = useProjectTheme()

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.id)

function goBack() {
  if (authStore.isAdmin) router.push('/projects')
  else router.push('/')
}

const project = ref<Project | null>(null)
const members = ref<any[]>([])
const risks = ref<any[]>([])
const milestones = ref<any[]>([])
const users = ref<User[]>([])
const loading = ref(false)
const tab = computed(() => (route.query.tab as string) || 'info')

// 프로젝트 역할
const myRole = ref<any>(null)
const isPmsAdmin = computed(() => myRole.value?.isPmsAdmin || false)

// 기본정보 편집
const infoEditing = ref(false)
const infoForm = ref<any>({})
const uploadFileType = ref('기타')

function toDateStr(d: any): string {
  if (!d) return ''
  if (typeof d === 'string') return d.substring(0, 10)
  if (d instanceof Date) { const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}` }
  return String(d).substring(0, 10)
}
function startInfoEdit() {
  const p = project.value as any
  infoForm.value = {
    projectName: p.projectName, clientOrg: p.clientOrg || '', status: p.status,
    projectType: p.projectType || '', contractAmount: p.contractAmount ? Number(p.contractAmount) : null,
    startDate: toDateStr(p.startDate), endDate: toDateStr(p.endDate),
    inspectionDate: toDateStr(p.inspectionDate),
    pmUserId: p.pmUserId || '', clientManager: p.clientManager || '',
    qaManager: p.qaManager || '', auditFirm: p.auditFirm || '',
    description: p.description || '', note: p.note || '',
    contractorsText: (p.contractors || []).map((c: any) => typeof c === 'string' ? c : c.name).join(', '),
    techStack: { devLang: '', os: '', was: '', dbms: '', scm: '', servers: '', ...(p.techStack || {}) },
  }
  infoEditing.value = true
}
function cancelInfoEdit() { infoEditing.value = false }
async function saveInfoEdit() {
  if (!infoForm.value.projectName || !infoForm.value.clientOrg || !infoForm.value.startDate || !infoForm.value.endDate) {
    await showAlert('프로젝트명, 발주기관, 시작일, 종료일은 필수입니다.', { color: 'error' }); return
  }
  try {
    const contractors = infoForm.value.contractorsText ? infoForm.value.contractorsText.split(',').map((s: string) => ({ name: s.trim(), type: '' })).filter((c: any) => c.name) : []
    await projectService.update(projectId, {
      projectName: infoForm.value.projectName, clientOrg: infoForm.value.clientOrg, status: infoForm.value.status,
      startDate: infoForm.value.startDate, endDate: infoForm.value.endDate,
      projectType: infoForm.value.projectType || null,
      contractAmount: infoForm.value.contractAmount || null,
      inspectionDate: infoForm.value.inspectionDate || null,
      pmUserId: infoForm.value.pmUserId || null,
      clientManager: infoForm.value.clientManager || null,
      qaManager: infoForm.value.qaManager || null,
      auditFirm: infoForm.value.auditFirm || null,
      description: infoForm.value.description || null,
      note: infoForm.value.note || null,
      contractors, techStack: infoForm.value.techStack,
    })
    infoEditing.value = false
    const r = await projectService.getDetail(projectId)
    if (r.success) project.value = r.data
    await showAlert('저장되었습니다.')
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
}
async function onProjectFileUpload(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files?.length) return
  try {
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('fileType', uploadFileType.value)
      await api.post(`/projects/${projectId}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    }
    const r = await projectService.getDetail(projectId)
    if (r.success) project.value = r.data
    await showAlert(`${files.length}개 파일이 업로드되었습니다.`)
  } catch (err: any) { showAlert(err.response?.data?.message || '업로드 실패', { color: 'error' }) }
  // input 초기화
  (e.target as HTMLInputElement).value = ''
}
async function deleteProjectFile(pfId: number) {
  if (!(await showConfirm('파일을 삭제하시겠습니까?'))) return
  try {
    await api.delete(`/projects/${projectId}/files/${pfId}`)
    const r = await projectService.getDetail(projectId)
    if (r.success) project.value = r.data
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

// 인력 관리 — 트리 + 상세 레이아웃
const memberRoles = ['PMSAdmin', 'PL', 'TM', 'QA', 'PM', 'PMO', 'Customer', 'Inspector']
const memberSearch = ref('')
const selectedMemberId = ref<number | null>(null)
const memberEditMode = ref(false)
const memberDirty = ref(false)
const memberForm = ref({ userId: '', role: '', joinDate: '', leaveDate: '', manMonth: 0 })
const memberAddMode = ref(false)
const expandedTeams = ref<Set<string>>(new Set())

// M/M 자동산정 (영업일 기준 22일/월)
function calcManMonthClient(joinDate: string, leaveDate: string): number {
  if (!joinDate || !leaveDate) return 0
  const start = new Date(joinDate)
  const end = new Date(leaveDate)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return 0
  let bizDays = 0
  const cur = new Date(start)
  while (cur <= end) {
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) bizDays++
    cur.setDate(cur.getDate() + 1)
  }
  return Math.round((bizDays / 22) * 100) / 100
}

const autoMMHint = computed(() => {
  const j = memberForm.value.joinDate
  const l = memberForm.value.leaveDate
  if (!j || !l) return '철수일을 입력하면 자동 산정됩니다 (영업일 22일 = 1M/M)'
  const auto = calcManMonthClient(j, l)
  const start = new Date(j)
  const end = new Date(l)
  let bizDays = 0
  const cur = new Date(start)
  while (cur <= end) {
    if (cur.getDay() !== 0 && cur.getDay() !== 6) bizDays++
    cur.setDate(cur.getDate() + 1)
  }
  return `자동산정: ${auto} M/M (영업일 ${bizDays}일) — 비워두면 자동 적용`
})

// 팀(부서)별 그룹핑
interface TeamGroup { team: string; members: any[] }
const teamGroups = computed<TeamGroup[]>(() => {
  const map = new Map<string, any[]>()
  for (const m of members.value) {
    const dept = m.user?.department || '(부서 미지정)'
    if (!map.has(dept)) map.set(dept, [])
    map.get(dept)!.push(m)
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([team, members]) => ({ team, members }))
})

// 검색 필터
const filteredTeamGroups = computed<TeamGroup[]>(() => {
  if (!memberSearch.value) return teamGroups.value
  const kw = memberSearch.value.toLowerCase()
  const result: TeamGroup[] = []
  for (const g of teamGroups.value) {
    const filtered = g.members.filter(m =>
      (m.user?.userName || '').toLowerCase().includes(kw) ||
      (m.user?.userId || '').toLowerCase().includes(kw) ||
      (m.role || '').toLowerCase().includes(kw)
    )
    if (filtered.length) result.push({ team: g.team, members: filtered })
  }
  return result
})

// 검색 시 자동 펼침
watch(memberSearch, (val) => {
  if (val) expandedTeams.value = new Set(filteredTeamGroups.value.map(g => g.team))
})

function toggleTeam(team: string) {
  if (expandedTeams.value.has(team)) expandedTeams.value.delete(team)
  else expandedTeams.value.add(team)
}

function expandAllTeams() {
  expandedTeams.value = new Set(teamGroups.value.map(g => g.team))
}

// 선택된 멤버 객체
const selectedMember = computed(() => {
  if (!selectedMemberId.value) return null
  return members.value.find(m => m.memberId === selectedMemberId.value) || null
})

function selectMember(m: any) {
  if (memberAddMode.value || memberDirty.value) return // 편집 중 전환 방지
  selectedMemberId.value = m.memberId
  memberEditMode.value = false
  memberAddMode.value = false
}

function getRoleColor(role: string) {
  const map: Record<string, string> = {
    PMSAdmin: 'red', PL: 'blue', TM: 'grey', QA: 'teal',
    PM: 'purple', PMO: 'indigo', Customer: 'orange', Inspector: 'brown',
  }
  return map[role] || 'grey'
}

// 위험 다이얼로그
const riskDialog = ref(false)
const riskEditMode = ref(false)
const riskEditId = ref<number | null>(null)
const riskForm = ref({ riskName: '', impactLevel: '중간', probability: '중간', mitigationPlan: '', status: '식별', ownerId: '' })

const riskLevels = ['높음', '중간', '낮음']
const riskStatuses = ['식별', '감시', '대응중', '해결', '수용']
const riskHeaders = [
  { title: '위험명', key: 'riskName' },
  { title: '영향도', key: 'impactLevel', width: '80px' },
  { title: '발생가능성', key: 'probability', width: '90px' },
  { title: '상태', key: 'status', width: '80px' },
  { title: '담당자', key: 'ownerName', width: '100px' },
  { title: '관리', key: 'actions', width: '100px', sortable: false },
]

const statusOptions = ['계획', '진행', '일시중지', '완료', '종료']

// 단계별 가중치 + 자동산정
async function calcWeights() {
  if (!(await showConfirm('태스크 가중치를 계획MD 비율로 자동 산정합니다.\n기존 가중치가 덮어씌워집니다. 계속하시겠습니까?'))) return
  try {
    const res = await projectService.update(projectId, {}) // dummy - 실제 API 호출
    const { data } = await (await import('@/services/api')).default.post(`/projects/${projectId}/wbs/calc-weights`)
    if (data.success) await showAlert(data.message)
    else showAlert(data.message || '실패', { color: 'error' })
  } catch (err: any) { showAlert(err.response?.data?.message || '가중치 산정 실패', { color: 'error' }) }
}

// 단계별 가중치
const phaseList = ['분석', '설계', '구현', '시험', '이행']
const phaseWeightsForm = ref<Record<string, number>>({ '분석': 20, '설계': 20, '구현': 40, '시험': 10, '이행': 10 })
const phaseWeightTotal = computed(() => Object.values(phaseWeightsForm.value).reduce((s, v) => s + (v || 0), 0))

async function savePhaseWeights() {
  try {
    await projectService.update(projectId, { phaseWeights: phaseWeightsForm.value })
    await showAlert('저장이 완료되었습니다.')
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
}

// ─── 산출물 승인 프로세스 설정 ───
const approvalEnabled = ref(false)
const approvalDirty = ref(false)
const approvalLocked = ref(false)  // 잠금 상태
const approvalRoleOptions = ['PL', 'QA', 'PMO', 'Customer', 'Inspector']

// 설정 메뉴
const settingsMenu = ref('dashboard')
const settingsMenuItems = [
  { key: 'dashboard', icon: 'mdi-view-dashboard', label: '대시보드' },
  { key: 'theme', icon: 'mdi-palette', label: '테마' },
  { key: 'report', icon: 'mdi-file-chart', label: '보고서' },
  { key: 'deliverable', icon: 'mdi-folder-multiple', label: '산출물' },
  { key: 'weight', icon: 'mdi-weight', label: '가중치' },
  { key: 'messenger', icon: 'mdi-chat', label: '메신저' },
]

// 메신저 동기화
const messengerSyncing = ref(false)
const messengerInfo = ref<any>(null)
async function loadMessengerInfo() {
  try {
    const res = await api.get('/messenger/info')
    if (res.data.success) messengerInfo.value = res.data.data
  } catch { messengerInfo.value = null }
}
async function syncMessengerUsers() {
  messengerSyncing.value = true
  try {
    const res = await api.post('/messenger/sync-users')
    if (res.data.success) await showAlert(res.data.message)
    else showAlert(res.data.message || '동기화 실패', { color: 'error' })
  } catch (err: any) { showAlert(err.response?.data?.message || '동기화 실패', { color: 'error' }) }
  finally { messengerSyncing.value = false }
}
async function syncMessengerProjects() {
  messengerSyncing.value = true
  try {
    const res = await api.post('/messenger/sync-projects')
    if (res.data.success) await showAlert(res.data.message)
    else showAlert(res.data.message || '동기화 실패', { color: 'error' })
  } catch (err: any) { showAlert(err.response?.data?.message || '동기화 실패', { color: 'error' }) }
  finally { messengerSyncing.value = false }
}
async function cleanupInactiveMessengerUsers() {
  if (!(await showConfirm('비활성화된 사용자의 Rocket.Chat 계정과 관련 DM 이력을 모두 삭제합니다.\n\n⚠ 되돌릴 수 없습니다. 계속하시겠습니까?', { color: 'error' }))) return
  messengerSyncing.value = true
  try {
    const res = await api.post('/messenger/cleanup-inactive')
    if (res.data.success) await showAlert(res.data.message)
    else showAlert(res.data.message || '정리 실패', { color: 'error' })
  } catch (err: any) { showAlert(err.response?.data?.message || '정리 실패', { color: 'error' }) }
  finally { messengerSyncing.value = false }
}

// 테마 설정
const themeForm = ref<ThemeConfig>({ ...DEFAULT_THEME })
const themeDirty = ref(false)
const presetList = Object.entries(THEME_PRESETS).map(([key, val]) => ({ key, ...val }))
const fontSizeOptions = [
  { title: '소 (10px 기준)', value: 'small' as const },
  { title: '중 (11px 기준, 기본)', value: 'medium' as const },
  { title: '대 (12px 기준)', value: 'large' as const },
]

function onPresetChange(key: string) {
  const p = THEME_PRESETS[key]
  if (!p) return
  themeForm.value.preset = key
  themeForm.value.primaryColor = p.primary
  themeForm.value.headerColor = p.header
  themeDirty.value = true
  applyTheme(themeForm.value) // 미리보기
}
function onThemeFieldChange() {
  themeDirty.value = true
  applyTheme(themeForm.value) // 미리보기
}
async function saveTheme() {
  try {
    await projectService.update(projectId, { themeConfig: themeForm.value })
    themeDirty.value = false
    await showAlert('테마가 저장되었습니다.')
  } catch { showAlert('테마 저장 실패', { color: 'error' }) }
}
async function resetThemeToDefault() {
  themeForm.value = { ...DEFAULT_THEME }
  themeDirty.value = true
  applyTheme(themeForm.value)
}
function loadThemeSettings() {
  const saved = (project.value as any)?.themeConfig
  if (saved && typeof saved === 'object') {
    themeForm.value = { ...DEFAULT_THEME, ...saved }
  } else {
    themeForm.value = { ...DEFAULT_THEME }
  }
  themeDirty.value = false
}

interface ApprovalStep { depth: number; role: string; label: string; threshold: number }
const approvalSteps = ref<ApprovalStep[]>([
  { depth: 0, role: 'TM', label: '산출물 작성 완료', threshold: 80 },
  { depth: 1, role: 'PL', label: 'PL 승인', threshold: 90 },
  { depth: 2, role: 'QA', label: 'QA 승인', threshold: 95 },
  { depth: 3, role: 'PMO', label: 'PMO 승인', threshold: 98 },
  { depth: 4, role: 'Customer', label: 'Customer 승인', threshold: 100 },
])

// depth 0 (작성완료)는 고정, depth 1~N은 편집 가능
const editableSteps = computed(() => approvalSteps.value.filter(s => s.depth > 0))

function addApprovalStep() {
  const maxDepth = Math.max(...approvalSteps.value.map(s => s.depth))
  if (maxDepth >= 4) return
  approvalSteps.value.push({ depth: maxDepth + 1, role: '', label: '', threshold: 100 })
  approvalDirty.value = true
}

function removeApprovalStep(idx: number) {
  const step = editableSteps.value[idx]
  approvalSteps.value = approvalSteps.value.filter(s => s.depth !== step.depth)
  // depth 재정렬
  approvalSteps.value.forEach((s, i) => { s.depth = i })
  approvalDirty.value = true
}

// approvalSteps → 저장용 변환 (approvalThresholds + approvalLine)
function stepsToSaveData() {
  const thresholds: Record<string, number> = {}
  const line: { depth: number; role: string; label: string; threshold: number }[] = []
  for (const s of approvalSteps.value) {
    if (s.depth === 0) {
      thresholds['작성완료'] = s.threshold
    } else {
      thresholds[s.label || `Depth${s.depth}`] = s.threshold
    }
    line.push({ depth: s.depth, role: s.role, label: s.label, threshold: s.threshold })
  }
  return { approvalThresholds: thresholds, approvalLine: line }
}

function loadApprovalSettings() {
  if (project.value) {
    approvalEnabled.value = (project.value as any).approvalEnabled || false
    const savedLine = (project.value as any).approvalLine
    if (savedLine && Array.isArray(savedLine) && savedLine.length > 0) {
      approvalSteps.value = savedLine.map((s: any, i: number) => ({
        depth: i, role: s.role || '', label: s.label || '', threshold: s.threshold || 100,
      }))
    } else {
      // 기존 approvalThresholds 호환
      const saved = (project.value as any).approvalThresholds
      if (saved) {
        const defaults = [
          { depth: 0, role: 'TM', label: '산출물 작성 완료', threshold: saved['작성완료'] || 80 },
          { depth: 1, role: 'PL', label: 'PL 승인', threshold: saved['PL승인'] || 90 },
          { depth: 2, role: 'QA', label: 'QA 승인', threshold: saved['QA승인'] || 95 },
          { depth: 3, role: 'PMO', label: 'PMO 승인', threshold: saved['PMO승인'] || 98 },
          { depth: 4, role: 'Customer', label: 'Customer 승인', threshold: saved['Customer승인'] || 100 },
        ]
        approvalSteps.value = defaults
      }
    }
    approvalDirty.value = false
    // 승인라인이 저장되어 있으면 잠금
    approvalLocked.value = approvalEnabled.value && approvalSteps.value.length > 1
  }
}

async function saveApprovalSettings() {
  // validation: 마지막 단계 상한은 100%
  const lastStep = approvalSteps.value[approvalSteps.value.length - 1]
  if (lastStep.threshold !== 100) {
    await showAlert('마지막 승인 단계의 실적 상한은 100%여야 합니다.', { color: 'warning' })
    return
  }
  // validation: 역할 필수
  for (const s of editableSteps.value) {
    if (!s.role) { await showAlert('모든 승인 단계에 승인 주체를 설정해주세요.', { color: 'warning' }); return }
    if (!s.label) { await showAlert('모든 승인 단계에 승인 단계명을 입력해주세요.', { color: 'warning' }); return }
  }
  try {
    const saveData = stepsToSaveData()
    await projectService.update(projectId, {
      approvalEnabled: approvalEnabled.value,
      approvalThresholds: saveData.approvalThresholds,
      approvalLine: saveData.approvalLine,
    })
    const res = await projectService.getDetail(projectId)
    if (res.success) project.value = res.data
    approvalDirty.value = false
    approvalLocked.value = approvalEnabled.value
    await showAlert('저장이 완료되었습니다.')
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
}

// ─── 단계/업무별 가중치 ───
const bizWeights = ref<any[]>([])
const bizWeightsSaved = ref<any[]>([])
const bizLocked = ref(false)
const bizForceUnlock = ref(false)
const bizDirty = ref(false)
const bizSaving = ref(false)
const bizWeightTotal = computed(() => bizWeights.value.reduce((s, b) => s + (Number(b.bizWeight) || 0), 0))

async function fetchBizWeights() {
  try {
    const { data: res } = await (await import('@/services/api')).default.get(`/projects/${projectId}/wbs/business-weights`)
    if (res.success) {
      bizLocked.value = res.data.locked
      bizForceUnlock.value = false
      const list = res.data.businesses.map((b: any) => ({
        ...b,
        phaseWeights: b.phaseWeights || { ...phaseWeightsForm.value },
      }))
      bizWeights.value = JSON.parse(JSON.stringify(list))
      bizWeightsSaved.value = JSON.parse(JSON.stringify(list))
      bizDirty.value = false
    }
  } catch {}
}

function bizLocalUpdate() { bizDirty.value = true }

function bizApplyDefaults() {
  for (const b of bizWeights.value) {
    b.phaseWeights = { ...phaseWeightsForm.value }
  }
  bizDirty.value = true
}

function bizPhaseTotal(b: any) {
  return Object.values(b.phaseWeights || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0) as number
}

async function saveBizWeights() {
  // validation
  if (Math.round(bizWeightTotal.value) !== 100) {
    await showAlert(`업무 가중치 합계가 ${bizWeightTotal.value}%입니다. 100%여야 합니다.`); return
  }
  for (const b of bizWeights.value) {
    const pt = bizPhaseTotal(b)
    if (Math.round(pt) !== 100) {
      await showAlert(`"${b.taskName}"의 단계 가중치 합계가 ${pt}%입니다. 100%여야 합니다.`); return
    }
  }
  // 단계별 가중치 validation
  if (phaseWeightTotal.value !== 100) {
    await showAlert(`기본 단계 가중치 합계가 ${phaseWeightTotal.value}%입니다. 100%여야 합니다.`); return
  }
  bizSaving.value = true
  try {
    // 단계별 가중치도 함께 저장
    await projectService.update(projectId, { phaseWeights: phaseWeightsForm.value })
    const { data: res } = await (await import('@/services/api')).default.put(`/projects/${projectId}/wbs/business-weights`, {
      businesses: bizWeights.value.map(b => ({ taskId: b.taskId, bizWeight: Number(b.bizWeight), phaseWeights: b.phaseWeights })),
      forceUnlock: bizForceUnlock.value,
    })
    if (res.success) {
      await showAlert(res.message)
      await fetchBizWeights()
    } else {
      showAlert(res.message, { color: 'error' })
    }
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
  finally { bizSaving.value = false }
}

async function cancelBizWeights() {
  if (bizDirty.value && !(await showConfirm('변경 내용을 취소하시겠습니까?'))) return
  bizWeights.value = JSON.parse(JSON.stringify(bizWeightsSaved.value))
  bizDirty.value = false
  bizForceUnlock.value = false
}

// ─── 산출물 정의 ───
const masterDeliverables = ref<any[]>([])
const projectDefs = ref<any[]>([])
const defSearch = ref('')
const selectedLeft = ref<number[]>([])
const selectedRight = ref<number[]>([])

// 프로젝트에 정의되지 않은 마스터 목록 (좌측)
const availableMasters = computed(() => {
  const definedIds = new Set(projectDefs.value.map((d: any) => d.masterId))
  let list = masterDeliverables.value.filter((m: any) => !definedIds.has(m.masterId))
  if (defSearch.value) {
    const kw = defSearch.value.toLowerCase()
    list = list.filter((m: any) => m.docCode.toLowerCase().includes(kw) || m.docName.toLowerCase().includes(kw) || m.phase.includes(kw))
  }
  return list
})

// 프로젝트에 정의된 산출물 (우측)
const definedMasters = computed(() => {
  return projectDefs.value.map((d: any) => ({ ...d.master, projDelId: d.projDelId }))
})

async function fetchDeliverableDefs() {
  try {
    const [masterRes, defRes] = await Promise.all([
      deliverableDefService.getMasters(),
      deliverableDefService.getProjectDefs(projectId),
    ])
    if (masterRes.success) masterDeliverables.value = masterRes.data
    if (defRes.success) projectDefs.value = defRes.data
  } catch {}
}

async function addToProject() {
  if (!selectedLeft.value.length) return
  try {
    await deliverableDefService.addDefs(projectId, selectedLeft.value)
    selectedLeft.value = []
    await fetchDeliverableDefs()
  } catch (err: any) { showAlert(err.response?.data?.message || '추가 실패', { color: 'error' }) }
}

async function removeFromProject() {
  if (!selectedRight.value.length) return
  try {
    await deliverableDefService.removeDefs(projectId, selectedRight.value)
    selectedRight.value = []
    await fetchDeliverableDefs()
  } catch (err: any) { showAlert(err.response?.data?.message || '제거 실패', { color: 'error' }) }
}

async function addAllMandatory() {
  const mandatoryIds = availableMasters.value.filter((m: any) => m.mandatory === '필수').map((m: any) => m.masterId)
  if (!mandatoryIds.length) { await showAlert('추가할 필수 산출물이 없습니다.'); return }
  try {
    await deliverableDefService.addDefs(projectId, mandatoryIds)
    await fetchDeliverableDefs()
  } catch (err: any) { showAlert(err.response?.data?.message || '추가 실패', { color: 'error' }) }
}

// ─── 마스터 산출물 관리 다이얼로그 ───
const masterDialog = ref(false)
const masterEditMode = ref(false)
const masterEditId = ref<number | null>(null)
const masterForm = ref({ phase: '분석', docCode: '', docName: '', mandatory: '선택', description: '', remark: '' })
const masterPhases = ['분석', '설계', '구현', '시험', '이행']

function openMasterCreate() {
  masterEditMode.value = false
  masterEditId.value = null
  masterForm.value = { phase: '분석', docCode: '', docName: '', mandatory: '선택', description: '', remark: '' }
  masterDialog.value = true
}

function openMasterEdit(m: any) {
  masterEditMode.value = true
  masterEditId.value = m.masterId
  masterForm.value = { phase: m.phase, docCode: m.docCode, docName: m.docName, mandatory: m.mandatory, description: m.description || '', remark: m.remark || '' }
  masterDialog.value = true
}

async function saveMaster() {
  try {
    if (masterEditMode.value && masterEditId.value) {
      await deliverableDefService.updateMaster(masterEditId.value, masterForm.value)
    } else {
      await deliverableDefService.createMaster(masterForm.value)
    }
    masterDialog.value = false
    await fetchDeliverableDefs()
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
}

async function deleteMaster(m: any) {
  if (!(await showConfirm(`"${m.docCode} ${m.docName}"을(를) 삭제하시겠습니까?`))) return
  try {
    await deliverableDefService.deleteMaster(m.masterId)
    await fetchDeliverableDefs()
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

// 캐치프레이즈 이미지
async function onCatchphraseUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const res = await projectService.uploadCatchphrase(projectId, file)
    if (res.success) {
      const r = await projectService.getDetail(projectId)
      if (r.success) project.value = r.data
      await showAlert('캐치프레이즈 이미지가 등록되었습니다.')
    }
  } catch (err: any) { showAlert(err.response?.data?.message || '업로드 실패', { color: 'error' }) }
}
async function removeCatchphrase() {
  if (!(await showConfirm('캐치프레이즈 이미지를 삭제하시겠습니까?'))) return
  try {
    await projectService.deleteCatchphrase(projectId)
    const r = await projectService.getDetail(projectId)
    if (r.success) project.value = r.data
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

// 마일스톤
const msDialog = ref(false)
const msEditMode = ref(false)
const msEditId = ref<number | null>(null)
const msForm = ref({ milestoneName: '', dueDate: '', milestoneType: '기타', status: '예정', description: '' })

// 마일스톤 상태 자동 판정: 완료 | 지연 | 예정
function computeMsStatus(item: any): string {
  if (item.status === '완료') return '완료'
  if (!item.dueDate) return '예정'
  const due = new Date(item.dueDate); due.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return due < today ? '지연' : '예정'
}

const msFormCompleted = computed({
  get: () => msForm.value.status === '완료',
  set: (v: boolean) => { msForm.value.status = v ? '완료' : '예정' },
})

async function toggleMsComplete(item: any) {
  const newStatus = item.status === '완료' ? '예정' : '완료'
  try {
    await milestoneService.update(projectId, item.milestoneId, { ...item, status: newStatus, dueDate: item.dueDate?.substring(0,10) })
    const res = await milestoneService.getList(projectId)
    if (res.success) milestones.value = res.data
  } catch (err: any) { showAlert(err.response?.data?.message || '처리 실패', { color: 'error' }) }
}
const msHeaders = [
  { title: '마일스톤명', key: 'milestoneName' },
  { title: '일자', key: 'dueDate', width: '110px' },
  { title: '유형', key: 'milestoneType', width: '80px' },
  { title: '상태', key: 'status', width: '80px' },
  { title: '설명', key: 'description' },
  { title: '관리', key: 'actions', width: '80px', sortable: false },
]

async function saveMilestone() {
  try {
    if (msEditMode.value && msEditId.value) {
      await milestoneService.update(projectId, msEditId.value, msForm.value)
    } else {
      await milestoneService.create(projectId, msForm.value)
    }
    msDialog.value = false
    const res = await milestoneService.getList(projectId)
    if (res.success) milestones.value = res.data
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
}

async function removeMilestone(milestoneId: number) {
  if (!(await showConfirm('마일스톤을 삭제하시겠습니까?'))) return
  try {
    await milestoneService.remove(projectId, milestoneId)
    milestones.value = milestones.value.filter((m: any) => m.milestoneId !== milestoneId)
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

async function fetchAll() {
  loading.value = true
  try {
    const [projRes, memberRes, riskRes, msRes] = await Promise.all([
      projectService.getDetail(projectId),
      projectService.getMembers(projectId),
      projectService.getRisks(projectId),
      milestoneService.getList(projectId),
    ])
    // 역할 조회는 실패해도 화면 렌더링에 영향 없도록 분리
    try {
      const roleRes = await projectService.getMyRole(projectId)
      if (roleRes.success) myRole.value = roleRes.data
    } catch { /* 역할 미조회 시 기본값 유지 */ }
    if (projRes.success) {
      project.value = projRes.data
      if ((projRes.data as any).phaseWeights) {
        phaseWeightsForm.value = { ...{ '분석': 20, '설계': 20, '구현': 40, '시험': 10, '이행': 10 }, ...(projRes.data as any).phaseWeights }
      }
    }
    if (memberRes.success) members.value = memberRes.data
    if (riskRes.success) risks.value = riskRes.data
    if (msRes.success) milestones.value = msRes.data
  } catch (err) {
    console.error('Fetch project error:', err)
  } finally {
    loading.value = false
  }
}

async function fetchUsers() {
  if (users.value.length) return
  try {
    const result = await userService.getList({ size: 100, isActive: 'true' })
    if (result.success) users.value = result.data
  } catch {}
}

// 상태 변경
async function changeStatus(newStatus: string) {
  try {
    await projectService.update(projectId, { status: newStatus })
    if (project.value) project.value.status = newStatus
  } catch (err: any) {
    showAlert(err.response?.data?.message || '상태 변경 실패', { color: 'error' })
  }
}

// ── 인력 ──
function openAddMember() {
  fetchUsers()
  memberAddMode.value = true
  memberEditMode.value = false
  selectedMemberId.value = null
  memberForm.value = { userId: '', role: '', joinDate: '', leaveDate: '', manMonth: 0 }
  memberDirty.value = false
}

function startEditMember() {
  if (!selectedMember.value) return
  const m = selectedMember.value
  memberEditMode.value = true
  memberAddMode.value = false
  memberForm.value = {
    userId: m.userId || m.user?.userId,
    role: m.role,
    joinDate: m.joinDate?.substring(0, 10) || '',
    leaveDate: m.leaveDate?.substring(0, 10) || '',
    manMonth: m.manMonth || 0,
  }
  memberDirty.value = false
}

function cancelMemberEdit() {
  memberEditMode.value = false
  memberAddMode.value = false
  memberDirty.value = false
}

async function saveMember() {
  try {
    const payload = { ...memberForm.value }
    if (!payload.manMonth) payload.manMonth = 0

    if (memberEditMode.value && selectedMemberId.value) {
      const { userId, ...rest } = payload
      await projectService.updateMember(projectId, selectedMemberId.value, rest)
    } else if (memberAddMode.value) {
      await projectService.addMember(projectId, payload)
    }
    memberEditMode.value = false
    memberAddMode.value = false
    memberDirty.value = false
    const res = await projectService.getMembers(projectId)
    if (res.success) {
      members.value = res.data
      // 추가 후 새 멤버 선택
      if (!selectedMemberId.value && res.data.length) {
        const added = res.data.find((m: any) => m.user?.userId === payload.userId)
        if (added) selectedMemberId.value = added.memberId
      }
    }
  } catch (err: any) {
    showAlert(err.response?.data?.message || '저장 실패', { color: 'error' })
  }
}

async function removeMember(memberId: number) {
  if (!(await showConfirm('해당 인력을 철수하시겠습니까?'))) return
  try {
    await projectService.removeMember(projectId, memberId)
    members.value = members.value.filter(m => m.memberId !== memberId)
    if (selectedMemberId.value === memberId) {
      selectedMemberId.value = null
      memberEditMode.value = false
    }
  } catch (err: any) {
    showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' })
  }
}

// ── 위험 ──
function openAddRisk() {
  fetchUsers()
  riskEditMode.value = false
  riskEditId.value = null
  riskForm.value = { riskName: '', impactLevel: '중간', probability: '중간', mitigationPlan: '', status: '식별', ownerId: '' }
  riskDialog.value = true
}

function openEditRisk(r: any) {
  fetchUsers()
  riskEditMode.value = true
  riskEditId.value = r.riskId
  riskForm.value = {
    riskName: r.riskName,
    impactLevel: r.impactLevel,
    probability: r.probability,
    mitigationPlan: r.mitigationPlan || '',
    status: r.status,
    ownerId: r.ownerId || '',
  }
  riskDialog.value = true
}

async function saveRisk() {
  try {
    if (riskEditMode.value && riskEditId.value) {
      await projectService.updateRisk(projectId, riskEditId.value, riskForm.value)
    } else {
      await projectService.addRisk(projectId, riskForm.value)
    }
    riskDialog.value = false
    const res = await projectService.getRisks(projectId)
    if (res.success) risks.value = res.data
  } catch (err: any) {
    showAlert(err.response?.data?.message || '저장 실패', { color: 'error' })
  }
}

async function removeRisk(riskId: number) {
  if (!(await showConfirm('해당 위험을 삭제하시겠습니까?'))) return
  try {
    await projectService.removeRisk(projectId, riskId)
    risks.value = risks.value.filter(r => r.riskId !== riskId)
  } catch (err: any) {
    showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' })
  }
}

function formatDate(d: string) {
  return d ? d.substring(0, 10) : '-'
}

function getLevelColor(level: string) {
  const c: Record<string, string> = { '높음': 'error', '중간': 'warning', '낮음': 'success' }
  return c[level] || 'grey'
}

function getStatusColor(s: string) {
  const c: Record<string, string> = { '계획': 'blue-grey', '진행': 'success', '일시중지': 'warning', '완료': 'primary', '종료': 'grey' }
  return c[s] || 'grey'
}

function getPhaseColor(phase: string) {
  const c: Record<string, string> = { '분석': 'blue', '설계': 'indigo', '구현': 'green', '시험': 'orange', '이행': 'purple' }
  return c[phase] || 'grey'
}

function getRiskStatusColor(s: string) {
  const c: Record<string, string> = { '식별': 'error', '감시': 'warning', '대응중': 'info', '해결': 'success', '수용': 'grey' }
  return c[s] || 'grey'
}

onMounted(fetchAll)
watch([tab, () => project.value], ([v]) => {
  if (v === 'settings' && project.value) { fetchDeliverableDefs(); fetchBizWeights(); loadApprovalSettings(); loadThemeSettings(); loadMessengerInfo() }
  if (v === 'members' && members.value.length) { setTimeout(() => expandAllTeams(), 50) }
}, { immediate: true })
</script>

<template>
  <MainLayout>
    <v-row class="mb-1" align="center" dense>
      <v-col cols="auto"><v-btn icon size="small" variant="text" @click="goBack"><v-icon>mdi-arrow-left</v-icon></v-btn></v-col>
      <v-col>
        <span class="pms-page-title">{{ project?.projectName || '로딩 중...' }}</span>
        <span v-if="project" class="pms-page-subtitle">{{ project.businessNo }}</span>
      </v-col>
    </v-row>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

    <!-- 탭 콘텐츠 (좌측 사이드바 메뉴로 전환) -->
    <div>
      <div v-if="tab === 'info'">
        <div v-if="project">
          <!-- 편집/조회 토글 -->
          <div class="d-flex align-center mb-2">
            <span class="pms-page-title" style="font-size:var(--pms-font-subtitle)">프로젝트 기본정보</span>
            <v-chip size="x-small" variant="tonal" :color="getStatusColor(project.status)" class="ml-2">{{ project.status }}</v-chip>
            <v-spacer />
            <template v-if="isPmsAdmin">
              <v-btn v-if="!infoEditing" size="x-small" variant="outlined" prepend-icon="mdi-pencil" @click="startInfoEdit">수정</v-btn>
              <template v-else>
                <v-btn size="x-small" variant="outlined" class="mr-1" @click="cancelInfoEdit">취소</v-btn>
                <v-btn size="x-small" color="primary" prepend-icon="mdi-content-save" @click="saveInfoEdit">저장</v-btn>
              </template>
            </template>
          </div>

          <!-- 1. 기본 정보 -->
          <div class="pms-card mb-3">
            <div class="pms-section-header"><v-icon size="14">mdi-briefcase</v-icon> 기본 정보</div>
            <div class="pa-3">
              <v-row dense>
                <v-col cols="6" md="3"><div class="info-label">사업관리번호</div><div class="info-value">{{ project.businessNo }}</div></v-col>
                <v-col cols="6" md="3">
                  <div class="info-label">프로젝트명 <span class="pms-required">*</span></div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.projectName" variant="outlined" density="compact" hide-details class="pms-form" />
                  <div v-else class="info-value">{{ project.projectName }}</div>
                </v-col>
                <v-col cols="6" md="3">
                  <div class="info-label">발주기관 <span class="pms-required">*</span></div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.clientOrg" variant="outlined" density="compact" hide-details class="pms-form" />
                  <div v-else class="info-value">{{ project.clientOrg || '-' }}</div>
                </v-col>
                <v-col cols="6" md="3">
                  <div class="info-label">프로젝트 유형</div>
                  <v-select v-if="infoEditing" v-model="infoForm.projectType" :items="['신규개발','고도화','운영','유지보수']" variant="outlined" density="compact" hide-details class="pms-form" clearable />
                  <div v-else class="info-value">{{ (project as any).projectType || '-' }}</div>
                </v-col>
              </v-row>
              <v-row dense class="mt-1">
                <v-col cols="6" md="3">
                  <div class="info-label">사업 규모 (원)</div>
                  <v-text-field v-if="infoEditing" :model-value="infoForm.contractAmount ? Number(infoForm.contractAmount).toLocaleString() : ''" @update:model-value="(v: string) => infoForm.contractAmount = v ? Number(v.replace(/,/g, '')) : null" variant="outlined" density="compact" hide-details class="pms-form" placeholder="계약 금액" />
                  <div v-else class="info-value">{{ (project as any).contractAmount ? Number((project as any).contractAmount).toLocaleString() + '원' : '-' }}</div>
                </v-col>
                <v-col cols="6" md="3">
                  <div class="info-label">프로젝트 상태</div>
                  <v-select v-if="infoEditing" v-model="infoForm.status" :items="['계획','진행','일시중지','완료','종료']" variant="outlined" density="compact" hide-details class="pms-form" />
                  <div v-else class="info-value"><v-chip :color="getStatusColor(project.status)" size="x-small" variant="tonal">{{ project.status }}</v-chip></div>
                </v-col>
                <v-col cols="6" md="6">
                  <div class="info-label">수행사</div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.contractorsText" variant="outlined" density="compact" hide-details class="pms-form" placeholder="업체명 (콤마로 구분)" />
                  <div v-else class="info-value">{{ ((project as any).contractors || []).map((c: any) => typeof c === 'string' ? c : c.name).join(', ') || '-' }}</div>
                </v-col>
              </v-row>
            </div>
          </div>

          <!-- 2. 일정 -->
          <div class="pms-card mb-3">
            <div class="pms-section-header"><v-icon size="14">mdi-calendar-range</v-icon> 일정</div>
            <div class="pa-3">
              <v-row dense>
                <v-col cols="6" md="3">
                  <div class="info-label">계약 시작일 <span class="pms-required">*</span></div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.startDate" type="date" variant="outlined" density="compact" hide-details class="pms-form" />
                  <div v-else class="info-value d-flex align-center"><v-icon size="14" color="grey" class="mr-1">mdi-calendar</v-icon>{{ formatDate(project.startDate) }}</div>
                </v-col>
                <v-col cols="6" md="3">
                  <div class="info-label">계약 종료일 <span class="pms-required">*</span></div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.endDate" type="date" variant="outlined" density="compact" hide-details class="pms-form" />
                  <div v-else class="info-value d-flex align-center"><v-icon size="14" color="grey" class="mr-1">mdi-calendar</v-icon>{{ formatDate(project.endDate) }}</div>
                </v-col>
                <v-col cols="6" md="3">
                  <div class="info-label">검수 예정일</div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.inspectionDate" type="date" variant="outlined" density="compact" hide-details class="pms-form" />
                  <div v-else class="info-value d-flex align-center"><v-icon size="14" color="grey" class="mr-1">mdi-calendar</v-icon>{{ (project as any).inspectionDate ? formatDate((project as any).inspectionDate) : '-' }}</div>
                </v-col>
              </v-row>
            </div>
          </div>

          <!-- 3. 조직·인력 -->
          <div class="pms-card mb-3">
            <div class="pms-section-header"><v-icon size="14">mdi-account-group</v-icon> 조직·인력</div>
            <div class="pa-3">
              <v-row dense>
                <v-col cols="6" md="3">
                  <div class="info-label">PM</div>
                  <UserTreePicker v-if="infoEditing" v-model="infoForm.pmUserId" :members="members" label="PM" clearable class="pms-form" hide-details />
                  <div v-else class="info-value">{{ project.pmUserName || (project as any).pm?.userName || '-' }}</div>
                </v-col>
                <v-col cols="6" md="3">
                  <div class="info-label">발주처 담당자</div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.clientManager" variant="outlined" density="compact" hide-details class="pms-form" />
                  <div v-else class="info-value">{{ (project as any).clientManager || '-' }}</div>
                </v-col>
                <v-col cols="6" md="3">
                  <div class="info-label">품질관리자(QA)</div>
                  <UserTreePicker v-if="infoEditing" v-model="infoForm.qaManager" :members="members" label="QA" clearable class="pms-form" hide-details />
                  <div v-else class="info-value">{{ (project as any).qaManager || '-' }}</div>
                </v-col>
                <v-col cols="6" md="3">
                  <div class="info-label">감리 수행사</div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.auditFirm" variant="outlined" density="compact" hide-details class="pms-form" />
                  <div v-else class="info-value">{{ (project as any).auditFirm || '-' }}</div>
                </v-col>
              </v-row>
              <div class="mt-2" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">
                투입 인력 현황: {{ members.length }}명 · 상세는 <a :href="`/projects/${projectId}/resources`" style="color:var(--pms-primary)">자원 관리</a> 참조
              </div>
            </div>
          </div>

          <!-- 4. 기술 환경 -->
          <div class="pms-card mb-3">
            <div class="pms-section-header"><v-icon size="14">mdi-server</v-icon> 기술 환경</div>
            <div class="pa-3">
              <v-row dense>
                <v-col cols="6" md="4">
                  <div class="info-label">개발 언어/프레임워크</div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.techStack.devLang" variant="outlined" density="compact" hide-details class="pms-form" placeholder="Java/Spring, Vue.js 등" />
                  <div v-else class="info-value">{{ (project as any).techStack?.devLang || '-' }}</div>
                </v-col>
                <v-col cols="6" md="4">
                  <div class="info-label">OS</div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.techStack.os" variant="outlined" density="compact" hide-details class="pms-form" placeholder="Linux, Windows 등" />
                  <div v-else class="info-value">{{ (project as any).techStack?.os || '-' }}</div>
                </v-col>
                <v-col cols="6" md="4">
                  <div class="info-label">WAS</div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.techStack.was" variant="outlined" density="compact" hide-details class="pms-form" placeholder="Tomcat, JEUS 등" />
                  <div v-else class="info-value">{{ (project as any).techStack?.was || '-' }}</div>
                </v-col>
                <v-col cols="6" md="4">
                  <div class="info-label">DBMS</div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.techStack.dbms" variant="outlined" density="compact" hide-details class="pms-form" placeholder="PostgreSQL, Oracle 등" />
                  <div v-else class="info-value">{{ (project as any).techStack?.dbms || '-' }}</div>
                </v-col>
                <v-col cols="6" md="4">
                  <div class="info-label">형상관리 도구</div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.techStack.scm" variant="outlined" density="compact" hide-details class="pms-form" placeholder="Git, SVN 등" />
                  <div v-else class="info-value">{{ (project as any).techStack?.scm || '-' }}</div>
                </v-col>
                <v-col cols="6" md="4">
                  <div class="info-label">서버 정보</div>
                  <v-text-field v-if="infoEditing" v-model="infoForm.techStack.servers" variant="outlined" density="compact" hide-details class="pms-form" placeholder="개발/검증/운영 서버" />
                  <div v-else class="info-value">{{ (project as any).techStack?.servers || '-' }}</div>
                </v-col>
              </v-row>
            </div>
          </div>

          <!-- 5. 부가 정보 -->
          <div class="pms-card mb-3">
            <div class="pms-section-header"><v-icon size="14">mdi-text-box</v-icon> 부가 정보</div>
            <div class="pa-3">
              <div class="info-label">프로젝트 개요</div>
              <v-textarea v-if="infoEditing" v-model="infoForm.description" variant="outlined" density="compact" hide-details class="pms-form mb-2" rows="3" auto-grow placeholder="사업 목적·범위 등" />
              <div v-else class="info-value mb-2" style="white-space:pre-wrap; min-height:20px">{{ project.description || '-' }}</div>

              <div class="info-label">비고</div>
              <v-textarea v-if="infoEditing" v-model="infoForm.note" variant="outlined" density="compact" hide-details class="pms-form mb-2" rows="2" auto-grow placeholder="기타 참고사항" />
              <div v-else class="info-value mb-2" style="white-space:pre-wrap; min-height:20px">{{ (project as any).note || '-' }}</div>

              <!-- 첨부파일 -->
              <div class="info-label">첨부 파일</div>
              <div v-for="f in ((project as any).projectFiles || [])" :key="f.pfId" class="d-flex align-center mb-1" style="gap:4px">
                <v-icon size="14">mdi-paperclip</v-icon>
                <a :href="f.filePath" :download="f.fileName" style="font-size:var(--pms-font-body); color:var(--pms-primary)">{{ f.fileName }}</a>
                <v-chip size="x-small" variant="tonal">{{ f.fileType }}</v-chip>
                <span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ (Number(f.fileSize) / 1024 / 1024).toFixed(1) }}MB</span>
                <v-btn v-if="isPmsAdmin" icon size="x-small" variant="text" color="error" @click="deleteProjectFile(f.pfId)"><v-icon size="12">mdi-close</v-icon></v-btn>
              </div>
              <div v-if="!((project as any).projectFiles || []).length" style="font-size:var(--pms-font-body); color:var(--pms-text-hint)">첨부파일 없음</div>
              <div v-if="isPmsAdmin" class="mt-2">
                <v-row dense align="center" style="gap:4px">
                  <v-col cols="auto">
                    <v-select v-model="uploadFileType" :items="['제안서','과업지시서','계약서','기타']" label="유형" variant="outlined" density="compact" hide-details class="pms-form" style="width:120px" />
                  </v-col>
                  <v-col cols="auto">
                    <v-btn size="x-small" variant="outlined" prepend-icon="mdi-upload" @click="($refs.projFileInput as HTMLInputElement)?.click()">파일 추가</v-btn>
                    <input ref="projFileInput" type="file" multiple hidden @change="onProjectFileUpload" />
                  </v-col>
                </v-row>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 투입인력 탭 -->
      <div v-if="tab === 'members'">
        <div class="member-layout d-flex" style="gap:0; min-height:500px; border:1px solid var(--pms-border); border-radius:var(--pms-radius); overflow:hidden">
          <!-- 좌측: 팀 트리 -->
          <div class="pms-tree-panel" style="width:280px; min-width:280px">
            <!-- 검색 + 추가 버튼 -->
            <div class="pa-2" style="border-bottom:1px solid #e0e0e0">
              <div class="d-flex align-center mb-1" style="gap:4px">
                <v-text-field
                  v-model="memberSearch"
                  placeholder="이름, 아이디, 역할 검색"
                  prepend-inner-icon="mdi-magnify"
                  variant="outlined"
                  density="compact"
                  hide-details
                  clearable
                  style="font-size:11px; flex:1"
                />
                <v-btn v-if="isPmsAdmin" icon size="small" color="primary" variant="tonal" @click="openAddMember" title="인력 투입">
                  <v-icon size="18">mdi-plus</v-icon>
                </v-btn>
              </div>
              <div class="d-flex align-center" style="gap:2px">
                <v-btn size="x-small" variant="text" density="compact" @click="expandAllTeams" style="font-size:10px">전체 펼침</v-btn>
                <v-btn size="x-small" variant="text" density="compact" @click="expandedTeams.clear()" style="font-size:10px">전체 접기</v-btn>
                <v-spacer />
                <span class="text-caption text-grey" style="font-size:10px">{{ members.length }}명</span>
              </div>
            </div>

            <!-- 트리 본체 -->
            <div style="flex:1; overflow-y:auto">
              <div v-if="!filteredTeamGroups.length" class="text-center text-grey py-8" style="font-size:12px">
                <v-icon size="32" color="grey-lighten-1">mdi-account-off</v-icon>
                <div class="mt-1">{{ memberSearch ? '검색 결과 없음' : '투입인력 없음' }}</div>
              </div>
              <div v-for="group in filteredTeamGroups" :key="group.team">
                <!-- 팀(부서) 노드 -->
                <div
                  class="pms-tree-dept d-flex align-center px-3 py-1"
                  style="cursor:pointer; user-select:none"
                  @click="toggleTeam(group.team)"
                >
                  <v-icon size="14" class="mr-1">{{ expandedTeams.has(group.team) ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
                  <v-icon size="14" class="mr-1" color="amber-darken-2">mdi-folder-account</v-icon>
                  <span style="font-size:12px; font-weight:600">{{ group.team }}</span>
                  <span class="text-grey ml-1" style="font-size:10px">({{ group.members.length }})</span>
                </div>
                <!-- 팀원 노드들 -->
                <div v-if="expandedTeams.has(group.team)">
                  <div
                    v-for="m in group.members" :key="m.memberId"
                    class="pms-tree-item d-flex align-center py-1"
                    :class="{ 'pms-tree-selected': selectedMemberId === m.memberId }"
                    style="cursor:pointer; padding-left:36px !important; padding-right:8px"
                    @click="selectMember(m)"
                  >
                    <v-icon size="13" class="mr-1" :color="selectedMemberId === m.memberId ? 'primary' : 'grey-darken-1'">mdi-account</v-icon>
                    <span class="pms-tree-name">{{ m.user?.userName || m.userId }}</span>
                    <v-chip :color="getRoleColor(m.role)" size="x-small" variant="tonal" class="ml-auto" style="font-size:9px; height:16px">{{ m.role }}</v-chip>
                  </div>
                </div>
              </div>
            </div>

            <!-- M/M 합계 -->
            <div v-if="members.length" class="pa-2" style="border-top:1px solid #e0e0e0; background:#f5f5f5">
              <div class="d-flex align-center justify-space-between">
                <span style="font-size:11px; color:#666">M/M 합계</span>
                <span style="font-size:12px; font-weight:700">{{ members.reduce((sum: number, m: any) => sum + (Number(m.manMonth) || 0), 0).toFixed(1) }} M/M</span>
              </div>
            </div>
          </div>

          <!-- 우측: 상세정보 -->
          <div class="member-detail-panel" style="flex:1; display:flex; flex-direction:column; background:#fff">
            <!-- 인력 추가 모드 -->
            <template v-if="memberAddMode">
              <div class="pa-3" style="border-bottom:1px solid #e0e0e0">
                <div class="d-flex align-center">
                  <v-icon size="18" class="mr-2" color="primary">mdi-account-plus</v-icon>
                  <span style="font-size:13px; font-weight:600">인력 투입</span>
                </div>
              </div>
              <div class="pa-4" style="flex:1; overflow-y:auto">
                <UserTreePicker
                  v-model="memberForm.userId"
                  :members="members"
                  label="사용자 *"
                  class="mb-3"
                  @update:model-value="memberDirty = true"
                />
                <v-select v-model="memberForm.role" :items="memberRoles" label="역할 *" variant="outlined" density="compact" class="mb-3" @update:model-value="memberDirty = true" />
                <v-row>
                  <v-col cols="6">
                    <v-text-field v-model="memberForm.joinDate" label="투입일 *" type="date" variant="outlined" density="compact" @update:model-value="memberDirty = true" />
                  </v-col>
                  <v-col cols="6">
                    <v-text-field v-model="memberForm.leaveDate" label="철수일" type="date" variant="outlined" density="compact" @update:model-value="memberDirty = true" />
                  </v-col>
                </v-row>
                <v-text-field
                  v-model.number="memberForm.manMonth"
                  label="M/M"
                  type="number"
                  step="0.01"
                  variant="outlined"
                  density="compact"
                  :hint="autoMMHint"
                  persistent-hint
                  @update:model-value="memberDirty = true"
                />
              </div>
              <div class="pa-3 d-flex justify-end" style="border-top:1px solid #e0e0e0; gap:8px">
                <v-btn size="small" variant="outlined" @click="cancelMemberEdit">취소</v-btn>
                <v-btn size="small" color="primary" @click="saveMember">저장</v-btn>
              </div>
            </template>

            <!-- 상세 보기/수정 모드 -->
            <template v-else-if="selectedMember">
              <div class="pa-3 d-flex align-center" style="border-bottom:1px solid #e0e0e0">
                <v-icon size="18" class="mr-2" color="primary">mdi-account-details</v-icon>
                <span style="font-size:13px; font-weight:600">{{ selectedMember.user?.userName || selectedMember.userId }}</span>
                <v-chip :color="getRoleColor(selectedMember.role)" size="x-small" variant="tonal" class="ml-2" style="font-size:10px">{{ selectedMember.role }}</v-chip>
                <v-spacer />
                <template v-if="isPmsAdmin && !memberEditMode">
                  <v-btn size="small" variant="text" color="primary" prepend-icon="mdi-pencil" @click="startEditMember" style="font-size:11px">수정</v-btn>
                  <v-btn size="small" variant="text" color="error" prepend-icon="mdi-delete" @click="removeMember(selectedMember.memberId)" style="font-size:11px">삭제</v-btn>
                </template>
              </div>

              <!-- 보기 모드 -->
              <div v-if="!memberEditMode" class="pa-4" style="flex:1; overflow-y:auto">
                <v-table density="compact" class="member-detail-table">
                  <tbody>
                    <tr><td class="font-weight-bold" width="120">이름</td><td>{{ selectedMember.user?.userName || '-' }}</td></tr>
                    <tr><td class="font-weight-bold">아이디</td><td>{{ selectedMember.user?.userId || '-' }}</td></tr>
                    <tr><td class="font-weight-bold">부서</td><td>{{ selectedMember.user?.department || '-' }}</td></tr>
                    <tr><td class="font-weight-bold">직위</td><td>{{ selectedMember.user?.position || '-' }}</td></tr>
                    <tr><td class="font-weight-bold">이메일</td><td>{{ selectedMember.user?.email || '-' }}</td></tr>
                    <tr><td class="font-weight-bold">연락처</td><td>{{ selectedMember.user?.phone || '-' }}</td></tr>
                    <tr><td class="font-weight-bold">역할</td><td><v-chip :color="getRoleColor(selectedMember.role)" size="small" variant="tonal">{{ selectedMember.role }}</v-chip></td></tr>
                    <tr><td class="font-weight-bold">투입일</td><td>{{ formatDate(selectedMember.joinDate) }}</td></tr>
                    <tr><td class="font-weight-bold">철수일</td><td>{{ formatDate(selectedMember.leaveDate) || '-' }}</td></tr>
                    <tr><td class="font-weight-bold">M/M</td><td>{{ selectedMember.manMonth }}</td></tr>
                  </tbody>
                </v-table>
              </div>

              <!-- 수정 모드 -->
              <div v-else class="pa-4" style="flex:1; overflow-y:auto">
                <v-table density="compact" class="member-detail-table">
                  <tbody>
                    <tr><td class="font-weight-bold" width="120">이름</td><td>{{ selectedMember.user?.userName || '-' }}</td></tr>
                    <tr><td class="font-weight-bold">아이디</td><td>{{ selectedMember.user?.userId || '-' }}</td></tr>
                    <tr><td class="font-weight-bold">부서</td><td>{{ selectedMember.user?.department || '-' }}</td></tr>
                  </tbody>
                </v-table>
                <div class="mt-4">
                  <v-select v-model="memberForm.role" :items="memberRoles" label="역할 *" variant="outlined" density="compact" class="mb-3" @update:model-value="memberDirty = true" />
                  <v-row>
                    <v-col cols="6">
                      <v-text-field v-model="memberForm.joinDate" label="투입일 *" type="date" variant="outlined" density="compact" @update:model-value="memberDirty = true" />
                    </v-col>
                    <v-col cols="6">
                      <v-text-field v-model="memberForm.leaveDate" label="철수일" type="date" variant="outlined" density="compact" @update:model-value="memberDirty = true" />
                    </v-col>
                  </v-row>
                  <v-text-field
                    v-model.number="memberForm.manMonth"
                    label="M/M"
                    type="number"
                    step="0.01"
                    variant="outlined"
                    density="compact"
                    :hint="autoMMHint"
                    persistent-hint
                    @update:model-value="memberDirty = true"
                  />
                </div>
              </div>
              <div v-if="memberEditMode" class="pa-3 d-flex justify-end" style="border-top:1px solid #e0e0e0; gap:8px">
                <v-btn size="small" variant="outlined" @click="cancelMemberEdit">취소</v-btn>
                <v-btn size="small" color="primary" @click="saveMember">저장</v-btn>
              </div>
            </template>

            <!-- 미선택 -->
            <template v-else>
              <div class="d-flex align-center justify-center" style="flex:1">
                <div class="text-center text-grey">
                  <v-icon size="48" color="grey-lighten-1">mdi-account-details</v-icon>
                  <div class="mt-2" style="font-size:13px">좌측에서 팀원을 선택하세요</div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- 위험관리 탭 -->
      <div v-if="tab === 'risks'">
        <v-row class="mb-2">
          <v-col cols="auto" class="ml-auto">
            <v-btn color="primary" size="small" prepend-icon="mdi-plus" @click="openAddRisk">위험 등록</v-btn>
          </v-col>
        </v-row>
        <v-data-table :items="risks" :headers="riskHeaders" density="comfortable" class="elevation-1" :items-per-page="50">
          <template #item.impactLevel="{ item }">
            <v-chip :color="getLevelColor(item.impactLevel)" size="small" variant="tonal">{{ item.impactLevel }}</v-chip>
          </template>
          <template #item.probability="{ item }">
            <v-chip :color="getLevelColor(item.probability)" size="small" variant="tonal">{{ item.probability }}</v-chip>
          </template>
          <template #item.status="{ item }">
            <v-chip :color="getRiskStatusColor(item.status)" size="small" variant="tonal">{{ item.status }}</v-chip>
          </template>
          <template #item.actions="{ item }">
            <v-btn icon size="x-small" variant="text" @click="openEditRisk(item)"><v-icon size="small">mdi-pencil</v-icon></v-btn>
            <v-btn icon size="x-small" variant="text" color="error" @click="removeRisk(item.riskId)"><v-icon size="small">mdi-delete</v-icon></v-btn>
          </template>
        </v-data-table>
      </div>

      <!-- 설정 탭 -->
      <div v-if="tab === 'settings'" class="settings-layout">
        <!-- 좌측 사이드바 메뉴 -->
        <div class="settings-sidebar">
          <div class="settings-sidebar-title">설정</div>
          <div v-for="item in settingsMenuItems" :key="item.key"
            class="settings-menu-item"
            :class="{ 'settings-menu-active': settingsMenu === item.key }"
            @click="settingsMenu = item.key"
          >
            <v-icon size="16" class="mr-2">{{ item.icon }}</v-icon>
            {{ item.label }}
          </div>
        </div>

        <!-- 우측 컨텐츠 -->
        <div class="settings-content">

          <!-- ═══ 대시보드 ═══ -->
          <template v-if="settingsMenu === 'dashboard'">
            <div class="settings-content-title">대시보드</div>
            <div class="settings-guide">
              <v-icon size="14" color="info" class="mr-1">mdi-information-outline</v-icon>
              <b>대시보드</b> 화면의 표시 요소를 설정합니다. 프로젝트 진입 시 가장 먼저 보이는 화면입니다.
            </div>

            <div class="settings-item">
              <div class="settings-item-label">캐치프레이즈 이미지</div>
              <div class="settings-item-desc">대시보드 상단에 표시되는 프로젝트 비전/슬로건 배너 이미지</div>
              <div class="mt-2">
                <div v-if="(project as any)?.catchphraseImage" class="mb-2">
                  <img :src="(project as any).catchphraseImage" style="max-width:100%; max-height:180px; border-radius:var(--pms-radius); border:1px solid var(--pms-border)" />
                  <div class="mt-1">
                    <v-btn size="x-small" color="error" variant="outlined" prepend-icon="mdi-delete" @click="removeCatchphrase">이미지 삭제</v-btn>
                  </div>
                </div>
                <div v-else class="mb-2" style="font-size:var(--pms-font-body); color:var(--pms-text-hint)">등록된 이미지가 없습니다.</div>
                <v-btn size="x-small" color="primary" variant="outlined" prepend-icon="mdi-upload" @click="($refs.catchphraseInput as HTMLInputElement)?.click()">이미지 업로드</v-btn>
                <input ref="catchphraseInput" type="file" accept="image/*" hidden @change="onCatchphraseUpload" />
                <div class="mt-2" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint); line-height:1.6">
                  권장: 1200×200px (6:1 비율) · 최대 10MB · JPG, PNG, GIF, WebP
                </div>
              </div>
            </div>
          </template>

          <!-- ═══ 테마 ═══ -->
          <template v-if="settingsMenu === 'theme'">
            <div class="settings-content-title d-flex align-center">
              테마
              <v-spacer />
              <v-btn v-if="themeDirty" size="x-small" variant="text" color="grey" @click="resetThemeToDefault">기본값 복원</v-btn>
              <v-btn v-if="themeDirty" size="x-small" color="primary" variant="tonal" class="ml-1" @click="saveTheme">저장</v-btn>
            </div>
            <div class="settings-guide">
              <v-icon size="14" color="info" class="mr-1">mdi-information-outline</v-icon>
              프로젝트 <b>전체 화면</b>에 적용되는 색상과 폰트 크기를 설정합니다. 변경 즉시 미리보기가 적용되며, 저장 후 모든 사용자에게 반영됩니다.
            </div>

            <div class="settings-item">
              <div class="settings-item-label">색상 프리셋</div>
              <div class="settings-item-desc">헤더, 버튼, 강조색 등 시스템 전체 색상 테마</div>
              <div class="d-flex flex-wrap mt-2" style="gap:8px">
                <div v-for="p in presetList" :key="p.key"
                  class="theme-preset-chip"
                  :class="{ 'theme-preset-active': themeForm.preset === p.key }"
                  @click="onPresetChange(p.key)"
                >
                  <span class="theme-preset-dot" :style="{ background: p.primary }"></span>
                  <span>{{ p.label }}</span>
                </div>
              </div>
            </div>

            <div class="settings-item">
              <div class="settings-item-label">커스텀 색상</div>
              <div class="settings-item-desc">프리셋과 별도로 메인/헤더 색상을 직접 지정</div>
              <v-row dense class="mt-2">
                <v-col cols="6">
                  <div style="font-size:var(--pms-font-label); color:var(--pms-text-secondary); margin-bottom:4px">메인 색상</div>
                  <div class="d-flex align-center" style="gap:8px">
                    <input type="color" v-model="themeForm.primaryColor" @input="onThemeFieldChange" style="width:32px; height:32px; border:1px solid var(--pms-border); border-radius:4px; cursor:pointer; padding:0" />
                    <span style="font-size:var(--pms-font-label); font-family:monospace">{{ themeForm.primaryColor }}</span>
                  </div>
                </v-col>
                <v-col cols="6">
                  <div style="font-size:var(--pms-font-label); color:var(--pms-text-secondary); margin-bottom:4px">헤더 색상</div>
                  <div class="d-flex align-center" style="gap:8px">
                    <input type="color" v-model="themeForm.headerColor" @input="onThemeFieldChange" style="width:32px; height:32px; border:1px solid var(--pms-border); border-radius:4px; cursor:pointer; padding:0" />
                    <span style="font-size:var(--pms-font-label); font-family:monospace">{{ themeForm.headerColor }}</span>
                  </div>
                </v-col>
              </v-row>
            </div>

            <div class="settings-item">
              <div class="settings-item-label">폰트 크기</div>
              <div class="settings-item-desc">모든 화면의 텍스트, 테이블, 라벨 크기를 일괄 조정</div>
              <v-radio-group v-model="themeForm.fontSize" inline hide-details density="compact" class="mt-1" @update:model-value="onThemeFieldChange">
                <v-radio v-for="opt in fontSizeOptions" :key="opt.value" :label="opt.title" :value="opt.value" density="compact" />
              </v-radio-group>
            </div>

            <v-alert v-if="themeDirty" type="info" variant="tonal" density="compact" class="mt-2" style="font-size:var(--pms-font-caption)">
              변경사항이 미리보기로 적용 중입니다. 저장 버튼을 눌러야 영구 반영됩니다.
            </v-alert>
          </template>

          <!-- ═══ 보고서 ═══ -->
          <template v-if="settingsMenu === 'report'">
            <div class="settings-content-title">보고서</div>
            <div class="settings-guide">
              <v-icon size="14" color="info" class="mr-1">mdi-information-outline</v-icon>
              <b>의사소통 관리</b> 화면의 주간/월간 보고서 생성 시 포함되는 항목을 설정합니다.
            </div>

            <div class="settings-item d-flex align-center">
              <div style="flex:1">
                <div class="settings-item-label">주간보고 개발진척현황 표시</div>
                <div class="settings-item-desc">ON 시 주간보고서에 개발진척현황(S-Curve 차트)이 포함됩니다. 개발진척 관리 메뉴에서 프로그램 목록을 등록한 후 사용하세요.</div>
              </div>
              <v-switch :model-value="(project as any)?.devProgressEnabled || false" density="compact" color="primary" hide-details style="flex:none"
                @update:model-value="async (v: boolean) => { await projectService.update(projectId, { devProgressEnabled: v }); const r = await projectService.getDetail(projectId); if (r.success) project = r.data }" />
            </div>
          </template>

          <!-- ═══ 산출물 ═══ -->
          <template v-if="settingsMenu === 'deliverable'">
            <div class="settings-content-title">산출물</div>
            <div class="settings-guide">
              <v-icon size="14" color="info" class="mr-1">mdi-information-outline</v-icon>
              <b>산출물 관리</b> 화면의 폴더 잠금 및 승인 워크플로를 설정합니다. 승인 프로세스 활성화 시 산출물 등록/수정에 다단계 승인이 적용됩니다.
            </div>

            <div class="settings-item">
              <div class="d-flex align-center">
                <div style="flex:1">
                  <div class="settings-item-label">승인 프로세스</div>
                  <div class="settings-item-desc">산출물 등록 시 다단계 승인 워크플로를 적용합니다. 결재라인별 역할과 진행률 상한을 설정할 수 있습니다.</div>
                </div>
                <v-switch v-model="approvalEnabled" density="compact" color="primary" hide-details style="flex:none" :disabled="approvalLocked" @update:model-value="approvalDirty = true" />
                <v-chip v-if="approvalLocked" color="error" size="x-small" variant="tonal" class="ml-2"><v-icon start size="12">mdi-lock</v-icon>잠금</v-chip>
                <v-btn v-if="approvalLocked" size="x-small" variant="text" color="error" @click="approvalLocked = false">잠금 해제</v-btn>
              </div>
            </div>

            <!-- 승인 프로세스 상세 (활성화 시) -->
            <div v-if="approvalEnabled" class="settings-item">
            <div style="font-size:var(--pms-font-caption); color:var(--pms-text-hint); margin-bottom:8px">결재라인은 2~4단계로 구성할 수 있습니다.</div>
            <table class="approval-table">
              <thead>
                <tr>
                  <th style="width:30px">#</th>
                  <th>승인 단계명</th>
                  <th style="width:110px">승인 주체</th>
                  <th style="width:70px">상한(%)</th>
                  <th style="width:30px"></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="text-grey">0</td>
                  <td style="text-align:left">산출물 작성 완료</td>
                  <td class="text-grey">팀원</td>
                  <td><input type="number" class="threshold-input" style="width:60px; text-align:right" v-model.number="approvalSteps[0].threshold" :disabled="approvalLocked" @input="approvalDirty = true" /></td>
                  <td></td>
                </tr>
                <tr v-for="(step, idx) in editableSteps" :key="step.depth">
                  <td class="text-grey">{{ step.depth }}</td>
                  <td style="text-align:left"><input class="threshold-input" style="width:100%; text-align:left" v-model="step.label" placeholder="단계명" :disabled="approvalLocked" @input="approvalDirty = true" /></td>
                  <td>
                    <select class="threshold-input" style="width:100%; text-align:left" v-model="step.role" :disabled="approvalLocked" @change="approvalDirty = true">
                      <option value="">선택</option>
                      <option v-for="r in approvalRoleOptions" :key="r" :value="r">{{ r }}</option>
                    </select>
                  </td>
                  <td><input type="number" class="threshold-input" style="width:60px; text-align:right" v-model.number="step.threshold" :disabled="approvalLocked" @input="approvalDirty = true" /></td>
                  <td>
                    <v-btn v-if="editableSteps.length > 1 && !approvalLocked" icon size="14" variant="text" color="error" density="compact" @click="removeApprovalStep(idx)"><v-icon size="12">mdi-close</v-icon></v-btn>
                  </td>
                </tr>
              </tbody>
            </table>
            <v-btn v-if="editableSteps.length < 4 && !approvalLocked" size="x-small" variant="text" color="primary" prepend-icon="mdi-plus" class="mt-1" @click="addApprovalStep">단계 추가</v-btn>
            </div>

            <!-- 승인 프로세스 저장 버튼 (ON/OFF 변경만 해도 표시) -->
            <div v-if="approvalDirty" class="d-flex justify-end mt-2" style="gap:4px">
              <v-btn size="x-small" variant="outlined" @click="loadApprovalSettings">취소</v-btn>
              <v-btn size="x-small" color="primary" @click="saveApprovalSettings">저장</v-btn>
            </div>
          </template>

          <!-- ═══ 가중치 ═══ -->
          <template v-if="settingsMenu === 'weight'">
            <div class="settings-content-title d-flex align-center">
              단계/업무별 가중치

              <v-spacer />
              <v-chip v-if="bizLocked && !bizForceUnlock" color="error" size="x-small" variant="tonal"><v-icon start size="12">mdi-lock</v-icon>잠금</v-chip>
              <v-btn v-if="bizLocked && !bizForceUnlock && isPmsAdmin" size="x-small" variant="text" color="error" @click="bizForceUnlock = true">잠금 해제</v-btn>
              <v-chip v-if="bizForceUnlock" color="warning" size="x-small" variant="tonal"><v-icon start size="12">mdi-lock-open</v-icon>잠금 해제됨</v-chip>
            </div>
            <div class="settings-guide">
              <v-icon size="14" color="info" class="mr-1">mdi-information-outline</v-icon>
              <b>공정진척 현황</b> 및 <b>대시보드</b>의 진척률 산정에 사용됩니다. WBS/일정 관리에서 등록한 depth-2 업무 단위로 가중치를 배분합니다. 업무별 가중치 합계와 각 업무의 단계별 가중치 합계가 각각 100%여야 합니다.
            </div>

          <!-- 기본 단계 가중치 (인라인) -->
          <div class="d-flex align-center flex-wrap ga-2 mb-3 pa-2" style="background:var(--pms-surface-variant, #f9f9f9); border-radius:var(--pms-radius)">
            <span style="font-size:11px; font-weight:600">단계 가중치:</span>
            <span v-for="phase in phaseList" :key="phase" class="d-flex align-center">
              <span style="font-size:10px; color:#666">{{ phase }}</span>
              <input type="number" class="weight-input ml-1" style="width:40px" v-model.number="phaseWeightsForm[phase]" @input="bizDirty = true" />
            </span>
            <span style="font-size:10px" :class="phaseWeightTotal === 100 ? 'text-success' : 'text-error'">= {{ phaseWeightTotal }}%</span>
          </div>

          <div v-if="!bizWeights.length" class="text-caption text-grey text-center pa-4">
            WBS가 등록되지 않았습니다. WBS/일정에서 태스크를 등록한 후 설정하세요.
          </div>

          <div v-else>
            <table class="biz-weight-table">
              <thead>
                <tr>
                  <th style="width:30px">WBS</th>
                  <th style="text-align:left">업무명</th>
                  <th style="width:70px">업무<br>가중치</th>
                  <th v-for="p in phaseList" :key="p" style="width:60px">{{ p }}</th>
                  <th style="width:50px">단계<br>합계</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="b in bizWeights" :key="b.taskId">
                  <td class="text-caption text-grey">{{ b.wbsCode }}</td>
                  <td>{{ b.taskName }}</td>
                  <td class="text-center">
                    <input
                      type="number" min="0" max="100" step="5"
                      class="weight-input"
                      :value="b.bizWeight"
                      :disabled="bizLocked && !bizForceUnlock"
                      @input="b.bizWeight = Number(($event.target as HTMLInputElement).value); bizLocalUpdate()"
                    />
                  </td>
                  <td v-for="p in phaseList" :key="p" class="text-center">
                    <input
                      type="number" min="0" max="100" step="5"
                      class="weight-input"
                      :value="b.phaseWeights[p] || 0"
                      :disabled="bizLocked && !bizForceUnlock"
                      @input="b.phaseWeights[p] = Number(($event.target as HTMLInputElement).value); bizLocalUpdate()"
                    />
                  </td>
                  <td class="text-center" :class="bizPhaseTotal(b) === 100 ? 'text-success' : 'text-error'" style="font-weight:600; font-size:11px">
                    {{ bizPhaseTotal(b) }}%
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td></td>
                  <td class="font-weight-bold">합계</td>
                  <td class="text-center font-weight-bold" :class="Math.round(bizWeightTotal) === 100 ? 'text-success' : 'text-error'">
                    {{ bizWeightTotal }}%
                  </td>
                  <td :colspan="phaseList.length + 1"></td>
                </tr>
              </tfoot>
            </table>

            <v-row class="mt-3" align="center">
              <v-col>
                <v-btn size="x-small" variant="text" @click="bizApplyDefaults" :disabled="bizLocked && !bizForceUnlock">기본값 적용</v-btn>
                <span class="text-caption text-grey ml-2">단계 가중치를 프로젝트 기본값으로 일괄 복원</span>
              </v-col>
              <v-col cols="auto" class="d-flex ga-2">
                <v-btn size="small" variant="text" @click="cancelBizWeights" :disabled="!bizDirty">취소</v-btn>
                <v-btn size="small" color="primary" @click="saveBizWeights" :disabled="!bizDirty" :loading="bizSaving">저장</v-btn>
              </v-col>
            </v-row>

            <v-alert v-if="bizDirty" type="warning" variant="tonal" density="compact" class="mt-2">
              <span style="font-size:var(--pms-font-body)">변경 사항이 있습니다. 저장 버튼을 눌러 확정하세요.</span>
            </v-alert>
          </div>
          </template>

          <!-- ═══ 메신저 ═══ -->
          <template v-if="settingsMenu === 'messenger'">
            <div class="settings-content-title">메신저 (Rocket.Chat)</div>
            <div class="settings-guide">
              <v-icon size="14" color="info" class="mr-1">mdi-information-outline</v-icon>
              PMS에 등록된 사용자와 프로젝트를 Rocket.Chat 메신저에 동기화합니다. 신규 등록 시 자동 동기화되며, 기존 데이터는 아래 버튼으로 일괄 동기화할 수 있습니다.
            </div>

            <!-- 연결 상태 -->
            <div class="settings-item">
              <div class="settings-item-label">연결 상태</div>
              <div class="d-flex align-center mt-2" style="gap:8px">
                <v-chip :color="messengerInfo?.available ? 'success' : 'error'" size="small" variant="tonal">
                  <v-icon start size="14">{{ messengerInfo?.available ? 'mdi-check-circle' : 'mdi-alert-circle' }}</v-icon>
                  {{ messengerInfo?.available ? '연결됨' : '연결 안 됨' }}
                </v-chip>
                <span v-if="messengerInfo?.url" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">{{ messengerInfo.url }}</span>
                <v-btn size="x-small" variant="text" color="primary" @click="loadMessengerInfo">새로고침</v-btn>
              </div>
            </div>

            <!-- 사용자 동기화 -->
            <div class="settings-item">
              <div class="settings-item-label">사용자 동기화</div>
              <div class="settings-item-desc">PMS에 등록된 활성 사용자 중 Rocket.Chat 계정이 없는 사용자를 일괄 생성합니다. 초기 비밀번호는 Pms{아이디}! 형식입니다.</div>
              <v-btn size="small" variant="tonal" color="primary" class="mt-2" prepend-icon="mdi-account-sync" :loading="messengerSyncing" :disabled="!messengerInfo?.available" @click="syncMessengerUsers">사용자 동기화</v-btn>
            </div>

            <!-- 프로젝트 채널 동기화 -->
            <div class="settings-item">
              <div class="settings-item-label">프로젝트 채널 동기화</div>
              <div class="settings-item-desc">활성 프로젝트별 전용 채널을 생성하고 투입인력을 자동 초대합니다. 채널명은 {프로젝트명}-{ID} 형식입니다.</div>
              <v-btn size="small" variant="tonal" color="primary" class="mt-2" prepend-icon="mdi-forum-plus" :loading="messengerSyncing" :disabled="!messengerInfo?.available" @click="syncMessengerProjects">프로젝트 채널 동기화</v-btn>
            </div>

            <!-- 비활성 사용자 RC 정리 -->
            <div class="settings-item">
              <div class="settings-item-label">비활성 사용자 정리</div>
              <div class="settings-item-desc">PMS에서 삭제된(비활성화된) 사용자의 Rocket.Chat 계정과 DM 이력을 일괄 삭제합니다. 채팅 이력 복원이 불가하므로 신중히 사용하세요.</div>
              <v-btn size="small" variant="tonal" color="error" class="mt-2" prepend-icon="mdi-account-remove" :loading="messengerSyncing" :disabled="!messengerInfo?.available" @click="cleanupInactiveMessengerUsers">비활성 사용자 RC 정리</v-btn>
            </div>

            <!-- 메신저 열기 -->
            <div class="settings-item">
              <div class="settings-item-label">메신저 접속</div>
              <div class="settings-item-desc">Rocket.Chat 메신저를 새 창으로 엽니다. PMS 계정과 동일한 아이디/비밀번호로 로그인하세요.</div>
              <v-btn size="small" variant="outlined" color="primary" class="mt-2" prepend-icon="mdi-open-in-new" :href="messengerInfo?.url || 'http://localhost:3200'" target="_blank">메신저 열기</v-btn>
            </div>
          </template>

        </div><!-- settings-content -->
      </div><!-- settings-layout -->

      <!-- 마일스톤 탭 -->
      <div v-if="tab === 'milestones'">
        <v-row class="mb-2">
          <v-col cols="auto" class="ml-auto">
            <v-btn color="primary" size="small" prepend-icon="mdi-plus" @click="msDialog = true; msEditMode = false; msForm = { milestoneName: '', dueDate: '', milestoneType: '기타', status: '예정', description: '' }">마일스톤 추가</v-btn>
          </v-col>
        </v-row>
        <v-data-table :items="milestones" :headers="msHeaders" density="comfortable" class="elevation-1" :items-per-page="50">
          <template #item.dueDate="{ item }">{{ formatDate(item.dueDate) }}</template>
          <template #item.milestoneType="{ item }">
            <v-chip :color="item.milestoneType === '감리' ? 'error' : item.milestoneType === '보고' ? 'info' : 'grey'" size="small" variant="tonal">{{ item.milestoneType }}</v-chip>
          </template>
          <template #item.status="{ item }">
            <v-chip :color="computeMsStatus(item) === '완료' ? 'success' : computeMsStatus(item) === '지연' ? 'error' : 'blue-grey'" size="small" variant="tonal">{{ computeMsStatus(item) }}</v-chip>
          </template>
          <template #item.actions="{ item }">
            <v-btn icon size="x-small" variant="text" :color="item.status === '완료' ? 'success' : 'grey'" @click="toggleMsComplete(item)" :title="item.status === '완료' ? '완료 해제' : '완료 처리'">
              <v-icon size="small">{{ item.status === '완료' ? 'mdi-check-circle' : 'mdi-check-circle-outline' }}</v-icon>
            </v-btn>
            <v-btn icon size="x-small" variant="text" @click="msEditMode = true; msEditId = item.milestoneId; msForm = { ...item, dueDate: item.dueDate?.substring(0,10) || '' }; msDialog = true"><v-icon size="small">mdi-pencil</v-icon></v-btn>
            <v-btn icon size="x-small" variant="text" color="error" @click="removeMilestone(item.milestoneId)"><v-icon size="small">mdi-delete</v-icon></v-btn>
          </template>
        </v-data-table>
      </div>
    </div>

    <!-- 마일스톤 다이얼로그 -->
    <v-dialog v-model="msDialog" max-width="500">
      <v-card>
        <v-card-title>{{ msEditMode ? '마일스톤 수정' : '마일스톤 추가' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="msForm.milestoneName" label="마일스톤명 *" variant="outlined" density="compact" class="mb-2" />
          <v-text-field v-model="msForm.dueDate" label="일자 *" type="date" variant="outlined" density="compact" class="mb-2" />
          <v-select v-model="msForm.milestoneType" :items="['감리', '보고', '이행', '기타']" label="유형" variant="outlined" density="compact" class="mb-2" />
          <v-checkbox v-if="msEditMode" v-model="msFormCompleted" label="완료 처리" density="compact" hide-details class="mb-2" />
          <v-text-field v-model="msForm.description" label="설명" variant="outlined" density="compact" />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn @click="msDialog = false">취소</v-btn><v-btn color="primary" @click="saveMilestone">저장</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 위험 다이얼로그 -->
    <v-dialog v-model="riskDialog" max-width="500">
      <v-card>
        <v-card-title>{{ riskEditMode ? '위험 수정' : '위험 등록' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="riskForm.riskName" label="위험명 *" variant="outlined" density="compact" class="mb-2" />
          <v-row>
            <v-col cols="6">
              <v-select v-model="riskForm.impactLevel" :items="riskLevels" label="영향도 *" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="6">
              <v-select v-model="riskForm.probability" :items="riskLevels" label="발생가능성 *" variant="outlined" density="compact" />
            </v-col>
          </v-row>
          <v-select v-model="riskForm.status" :items="riskStatuses" label="상태" variant="outlined" density="compact" class="mb-2" />
          <UserTreePicker
            v-model="riskForm.ownerId"
            :members="members"
            label="담당자"
            clearable
            class="mb-2"
          />
          <v-textarea v-model="riskForm.mitigationPlan" label="대응 계획" variant="outlined" density="compact" rows="3" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="riskDialog = false">취소</v-btn>
          <v-btn color="primary" @click="saveRisk">저장</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 마스터 산출물 추가/수정 다이얼로그 -->
    <v-dialog v-model="masterDialog" max-width="500">
      <v-card>
        <v-card-title>{{ masterEditMode ? '산출물 수정' : '산출물 추가' }}</v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="4">
              <v-select v-model="masterForm.phase" :items="masterPhases" label="단계 *" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="4">
              <v-text-field v-model="masterForm.docCode" label="코드 *" variant="outlined" density="compact" placeholder="AN-07" :disabled="masterEditMode" />
            </v-col>
            <v-col cols="4">
              <v-select v-model="masterForm.mandatory" :items="['필수', '선택']" label="필수여부" variant="outlined" density="compact" />
            </v-col>
          </v-row>
          <v-text-field v-model="masterForm.docName" label="산출물명 *" variant="outlined" density="compact" class="mb-2" />
          <v-textarea v-model="masterForm.description" label="산출물 설명" variant="outlined" density="compact" rows="3" class="mb-2" />
          <v-text-field v-model="masterForm.remark" label="비고" variant="outlined" density="compact" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="masterDialog = false">취소</v-btn>
          <v-btn color="primary" @click="saveMaster">저장</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </MainLayout>
</template>

<style scoped>
/* 기본정보 라벨/값 */
.info-label { font-size: var(--pms-font-caption); font-weight: 600; color: var(--pms-text-hint); margin-bottom: 2px; }
.info-value { font-size: var(--pms-font-body); font-weight: 500; min-height: 20px; }
/* 프로젝트 상세 전체 폰트 축소 */
:deep(.v-card-title) {
  font-size: 13px !important;
}
:deep(.v-card-text) {
  font-size: 12px !important;
}
:deep(.v-table) {
  font-size: 12px !important;
}
:deep(.v-table td),
:deep(.v-table th) {
  font-size: 12px !important;
  padding: 4px 8px !important;
}
:deep(.v-data-table) {
  font-size: 12px !important;
}
:deep(.v-data-table td),
:deep(.v-data-table th) {
  font-size: 12px !important;
  padding: 4px 8px !important;
}
:deep(.v-chip) {
  font-size: 11px !important;
}
:deep(.v-btn--size-small) {
  font-size: 11px !important;
}
:deep(.text-subtitle-1) {
  font-size: 13px !important;
}
:deep(.text-subtitle-2) {
  font-size: 12px !important;
}
:deep(.text-h5) {
  font-size: 16px !important;
}
:deep(.text-h6) {
  font-size: 14px !important;
}
:deep(.v-text-field),
:deep(.v-select),
:deep(.v-textarea) {
  font-size: 12px !important;
}
:deep(.v-text-field input),
:deep(.v-select input),
:deep(.v-textarea textarea) {
  font-size: 12px !important;
}
:deep(.v-label) {
  font-size: 12px !important;
}
:deep(.v-dialog .v-card-title) {
  font-size: 14px !important;
}
:deep(.v-dialog .v-card-text) {
  font-size: 12px !important;
}
:deep(.v-data-table-footer) {
  font-size: 11px !important;
}
:deep(.v-data-table-footer .v-select) {
  font-size: 11px !important;
}
:deep(.v-data-table-footer .v-field__input) {
  font-size: 11px !important;
  min-height: 28px !important;
  padding: 2px 8px !important;
}
/* 업무별 가중치 테이블 */
.biz-weight-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.biz-weight-table th {
  background: #f5f5f5;
  border-bottom: 2px solid #ccc;
  padding: 5px 6px;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
}
.biz-weight-table td {
  border-bottom: 1px solid #eee;
  padding: 3px 5px;
  font-size: 11px;
  vertical-align: middle;
}
.biz-weight-table tfoot td {
  border-top: 2px solid #ccc;
  padding: 5px;
  font-size: 11px;
}
.approval-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.approval-table th {
  background: #f5f5f5;
  border-bottom: 2px solid #ddd;
  padding: 4px 6px;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
}
.approval-table td {
  border-bottom: 1px solid #eee;
  padding: 3px 6px;
  font-size: 11px;
  vertical-align: middle;
  text-align: left;
}
.approval-table td:first-child { text-align: center; }
.threshold-input {
  border: 1px solid #e0e0e0;
  border-radius: 3px;
  font-size: 11px;
  padding: 2px 6px;
  outline: none;
}
.threshold-input:focus { border-color: #1976d2; }
.weight-input {
  width: 48px;
  border: 1px solid #e0e0e0;
  border-radius: 3px;
  font-size: 11px;
  padding: 2px 4px;
  text-align: right !important;
  outline: none;
  background: #fff;
}
.weight-input:focus {
  border-color: #1976d2;
  background: #f8f9ff;
}
.weight-input:disabled {
  background: #f5f5f5;
  color: #999;
}
/* 투입인력 — 글로벌 pms-tree-* 클래스는 design-system.css에서 제공 */
.member-detail-table :deep(td) {
  font-size: var(--pms-font-body) !important;
  padding: 6px 12px !important;
}

/* ── 설정 레이아웃 ── */
.settings-layout {
  display: flex; gap: 0; min-height: 500px;
  border: 1px solid var(--pms-border); border-radius: var(--pms-radius);
  overflow: hidden; background: var(--pms-surface);
}
.settings-sidebar {
  width: 180px; flex-shrink: 0;
  background: var(--pms-surface-variant); border-right: 1px solid var(--pms-border);
  padding: 8px 0;
}
.settings-sidebar-title {
  padding: 10px 16px; font-size: var(--pms-font-subtitle); font-weight: 700;
  color: var(--pms-text-primary); margin-bottom: 4px;
}
.settings-menu-item {
  display: flex; align-items: center;
  padding: 8px 16px; font-size: var(--pms-font-body);
  color: var(--pms-text-secondary); cursor: pointer; transition: all 0.15s;
}
.settings-menu-item:hover { background: rgba(0,0,0,0.04); color: var(--pms-text-primary); }
.settings-menu-active {
  background: var(--pms-surface) !important; color: var(--pms-primary) !important;
  font-weight: 600; border-left: 3px solid var(--pms-primary); padding-left: 13px;
}
.settings-content {
  flex: 1; padding: 16px 24px; overflow-y: auto;
}
.settings-content-title {
  font-size: var(--pms-font-title); font-weight: 700;
  color: var(--pms-text-primary); margin-bottom: 16px;
  padding-bottom: 8px; border-bottom: 1px solid var(--pms-border-light);
}
.settings-item {
  padding: 12px 0; border-bottom: 1px solid var(--pms-border-light);
}
.settings-item:last-child { border-bottom: none; }
.settings-item-label {
  font-size: var(--pms-font-body); font-weight: 600; color: var(--pms-text-primary);
}
.settings-item-desc {
  font-size: var(--pms-font-caption); color: var(--pms-text-hint); margin-top: 2px; line-height: 1.5;
}
.settings-guide {
  display: flex; align-items: flex-start; gap: 2px;
  padding: 8px 12px; margin-bottom: 12px;
  background: var(--pms-info-light, #E1F5FE); border-radius: var(--pms-radius);
  font-size: var(--pms-font-caption); color: var(--pms-text-secondary); line-height: 1.6;
}

/* 테마 프리셋 칩 */
.theme-preset-chip {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 20px;
  border: 1px solid var(--pms-border);
  font-size: var(--pms-font-label); font-weight: 500;
  cursor: pointer; transition: all 0.15s;
  background: var(--pms-surface);
}
.theme-preset-chip:hover { border-color: var(--pms-primary); background: var(--pms-primary-light); }
.theme-preset-active { border-color: var(--pms-primary); background: var(--pms-primary-light); font-weight: 600; }
.theme-preset-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
</style>
