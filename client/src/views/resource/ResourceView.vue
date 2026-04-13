<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import UserTreePicker from '@/components/common/UserTreePicker.vue'
import PmsDatePicker from '@/components/common/PmsDatePicker.vue'
import { projectService } from '@/services/projects'
import { userService } from '@/services/users'
import { meetingRoomService } from '@/services/meetingRooms'
import { useDialog } from '@/composables/useDialog'
import api from '@/services/api'

const { showAlert, showConfirm } = useDialog()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)

const project = ref<any>(null)
const myRole = ref<any>(null)
const isPmsAdmin = computed(() => myRole.value?.isPmsAdmin || false)
const activeTab = ref((route.query.tab as string) || 'members')
watch(() => route.query.tab, (v) => { if (v && typeof v === 'string') activeTab.value = v })

// ── 투입인력 ──
const members = ref<any[]>([])
const memberSearch = ref('')

const ROLE_LABELS: Record<string, string> = {
  PM: 'Project Manager', PL: 'Team Leader', TM: 'Team Member',
  QA: 'Quality Assurance', Customer: 'Customer', PMO: 'Project Management Office',
  Inspector: 'Inspector', PMSAdmin: 'PMS Admin',
  TA: 'Technical Architect', AA: 'Application Architect',
  DBA: 'DataBase Architect', DA: 'Data Architect',
}
const ROLE_SHORT: Record<string, string> = {
  PM: 'PM', PL: 'PL', TM: 'TM', QA: 'QA', Customer: 'Customer', PMO: 'PMO',
  Inspector: 'Inspector', PMSAdmin: 'Admin', TA: 'TA', AA: 'AA', DBA: 'DBA', DA: 'DA',
}

// 중요 역할 플래그 (PM, PL, QA)
const KEY_ROLES = new Set(['PM', 'PL', 'QA', 'PMSAdmin'])
function isKeyRole(role: string): boolean {
  return KEY_ROLES.has(role)
}
function roleColor(role: string): string {
  const c: Record<string, string> = {
    PMSAdmin: 'red', PM: 'deep-purple', PL: 'indigo', QA: 'orange',
    TM: 'blue-grey', PMO: 'teal', Customer: 'brown', Inspector: 'pink',
  }
  return c[role] || 'grey'
}

const filteredMembers = computed(() => {
  if (!memberSearch.value) return members.value
  const kw = memberSearch.value.toLowerCase()
  return members.value.filter((m: any) =>
    (m.user?.userId || m.userId || '').toLowerCase().includes(kw) ||
    (m.user?.userName || '').toLowerCase().includes(kw) ||
    (m.user?.department || '').toLowerCase().includes(kw) ||
    (m.role || '').toLowerCase().includes(kw)
  )
})

// 인력 등록/수정
const memberDialog = ref(false)
const memberEditMode = ref(false)
const memberEditId = ref<number | null>(null)
const memberForm = ref<any>({ userId: '', role: 'TM', joinDate: '', leaveDate: '', manMonth: 0 })
const allUsers = ref<any[]>([])
const selectedMember = ref<any>(null)

const ROLE_OPTIONS = [
  { title: 'PM (Project Manager)', value: 'PM' },
  { title: 'PL (Team Leader)', value: 'PL' },
  { title: 'TM (Team Member)', value: 'TM' },
  { title: 'QA (Quality Assurance)', value: 'QA' },
  { title: 'TA (Technical Architect)', value: 'TA' },
  { title: 'AA (Application Architect)', value: 'AA' },
  { title: 'DBA (DataBase Architect)', value: 'DBA' },
  { title: 'DA (Data Architect)', value: 'DA' },
  { title: 'PMO (Project Management Office)', value: 'PMO' },
  { title: 'Customer', value: 'Customer' },
  { title: 'Inspector', value: 'Inspector' },
  { title: 'PMSAdmin (PMS Admin)', value: 'PMSAdmin' },
]

const memberIdCheck = ref<'' | 'ok' | 'taken'>('')
const memberOrigRole = ref('')

async function checkMemberId() {
  if (!memberForm.value.userId || !/^[a-zA-Z0-9]{4,20}$/.test(memberForm.value.userId)) {
    await showAlert('아이디는 영문+숫자 4~20자로 입력해주세요.', { color: 'error' }); return
  }
  try {
    const res = await api.post('/auth/check-id', { userId: memberForm.value.userId })
    memberIdCheck.value = res.data.data.available ? 'ok' : 'taken'
  } catch { memberIdCheck.value = '' }
}

function openMemberCreate() {
  memberEditMode.value = false; memberEditId.value = null; memberIdCheck.value = ''
  memberForm.value = { userId: '', userName: '', role: 'TM', department: '', position: '', phone: '', joinDate: new Date().toISOString().substring(0, 10), leaveDate: '', manMonth: 0, address: '', photoFile: null, photoPreview: '', photoDeleted: false }
  memberDialog.value = true
}

function openMemberEdit(m: any) {
  memberEditMode.value = true; memberEditId.value = m.memberId
  selectedMember.value = m
  memberOrigRole.value = m.role
  memberForm.value = {
    userId: m.userId,
    userName: m.user?.userName || m.userName || '',
    role: m.role,
    department: m.user?.department || '',
    position: m.user?.position || '',
    phone: m.user?.phone || '',
    joinDate: m.joinDate?.substring(0, 10) || '',
    leaveDate: m.leaveDate?.substring(0, 10) || '',
    manMonth: Number(m.manMonth) || 0,
    address: m.user?.address || '',
    photoFile: null,
    photoPreview: photoUrl(m.user?.photoPath),
    photoDeleted: false,
  }
  memberDialog.value = true
}

function onPhotoChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  memberForm.value.photoFile = file
  memberForm.value.photoPreview = URL.createObjectURL(file)
}

async function saveMember() {
  const f = memberForm.value
  if (!f.userId) { await showAlert('사용자ID는 필수입니다.', { color: 'error' }); return }
  if (!f.role) { await showAlert('역할은 필수입니다.', { color: 'error' }); return }
  if (!f.joinDate) { await showAlert('투입일은 필수입니다.', { color: 'error' }); return }

  // 역할 변경 시 권한 상실 경고
  if (memberEditMode.value && memberOrigRole.value && memberOrigRole.value !== f.role) {
    const PRIVILEGED = ['PMSAdmin', 'PL']
    const ROLE_KR: Record<string, string> = {
      PMSAdmin: 'PMS관리자', PL: '팀장', TM: '팀원', QA: 'QA',
      PM: 'PM', PMO: 'PMO', Customer: '고객', Inspector: '감리',
      TA: 'TA', AA: 'AA', DBA: 'DBA', DA: 'DA',
    }
    const fromLabel = ROLE_KR[memberOrigRole.value] || memberOrigRole.value
    const toLabel = ROLE_KR[f.role] || f.role
    let warnMsg = `역할을 "${fromLabel}" → "${toLabel}"(으)로 변경합니다.\n`
    if (PRIVILEGED.includes(memberOrigRole.value)) {
      warnMsg += `\n⚠ 기존 "${fromLabel}" 역할의 관리 권한이 상실됩니다.`
    }
    warnMsg += '\n계속하시겠습니까?'
    if (!(await showConfirm(warnMsg, { title: '역할 변경 확인' }))) return
  }

  try {
    if (memberEditMode.value && memberEditId.value) {
      // 수정: 사용자 정보 업데이트 + 멤버 업데이트
      await userService.update(f.userId, {
        department: f.department || undefined,
        position: f.position || undefined,
        phone: f.phone || undefined,
        address: f.address || undefined,
      })
      if (f.photoFile) { await userService.uploadPhoto(f.userId, f.photoFile) }
      else if (f.photoDeleted) { await userService.update(f.userId, { photoPath: null }) }
      await projectService.updateMember(projectId, memberEditId.value, f)
    } else {
      // 신규: 사용자 생성(회원가입 우회) + 프로젝트 멤버 등록
      if (!f.userName) { await showAlert('사용자명은 필수입니다.', { color: 'error' }); return }
      if (memberIdCheck.value !== 'ok') { await showAlert('아이디 중복 확인을 해주세요.', { color: 'error' }); return }
      // 사용자 생성 (초기 비밀번호 = Pms + userId + !)
      const initPassword = `Pms${f.userId}!`
      try {
        await api.post('/auth/register-direct', {
          userId: f.userId, password: initPassword, userName: f.userName,
          department: f.department, position: f.position, phone: f.phone,
          projectId, role: f.role, joinDate: f.joinDate, leaveDate: f.leaveDate,
        })
      } catch (err: any) {
        showAlert(err.response?.data?.message || '사용자 생성 실패', { color: 'error' }); return
      }
      // 사진 업로드
      if (f.photoFile) { try { await userService.uploadPhoto(f.userId, f.photoFile) } catch {} }
      await showAlert(`등록되었습니다.\n초기 비밀번호: ${initPassword}\n(첫 로그인 시 변경됩니다)`)
    }
    memberDialog.value = false; await fetchMembers()
    // allUsers 갱신
    try { const uRes = await userService.getList({ size: 200 }); if (uRes.success) allUsers.value = uRes.data } catch {}
  } catch (err: any) { showAlert(err?.response?.data?.message || '저장 실패', { color: 'error' }) }
}

async function approveMember(m: any) {
  if (!(await showConfirm(`"${m.user?.userName}" (${m.user?.userId})의 회원가입을 승인하시겠습니까?`))) return
  try {
    await api.put(`/users/${m.user?.userId || m.userId}`, { isActive: true })
    await fetchMembers()
    await showAlert(`${m.user?.userName}의 가입이 승인되었습니다.`)
  } catch (err: any) { showAlert(err?.response?.data?.message || '승인 실패', { color: 'error' }) }
}

async function deleteMember(m: any) {
  if (!(await showConfirm(`"${m.user?.userName}"을 투입인력에서 삭제하시겠습니까?`))) return
  try {
    await projectService.removeMember(projectId, m.memberId)
    await fetchMembers(); await showAlert('삭제되었습니다.')
  } catch (err: any) { showAlert(err?.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

async function onMemberUserChange(userId: string) {
  memberForm.value.userId = userId
  if (!userId) return
  // 사용자 정보에서 소속팀/직위/연락처 자동 채움
  try {
    const res = await userService.getList({ keyword: userId, size: 1 })
    const u = res?.data?.[0]
    if (u) {
      if (!memberForm.value.department) memberForm.value.department = u.department || ''
      if (!memberForm.value.position) memberForm.value.position = u.position || ''
      if (!memberForm.value.phone) memberForm.value.phone = u.phone || ''
      if (!memberForm.value.address) memberForm.value.address = u.address || ''
    }
  } catch {}
}

// 엑셀 다운로드
async function exportMembersExcel() {
  try { await projectService.exportMembersExcel(projectId) }
  catch { showAlert('엑셀 다운로드 실패', { color: 'error' }) }
}

// 상세보기
const detailDialog = ref(false)
const detailMember = ref<any>(null)

function openMemberDetail(m: any) {
  detailMember.value = m
  detailDialog.value = true
}

// 비상연락망
const showEmergencyOnly = ref(false)
const emergencyMembers = computed(() => members.value.filter((m: any) => m.isEmergency))
// 정렬
const sortKey = ref('')
const sortAsc = ref(true)
function toggleSort(key: string) {
  if (sortKey.value === key) { sortAsc.value = !sortAsc.value }
  else { sortKey.value = key; sortAsc.value = true }
}
function sortIcon(key: string) {
  if (sortKey.value !== key) return 'mdi-unfold-more-horizontal'
  return sortAsc.value ? 'mdi-chevron-up' : 'mdi-chevron-down'
}
// 역할별 기본 정렬 순위 (낮을수록 먼저)
const ROLE_RANK: Record<string, number> = {
  PMSAdmin: 0, PM: 1, PL: 2, QA: 3, PMO: 4, TM: 5,
  Customer: 6, Inspector: 7, TA: 8, AA: 9, DBA: 10, DA: 11,
}
function roleRank(role: string): number {
  return ROLE_RANK[role] ?? 99
}

const sortedMembers = computed(() => {
  const list = showEmergencyOnly.value ? emergencyMembers.value : filteredMembers.value
  // 정렬 키가 없으면 기본 정렬: 역할 우선순위 → 이름
  if (!sortKey.value) {
    return [...list].sort((a, b) => {
      const r = roleRank(a.role) - roleRank(b.role)
      if (r !== 0) return r
      return (a.user?.userName || '').localeCompare(b.user?.userName || '', 'ko')
    })
  }
  const dir = sortAsc.value ? 1 : -1
  return [...list].sort((a, b) => {
    let va: any, vb: any
    switch (sortKey.value) {
      case 'userId': va = a.user?.userId || a.userId || ''; vb = b.user?.userId || b.userId || ''; break
      case 'userName': va = a.user?.userName || ''; vb = b.user?.userName || ''; break
      case 'department': va = a.user?.department || ''; vb = b.user?.department || ''; break
      case 'position': va = a.user?.position || ''; vb = b.user?.position || ''; break
      case 'role': return (roleRank(a.role) - roleRank(b.role)) * dir
      case 'joinDate': va = a.joinDate || ''; vb = b.joinDate || ''; break
      case 'manMonth': va = Number(a.manMonth); vb = Number(b.manMonth); return (va - vb) * dir
      default: return 0
    }
    return String(va).localeCompare(String(vb), 'ko') * dir
  })
})
// 페이지네이션 (20개씩)
const pageSize = 20
const currentPage = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(sortedMembers.value.length / pageSize)))
watch(sortedMembers, () => { currentPage.value = 1 })
watch(memberSearch, () => { currentPage.value = 1 })
const displayMembers = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return sortedMembers.value.slice(start, start + pageSize)
})

// ── 팀 관리 ──
const projectTeams = ref<any[]>([])
const teamDialog = ref(false)
const teamEditMode = ref(false)
const teamEditId = ref<number | null>(null)
const teamForm = ref({ teamName: '' })

async function fetchTeams() {
  try {
    const res = await api.get(`/projects/${projectId}/members/teams`)
    if (res.data.success) projectTeams.value = res.data.data
  } catch {}
}
function openTeamCreate() {
  teamEditMode.value = false; teamEditId.value = null
  teamForm.value = { teamName: '' }
  teamDialog.value = true
}
function openTeamEdit(t: any) {
  teamEditMode.value = true; teamEditId.value = t.teamId
  teamForm.value = { teamName: t.teamName }
  teamDialog.value = true
}
async function saveTeam() {
  if (!teamForm.value.teamName) { showAlert('팀명을 입력하세요.', { color: 'error' }); return }
  try {
    if (teamEditMode.value && teamEditId.value) {
      await api.put(`/projects/${projectId}/members/teams/${teamEditId.value}`, teamForm.value)
    } else {
      await api.post(`/projects/${projectId}/members/teams`, teamForm.value)
    }
    teamDialog.value = false; await fetchTeams()
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
}
async function deleteTeam(t: any) {
  if (!(await showConfirm(`"${t.teamName}" 팀을 삭제하시겠습니까?`))) return
  try {
    await api.delete(`/projects/${projectId}/members/teams/${t.teamId}`)
    await fetchTeams()
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

// ── 조직도 ──
const orgSearch = ref('')

// ── 드래그&드랍: 미배정 → 팀 배정 ──
const draggedMember = ref<any>(null)
const dragOverTeam = ref<string>('')

function onDragStart(m: any, e: DragEvent) {
  if (!isPmsAdmin.value) { e.preventDefault(); return }
  draggedMember.value = m
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragEnd() {
  draggedMember.value = null
  dragOverTeam.value = ''
}
function onDragOver(teamName: string, e: DragEvent) {
  if (!draggedMember.value) return
  e.preventDefault()
  dragOverTeam.value = teamName
}
function onDragLeave(teamName: string) {
  if (dragOverTeam.value === teamName) dragOverTeam.value = ''
}
async function onDrop(teamName: string) {
  if (!draggedMember.value) return
  const m = draggedMember.value
  const targetDept = teamName === '__unassigned__' ? '' : teamName
  draggedMember.value = null
  dragOverTeam.value = ''
  const currentDept = m.user?.department || ''
  if (currentDept === targetDept) return
  try {
    await userService.update(m.user?.userId || m.userId, { department: targetDept })
    await fetchMembers()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '팀 배정 실패', { color: 'error' })
  }
}
const orgTree = computed(() => {
  // reportToId 기반 트리 구성
  const map = new Map<number, any>()
  const roots: any[] = []
  for (const m of members.value) {
    map.set(m.memberId, { ...m, children: [] })
  }
  for (const m of map.values()) {
    if (m.reportToId && map.has(m.reportToId)) {
      map.get(m.reportToId).children.push(m)
    } else {
      roots.push(m)
    }
  }
  return roots
})

// ── 회의실 ──
const rooms = ref<any[]>([])
const bookings = ref<any[]>([])
const currentYear = ref(new Date().getFullYear())
const currentMonth = ref(new Date().getMonth() + 1)
const roomDialog = ref(false)
const roomForm = ref({ roomName: '', location: '', capacity: 10 })
const bookingDialog = ref(false)
const bookingForm = ref({ roomId: '', bookingDate: '', startTime: '09:00', endTime: '10:00', title: '', attendees: '', recurrenceType: '' })
const bookingEditMode = ref(false)
const bookingEditId = ref<number | null>(null)

const daysInMonth = computed(() => new Date(currentYear.value, currentMonth.value, 0).getDate())
const dayHeaders = computed(() => {
  const days = []
  for (let d = 1; d <= daysInMonth.value; d++) {
    const dt = new Date(currentYear.value, currentMonth.value - 1, d)
    const dow = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()]
    days.push({ day: d, dow, isWeekend: dt.getDay() === 0 || dt.getDay() === 6 })
  }
  return days
})

function getBookingsForRoomDay(roomId: number, day: number) {
  const dateStr = `${currentYear.value}-${String(currentMonth.value).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return bookings.value.filter((b: any) => b.roomId === roomId && b.bookingDate?.substring(0, 10) === dateStr)
}

// 데이터 로딩
async function fetchMembers() {
  try {
    const res = await projectService.getMembers(projectId)
    if (res.success) members.value = res.data
  } catch {}
}

async function fetchRooms() {
  try {
    const res = await meetingRoomService.getRooms(projectId)
    if (res.success) rooms.value = res.data
  } catch {}
}

async function fetchBookings() {
  try {
    const res = await meetingRoomService.getBookings(projectId, currentYear.value, currentMonth.value)
    if (res.success) bookings.value = res.data
  } catch {}
}

watch([currentYear, currentMonth], fetchBookings)

// 회의실 CRUD
async function saveRoom() {
  try {
    await meetingRoomService.createRoom(projectId, roomForm.value)
    roomDialog.value = false; await fetchRooms(); await showAlert('회의실이 등록되었습니다.')
  } catch (err: any) { showAlert(err?.response?.data?.message || '실패', { color: 'error' }) }
}
async function deleteRoom(roomId: number) {
  if (!(await showConfirm('회의실을 삭제하시겠습니까?'))) return
  try { await meetingRoomService.deleteRoom(projectId, roomId); await fetchRooms(); await fetchBookings() } catch {}
}

// 예약 CRUD
function openBooking(roomId?: number, day?: number) {
  bookingEditMode.value = false
  bookingEditId.value = null
  const dateStr = day ? `${currentYear.value}-${String(currentMonth.value).padStart(2, '0')}-${String(day).padStart(2, '0')}` : ''
  bookingForm.value = { roomId: roomId ? String(roomId) : '', bookingDate: dateStr, startTime: '09:00', endTime: '10:00', title: '', attendees: '', recurrenceType: '' }
  bookingDialog.value = true
}
async function saveBooking() {
  const f = bookingForm.value
  if (!f.roomId) { await showAlert('회의실을 선택해주세요.', { color: 'error' }); return }
  if (!f.bookingDate) { await showAlert('예약일을 선택해주세요.', { color: 'error' }); return }
  if (!f.startTime || !f.endTime) { await showAlert('시작/종료 시간을 입력해주세요.', { color: 'error' }); return }
  if (f.endTime <= f.startTime) { await showAlert('종료 시간은 시작 시간보다 이후여야 합니다.', { color: 'error' }); return }
  if (!f.title?.trim()) { await showAlert('회의 제목을 입력해주세요.', { color: 'error' }); return }
  try {
    if (bookingEditMode.value && bookingEditId.value) {
      await meetingRoomService.updateBooking(projectId, bookingEditId.value, bookingForm.value)
      await showAlert('예약이 수정되었습니다.')
    } else {
      const res = await meetingRoomService.createBooking(projectId, bookingForm.value)
      await showAlert(res.message || '예약되었습니다.')
    }
    bookingDialog.value = false; await fetchBookings()
  } catch (err: any) { showAlert(err?.response?.data?.message || '실패', { color: 'error' }) }
}
function openBookingEdit(b: any) {
  bookingEditMode.value = true
  bookingEditId.value = b.bookingId
  bookingForm.value = {
    roomId: String(b.roomId || b.room?.roomId || ''),
    bookingDate: b.bookingDate?.substring(0, 10) || '',
    startTime: b.startTime || '09:00',
    endTime: b.endTime || '10:00',
    title: b.title || '',
    attendees: b.attendees || '',
    recurrenceType: '',  // 수정 시 반복 설정 변경 불가
  }
  bookingDialog.value = true
}
async function deleteBooking(bookingId: number, b?: any) {
  // 반복 예약인 경우 단건/전체 선택
  if (b?.recurrenceGroupId) {
    const deleteAll = await showConfirm('반복 예약입니다.\n\n"확인": 전체 반복 예약 삭제\n"취소": 이 건만 삭제', { title: '반복 예약 삭제', color: 'warning' })
    try {
      const res = await meetingRoomService.deleteBooking(projectId, bookingId, deleteAll)
      await showAlert(res.message || '삭제되었습니다.')
      await fetchBookings()
    } catch (err: any) { showAlert(err?.response?.data?.message || '삭제 실패', { color: 'error' }) }
    return
  }
  if (!(await showConfirm('예약을 취소하시겠습니까?'))) return
  try {
    await meetingRoomService.deleteBooking(projectId, bookingId)
    await fetchBookings()
  } catch (err: any) { showAlert(err?.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

async function toggleEmergency(member: any) {
  try {
    await projectService.updateMember(projectId, member.memberId, { isEmergency: !member.isEmergency })
    await fetchMembers()
  } catch {}
}

function prevMonth() { if (currentMonth.value === 1) { currentMonth.value = 12; currentYear.value-- } else currentMonth.value-- }
function nextMonth() { if (currentMonth.value === 12) { currentMonth.value = 1; currentYear.value++ } else currentMonth.value++ }

function fmtDate(d: string) { return d ? d.substring(0, 10) : '-' }

function photoUrl(p: string | null | undefined) {
  if (!p) return ''
  const base = (api.defaults.baseURL || '').replace('/api/v1', '')
  return `${base}${p}`
}

onMounted(async () => {
  try {
    const [p, r] = await Promise.all([
      projectService.getDetail(projectId),
      projectService.getMyRole(projectId).catch(() => null),
    ])
    if (p.success) project.value = p.data
    if (r?.success) myRole.value = r.data
  } catch {}
  await fetchMembers()
  await fetchTeams()
  await fetchRooms()
  await fetchBookings()
  // 전체 사용자 목록 (인력 등록 드롭다운용)
  try {
    const uRes = await userService.getList({ size: 200 })
    if (uRes.success) allUsers.value = uRes.data
  } catch {}
})
</script>

<template>
  <MainLayout>
    <v-row class="mb-1" align="center" dense>
      <v-col cols="auto"><v-btn icon size="small" variant="text" @click="router.push(`/projects/${projectId}`)"><v-icon>mdi-arrow-left</v-icon></v-btn></v-col>
      <v-col>
        <span class="pms-page-title">자원 관리</span>
        <span class="pms-page-subtitle">{{ project?.projectName }}</span>
      </v-col>
    </v-row>

    <v-tabs v-model="activeTab" density="compact" class="mb-2">
      <v-tab value="members" size="small"><v-icon size="14" start>mdi-account-group</v-icon>투입인력</v-tab>
      <v-tab value="org" size="small"><v-icon size="14" start>mdi-sitemap</v-icon>조직도</v-tab>
      <v-tab value="rooms" size="small"><v-icon size="14" start>mdi-door</v-icon>회의실 예약</v-tab>
    </v-tabs>

    <!-- ═══ 탭1: 투입인력 ═══ -->
    <template v-if="activeTab === 'members'">
      <v-row dense class="mb-2" align="center">
        <v-col cols="6" md="3">
          <v-text-field v-model="memberSearch" placeholder="아이디, 이름, 소속팀, 역할 검색" prepend-inner-icon="mdi-magnify" hide-details clearable class="pms-filter" />
        </v-col>
        <v-col cols="auto">
          <v-switch v-model="showEmergencyOnly" density="compact" color="error" hide-details style="flex:none" />
          <span style="font-size:var(--pms-font-caption)">비상연락망 ({{ emergencyMembers.length }}명)</span>
        </v-col>
        <v-col cols="auto" class="ml-auto d-flex" style="gap:4px">
          <v-btn size="x-small" variant="outlined" prepend-icon="mdi-file-download-outline" @click="exportMembersExcel">엑셀 다운로드</v-btn>
          <v-btn v-if="isPmsAdmin" size="x-small" color="primary" prepend-icon="mdi-account-plus" @click="openMemberCreate">인력 등록</v-btn>
        </v-col>
      </v-row>

      <div class="pms-card">
        <table class="pms-table" style="width:100%">
          <thead>
            <tr>
              <th style="width:40px">No</th>
              <th style="width:80px; cursor:pointer" @click="toggleSort('userId')">아이디 <v-icon size="12">{{ sortIcon('userId') }}</v-icon></th>
              <th style="width:70px; cursor:pointer" @click="toggleSort('userName')">이름 <v-icon size="12">{{ sortIcon('userName') }}</v-icon></th>
              <th style="width:80px; cursor:pointer" @click="toggleSort('department')">소속팀 <v-icon size="12">{{ sortIcon('department') }}</v-icon></th>
              <th style="width:60px; cursor:pointer" @click="toggleSort('position')">직위 <v-icon size="12">{{ sortIcon('position') }}</v-icon></th>
              <th style="width:120px; cursor:pointer" @click="toggleSort('role')">역할 <v-icon size="12">{{ sortIcon('role') }}</v-icon></th>
              <th style="width:90px; cursor:pointer" @click="toggleSort('joinDate')">투입일 <v-icon size="12">{{ sortIcon('joinDate') }}</v-icon></th>
              <th style="width:60px; cursor:pointer" @click="toggleSort('manMonth')">M/M <v-icon size="12">{{ sortIcon('manMonth') }}</v-icon></th>
              <th style="width:120px">연락처</th>
              <th style="width:50px">비상</th>
              <th v-if="isPmsAdmin" style="width:60px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!displayMembers.length"><td :colspan="isPmsAdmin ? 11 : 10" class="text-center" style="padding:24px; color:var(--pms-text-hint)">{{ showEmergencyOnly ? '비상연락망에 등록된 인원이 없습니다.' : '투입인력이 없습니다.' }}</td></tr>
            <tr v-for="(m, idx) in displayMembers" :key="m.memberId" class="pms-row-click" @click="openMemberDetail(m)">
              <td class="text-center">{{ (currentPage - 1) * pageSize + idx + 1 }}</td>
              <td style="font-family:monospace; color:var(--pms-text-secondary); font-size:var(--pms-font-label)">{{ m.user?.userId || m.userId }}</td>
              <td style="font-weight:600">
                <v-icon v-if="isKeyRole(m.role)" size="14" :color="roleColor(m.role)" class="mr-1" :title="`핵심 역할: ${m.role}`">mdi-star</v-icon>
                {{ m.user?.userName || m.userName }}
                <v-chip v-if="m.user?.isActive === false" size="x-small" color="warning" variant="flat" class="ml-1">승인대기</v-chip>
              </td>
              <td>{{ m.user?.department || '' }}</td>
              <td>{{ m.user?.position || '' }}</td>
              <td>
                <v-chip size="x-small" :variant="isKeyRole(m.role) ? 'flat' : 'tonal'" :color="roleColor(m.role)">{{ ROLE_SHORT[m.role] || m.role }}</v-chip>
                <div style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ ROLE_LABELS[m.role] || '' }}</div>
              </td>
              <td class="text-center" style="font-size:var(--pms-font-caption)">{{ fmtDate(m.joinDate) }}</td>
              <td class="text-center">{{ Number(m.manMonth).toFixed(1) }}</td>
              <td style="font-size:var(--pms-font-caption)">{{ m.user?.phone || '' }}</td>
              <td class="text-center" @click.stop>
                <v-btn icon size="x-small" :variant="m.isEmergency ? 'tonal' : 'text'" :color="m.isEmergency ? 'error' : 'grey'" @click="toggleEmergency(m)">
                  <v-icon size="14">{{ m.isEmergency ? 'mdi-phone-alert' : 'mdi-phone-outline' }}</v-icon>
                </v-btn>
              </td>
              <td v-if="isPmsAdmin" class="text-center" @click.stop>
                <v-btn v-if="m.user?.isActive === false" size="x-small" variant="tonal" color="success" class="mr-1" @click="approveMember(m)">승인</v-btn>
                <v-btn icon size="x-small" variant="text" @click="openMemberEdit(m)"><v-icon size="14">mdi-pencil</v-icon></v-btn>
                <v-btn icon size="x-small" variant="text" color="error" @click="deleteMember(m)"><v-icon size="14">mdi-delete</v-icon></v-btn>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- 페이지네이션 -->
        <div v-if="sortedMembers.length > pageSize" class="d-flex align-center justify-center pa-2" style="gap:8px; border-top:1px solid var(--pms-border-light)">
          <v-btn size="x-small" variant="text" :disabled="currentPage === 1" icon @click="currentPage = 1"><v-icon size="16">mdi-chevron-double-left</v-icon></v-btn>
          <v-btn size="x-small" variant="text" :disabled="currentPage === 1" icon @click="currentPage--"><v-icon size="16">mdi-chevron-left</v-icon></v-btn>
          <span style="font-size:var(--pms-font-label)">{{ currentPage }} / {{ totalPages }} 페이지 (총 {{ sortedMembers.length }}명)</span>
          <v-btn size="x-small" variant="text" :disabled="currentPage === totalPages" icon @click="currentPage++"><v-icon size="16">mdi-chevron-right</v-icon></v-btn>
          <v-btn size="x-small" variant="text" :disabled="currentPage === totalPages" icon @click="currentPage = totalPages"><v-icon size="16">mdi-chevron-double-right</v-icon></v-btn>
        </div>
      </div>
    </template>

    <!-- ═══ 탭2: 조직도 ═══ -->
    <template v-if="activeTab === 'org'">
      <v-row dense class="org-layout">
        <!-- 좌측: 팀 관리 -->
        <v-col cols="12" md="3">
          <div class="pms-card" style="position:sticky; top:12px">
            <div class="pms-section-header d-flex align-center">
              <v-icon size="14">mdi-sitemap</v-icon> 팀(부서) 관리
              <v-chip size="x-small" variant="tonal" class="ml-2">{{ projectTeams.length }}개</v-chip>
              <v-spacer />
              <v-btn v-if="isPmsAdmin" size="x-small" color="primary" prepend-icon="mdi-plus" @click="openTeamCreate">팀 추가</v-btn>
            </div>
            <div class="pa-2">
              <div v-if="!projectTeams.length" class="text-center pa-4" style="color:var(--pms-text-hint); font-size:var(--pms-font-caption)">등록된 팀이 없습니다.</div>
              <div v-for="t in projectTeams" :key="t.teamId" class="d-flex align-center mb-1 pa-2" style="border:1px solid var(--pms-border-light); border-radius:var(--pms-radius); gap:6px">
                <v-icon size="14" color="amber-darken-2">mdi-folder-account</v-icon>
                <span style="font-size:var(--pms-font-body); font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ t.teamName }}</span>
                <v-chip size="x-small" variant="tonal" style="font-size:9px">{{ members.filter((m: any) => (m.user?.department || '') === t.teamName).length }}</v-chip>
                <template v-if="isPmsAdmin">
                  <v-btn icon size="x-small" variant="text" @click="openTeamEdit(t)"><v-icon size="12">mdi-pencil</v-icon></v-btn>
                  <v-btn icon size="x-small" variant="text" color="error" @click="deleteTeam(t)"><v-icon size="12">mdi-delete</v-icon></v-btn>
                </template>
              </div>
            </div>
          </div>
        </v-col>

        <!-- 우측: 조직도 -->
        <v-col cols="12" md="9">
          <v-row dense class="mb-2">
            <v-col cols="6" md="4">
              <v-text-field v-model="orgSearch" placeholder="인력 검색" prepend-inner-icon="mdi-magnify" hide-details clearable class="pms-filter" />
            </v-col>
          </v-row>
          <div class="pms-card pa-3">
            <div v-if="!members.length" class="text-center pa-8" style="color:var(--pms-text-hint)">투입인력이 없습니다.</div>
            <div v-else class="org-tree">
          <template v-for="team in projectTeams" :key="team.teamId">
            <div class="org-dept"
                 :class="{ 'org-drop-hover': dragOverTeam === team.teamName }"
                 @dragover="onDragOver(team.teamName, $event)"
                 @dragleave="onDragLeave(team.teamName)"
                 @drop="onDrop(team.teamName)"
                 v-if="isPmsAdmin || members.some((m: any) => (m.user?.department || '') === team.teamName)">
              <div class="org-dept-header">
                <v-icon size="16" color="amber-darken-2" class="mr-1">mdi-folder-account</v-icon>
                <span style="font-weight:700">{{ team.teamName }}</span>
                <v-chip size="x-small" variant="tonal" class="ml-1">{{ members.filter((m: any) => (m.user?.department || '') === team.teamName).length }}명</v-chip>
              </div>
              <div class="org-members">
                <div v-if="!members.some((m: any) => (m.user?.department || '') === team.teamName)" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint); padding:8px; font-style:italic">
                  (비어있음 — 미배정 인력을 드래그하여 배정)
                </div>
                <div v-for="m in members.filter((m: any) => (m.user?.department || '') === team.teamName)" :key="m.memberId"
                     class="org-member" :class="{ 'org-highlight': orgSearch && (m.user?.userName || '').includes(orgSearch), 'org-member-dragging': draggedMember?.memberId === m.memberId }"
                     :draggable="isPmsAdmin"
                     @dragstart="onDragStart(m, $event)"
                     @dragend="onDragEnd"
                     style="cursor:pointer" @click="openMemberDetail(m)">
                  <v-avatar size="36" :color="isKeyRole(m.role) ? roleColor(m.role) : 'primary'" class="mr-2" style="position:relative">
                    <img v-if="m.user?.photoPath" :src="photoUrl(m.user.photoPath)" style="width:100%; height:100%; object-fit:cover" />
                    <span v-else style="font-size:13px; color:#fff">{{ (m.user?.userName || '?')[0] }}</span>
                    <v-icon v-if="isKeyRole(m.role)" size="10" color="white" style="position:absolute; bottom:-2px; right:-2px; background:#FBC02D; border-radius:50%; padding:1px">mdi-star</v-icon>
                  </v-avatar>
                  <div>
                    <div style="font-size:var(--pms-font-body); font-weight:600">
                      {{ m.user?.userName }}
                      <v-chip v-if="m.user?.isActive === false" size="x-small" color="warning" variant="flat" class="ml-1">승인대기</v-chip>
                    </div>
                    <div style="font-size:var(--pms-font-mini)">
                      <v-chip size="x-small" :variant="isKeyRole(m.role) ? 'flat' : 'tonal'" :color="roleColor(m.role)" style="height:14px; font-size:9px">{{ ROLE_SHORT[m.role] || m.role }}</v-chip>
                      <span style="color:var(--pms-text-hint); margin-left:4px">{{ m.user?.position || '' }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
          <!-- 미배정 인력 -->
          <div class="org-dept"
               :class="{ 'org-drop-hover': dragOverTeam === '__unassigned__' }"
               @dragover="onDragOver('__unassigned__', $event)"
               @dragleave="onDragLeave('__unassigned__')"
               @drop="onDrop('__unassigned__')"
               v-if="members.some((m: any) => !projectTeams.some((t: any) => t.teamName === (m.user?.department || '')))">
            <div class="org-dept-header">
              <v-icon size="16" color="grey" class="mr-1">mdi-account-question</v-icon>
              <span style="font-weight:700; color:var(--pms-text-hint)">미배정</span>
              <v-chip size="x-small" variant="tonal" class="ml-1">{{ members.filter((m: any) => !projectTeams.some((t: any) => t.teamName === (m.user?.department || ''))).length }}명</v-chip>
              <span v-if="isPmsAdmin" style="margin-left:8px; font-size:var(--pms-font-caption); color:var(--pms-text-hint)">💡 팀으로 드래그하여 배정</span>
            </div>
            <div class="org-members">
              <div v-for="m in members.filter((m: any) => !projectTeams.some((t: any) => t.teamName === (m.user?.department || '')))" :key="m.memberId"
                   class="org-member" :class="{ 'org-member-dragging': draggedMember?.memberId === m.memberId }"
                   :draggable="isPmsAdmin"
                   @dragstart="onDragStart(m, $event)"
                   @dragend="onDragEnd"
                   style="cursor:pointer" @click="openMemberDetail(m)">
                <v-avatar size="36" color="grey" class="mr-2">
                  <span style="font-size:13px; color:#fff">{{ (m.user?.userName || '?')[0] }}</span>
                </v-avatar>
                <div>
                  <div style="font-size:var(--pms-font-body); font-weight:600">{{ m.user?.userName }}</div>
                  <div style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ ROLE_SHORT[m.role] || m.role }}</div>
                </div>
              </div>
            </div>
          </div><!-- /org-dept unassigned -->
          </div><!-- /org-tree -->
          </div><!-- /pms-card -->
        </v-col>
      </v-row>

      <!-- 팀 추가/수정 다이얼로그 -->
      <v-dialog v-model="teamDialog" max-width="360" persistent>
        <v-card>
          <v-card-title style="font-size:var(--pms-font-subtitle)">{{ teamEditMode ? '팀 수정' : '팀 추가' }}</v-card-title>
          <v-card-text>
            <v-text-field v-model="teamForm.teamName" variant="outlined" density="compact" hide-details class="pms-form" autofocus @keyup.enter="saveTeam">
              <template #label>팀명<span class="pms-required">*</span></template>
            </v-text-field>
          </v-card-text>
          <v-card-actions><v-spacer /><v-btn size="small" variant="outlined" @click="teamDialog = false">취소</v-btn><v-btn size="small" color="primary" @click="saveTeam">저장</v-btn></v-card-actions>
        </v-card>
      </v-dialog>
    </template>

    <!-- ═══ 탭3: 회의실 예약 ═══ -->
    <template v-if="activeTab === 'rooms'">
      <div class="d-flex align-center mb-2" style="gap:8px">
        <v-btn icon size="small" variant="text" @click="prevMonth"><v-icon>mdi-chevron-left</v-icon></v-btn>
        <span style="font-size:var(--pms-font-subtitle); font-weight:700; min-width:100px; text-align:center">{{ currentYear }}년 {{ currentMonth }}월</span>
        <v-btn icon size="small" variant="text" @click="nextMonth"><v-icon>mdi-chevron-right</v-icon></v-btn>
        <v-spacer />
        <v-btn v-if="isPmsAdmin" size="x-small" variant="outlined" prepend-icon="mdi-door" @click="roomDialog = true; roomForm = { roomName: '', location: '', capacity: 10 }">회의실 등록</v-btn>
        <v-btn size="x-small" color="primary" prepend-icon="mdi-plus" @click="openBooking()">예약</v-btn>
      </div>

      <!-- 회의실 현황 캘린더 -->
      <div class="pms-card mb-3" style="overflow-x:auto">
        <table class="room-calendar">
          <thead>
            <tr>
              <th style="width:100px; position:sticky; left:0; background:#fff; z-index:1">회의실</th>
              <th v-for="d in dayHeaders" :key="d.day" :class="{ 'day-weekend': d.isWeekend }" style="min-width:32px">
                <div>{{ d.day }}</div>
                <div style="font-size:8px">{{ d.dow }}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="room in rooms" :key="room.roomId">
              <td style="position:sticky; left:0; background:#fff; z-index:1; font-weight:600; font-size:var(--pms-font-caption)">
                {{ room.roomName }}
                <v-btn v-if="isPmsAdmin" icon size="10" variant="text" color="error" @click="deleteRoom(room.roomId)"><v-icon size="10">mdi-close</v-icon></v-btn>
              </td>
              <td v-for="d in dayHeaders" :key="d.day" :class="{ 'day-weekend': d.isWeekend }" class="room-cell" @click="openBooking(room.roomId, d.day)">
                <div v-for="b in getBookingsForRoomDay(room.roomId, d.day)" :key="b.bookingId" class="booking-chip" :title="`${b.startTime}~${b.endTime} ${b.title} (${b.bookerName})`" @click.stop="(isPmsAdmin || b.bookerId === authStore.user?.userId) && deleteBooking(b.bookingId, b)">
                  {{ b.startTime }}
                </div>
              </td>
            </tr>
            <tr v-if="!rooms.length"><td :colspan="daysInMonth + 1" class="text-center" style="padding:24px; color:var(--pms-text-hint)">등록된 회의실이 없습니다.</td></tr>
          </tbody>
        </table>
      </div>

      <!-- 이번 달 예약 목록 -->
      <div class="pms-card">
        <div class="pms-section-header"><v-icon size="14">mdi-calendar-check</v-icon> 예약 목록 ({{ bookings.length }}건)</div>
        <div v-if="!bookings.length" class="text-center pa-4" style="color:var(--pms-text-hint); font-size:var(--pms-font-body)">이번 달 예약이 없습니다.</div>
        <table v-else class="pms-table" style="width:100%">
          <thead><tr><th>날짜</th><th>시간</th><th>회의실</th><th>회의명</th><th>예약자</th><th style="width:80px">작업</th></tr></thead>
          <tbody>
            <tr v-for="b in bookings" :key="b.bookingId">
              <td>{{ fmtDate(b.bookingDate) }}</td>
              <td>{{ b.startTime }}~{{ b.endTime }}</td>
              <td>{{ b.room?.roomName }}</td>
              <td style="font-weight:500">
                {{ b.title }}
                <v-chip v-if="b.recurrenceGroupId" size="x-small" variant="tonal" color="indigo" class="ml-1" :title="b.recurrenceType === 'weekly' ? '매주 반복' : '매월 반복'">
                  <v-icon size="10" start>mdi-repeat</v-icon>{{ b.recurrenceType === 'weekly' ? '매주' : '매월' }}
                </v-chip>
              </td>
              <td>{{ b.bookerName }}</td>
              <td class="text-center">
                <v-btn v-if="isPmsAdmin || b.bookerId === authStore.user?.userId" icon size="x-small" variant="text" @click="openBookingEdit(b)" title="수정"><v-icon size="14">mdi-pencil</v-icon></v-btn>
                <v-btn v-if="isPmsAdmin || b.bookerId === authStore.user?.userId" icon size="x-small" variant="text" color="error" @click="deleteBooking(b.bookingId, b)" title="삭제"><v-icon size="14">mdi-delete</v-icon></v-btn>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 인력 상세보기 다이얼로그 -->
    <v-dialog v-model="detailDialog" max-width="500">
      <v-card v-if="detailMember">
        <v-card-title class="d-flex align-center" style="font-size:var(--pms-font-subtitle); gap:16px; padding:16px">
          <div v-if="detailMember.user?.photoPath" style="width:80px; height:80px; border-radius:12px; overflow:hidden; flex-shrink:0; border:1px solid var(--pms-border-light)">
            <img :src="photoUrl(detailMember.user.photoPath)" style="width:100%; height:100%; object-fit:cover" />
          </div>
          <v-avatar v-else size="80" color="primary" style="border-radius:12px; flex-shrink:0">
            <span style="font-size:28px; color:#fff">{{ (detailMember.user?.userName || '?')[0] }}</span>
          </v-avatar>
          <div>
            <div style="font-weight:700; font-size:16px">{{ detailMember.user?.userName }}</div>
            <div style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary); margin-top:4px">
              <v-chip size="x-small" variant="tonal" color="primary" class="mr-1">{{ ROLE_SHORT[detailMember.role] || detailMember.role }}</v-chip>
              {{ detailMember.user?.position || '' }}
            </div>
          </div>
          <v-spacer />
          <v-chip v-if="detailMember.isEmergency" size="x-small" color="error" variant="tonal"><v-icon start size="10">mdi-phone-alert</v-icon>비상연락망</v-chip>
        </v-card-title>
        <v-divider />
        <v-card-text>
          <div class="pms-card">
            <table class="pms-detail-table">
              <tbody>
                <tr><td class="pms-detail-label">소속팀</td><td class="pms-detail-value">{{ detailMember.user?.department || '-' }}</td></tr>
                <tr><td class="pms-detail-label">직위</td><td class="pms-detail-value">{{ detailMember.user?.position || '-' }}</td></tr>
                <tr>
                  <td class="pms-detail-label">역할</td>
                  <td class="pms-detail-value">
                    <v-chip size="x-small" variant="tonal" color="primary">{{ ROLE_SHORT[detailMember.role] || detailMember.role }}</v-chip>
                    <span style="font-size:var(--pms-font-caption); color:var(--pms-text-hint); margin-left:4px">{{ ROLE_LABELS[detailMember.role] || '' }}</span>
                  </td>
                </tr>
                <tr><td class="pms-detail-label">연락처</td><td class="pms-detail-value">{{ detailMember.user?.phone || '-' }}</td></tr>
                <tr><td class="pms-detail-label">이메일</td><td class="pms-detail-value">{{ detailMember.user?.email || '-' }}</td></tr>
                <tr><td class="pms-detail-label">주소</td><td class="pms-detail-value">{{ detailMember.user?.address || '-' }}</td></tr>
                <tr><td class="pms-detail-label">투입일</td><td class="pms-detail-value">{{ fmtDate(detailMember.joinDate) }}</td></tr>
                <tr><td class="pms-detail-label">철수일</td><td class="pms-detail-value">{{ detailMember.leaveDate ? fmtDate(detailMember.leaveDate) : '-' }}</td></tr>
                <tr><td class="pms-detail-label">M/M</td><td class="pms-detail-value">{{ Number(detailMember.manMonth).toFixed(1) }}</td></tr>
              </tbody>
            </table>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-btn v-if="isPmsAdmin" size="small" variant="outlined" prepend-icon="mdi-pencil" @click="detailDialog = false; openMemberEdit(detailMember)">수정</v-btn>
          <v-spacer />
          <v-btn size="small" variant="outlined" @click="detailDialog = false">닫기</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 인력 등록/수정 다이얼로그 -->
    <v-dialog v-model="memberDialog" max-width="600" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">{{ memberEditMode ? '인력 수정' : '인력 등록' }}</v-card-title>
        <v-card-text>
          <!-- 인력 정보 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title"><v-icon size="16">mdi-account</v-icon>인력 정보</div>
            <v-row dense class="mb-2">
              <v-col cols="6">
                <v-text-field v-if="memberEditMode" :model-value="memberForm.userName || memberForm.userId" variant="outlined" density="compact" hide-details class="pms-form" readonly disabled>
                  <template #label>사용자</template>
                </v-text-field>
                <template v-else>
                  <div class="d-flex align-center mb-2" style="gap:4px">
                    <v-text-field v-model="memberForm.userId" variant="outlined" density="compact" hide-details class="pms-form" placeholder="영문+숫자" @input="memberIdCheck = ''">
                      <template #label>사용자ID<span class="pms-required">*</span></template>
                    </v-text-field>
                    <v-btn size="small" variant="outlined" color="primary" style="flex-shrink:0" @click="checkMemberId" :disabled="!memberForm.userId">중복확인</v-btn>
                  </div>
                  <div v-if="memberIdCheck === 'ok'" style="font-size:var(--pms-font-mini); color:var(--pms-success); margin-bottom:4px">사용 가능한 아이디입니다.</div>
                  <div v-if="memberIdCheck === 'taken'" style="font-size:var(--pms-font-mini); color:var(--pms-error); margin-bottom:4px">이미 사용 중인 아이디입니다.</div>
                  <v-text-field v-model="memberForm.userName" variant="outlined" density="compact" hide-details class="pms-form">
                    <template #label>사용자명<span class="pms-required">*</span></template>
                  </v-text-field>
                  <div style="font-size:var(--pms-font-mini); color:var(--pms-text-hint); margin-top:2px">초기 비밀번호: Pms + 사용자ID + ! (첫 로그인 시 변경)</div>
                </template>
              </v-col>
              <v-col cols="6">
                <v-select v-model="memberForm.role" :items="ROLE_OPTIONS" variant="outlined" density="compact" hide-details class="pms-form">
                  <template #label>역할<span class="pms-required">*</span></template>
                </v-select>
              </v-col>
            </v-row>
            <v-row dense>
              <v-col cols="4">
                <v-select v-model="memberForm.department" :items="projectTeams.map((t: any) => t.teamName)" variant="outlined" density="compact" hide-details class="pms-form" no-data-text="팀 없음 (조직도에서 추가)">
                  <template #label>소속팀<span class="pms-required">*</span></template>
                </v-select>
              </v-col>
              <v-col cols="4">
                <v-text-field v-model="memberForm.position" variant="outlined" density="compact" hide-details class="pms-form">
                  <template #label>직위<span class="pms-required">*</span></template>
                </v-text-field>
              </v-col>
              <v-col cols="4">
                <v-text-field v-model="memberForm.phone" variant="outlined" density="compact" hide-details class="pms-form" placeholder="010-0000-0000">
                  <template #label>연락처<span class="pms-required">*</span></template>
                </v-text-field>
              </v-col>
            </v-row>
          </div>

          <!-- 기간/공수 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title orange"><v-icon size="16">mdi-calendar-range</v-icon>기간/공수</div>
            <v-row dense>
              <v-col cols="4"><PmsDatePicker v-model="memberForm.joinDate" label="투입일" :required="true" :allow-non-working="true" /></v-col>
              <v-col cols="4"><PmsDatePicker v-model="memberForm.leaveDate" label="철수일" :allow-non-working="true" /></v-col>
              <v-col cols="4"><v-text-field v-model.number="memberForm.manMonth" label="M/M" type="number" step="0.1" variant="outlined" density="compact" hide-details class="pms-form" /></v-col>
            </v-row>
          </div>

          <!-- 추가정보 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title grey"><v-icon size="16">mdi-card-account-details</v-icon>추가정보</div>
            <v-text-field v-model="memberForm.address" label="주소" variant="outlined" density="compact" hide-details class="pms-form mb-2" />
            <div style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary); margin-bottom:6px">사진</div>
            <div class="d-flex align-center" style="gap:12px">
              <div v-if="memberForm.photoPreview" style="width:80px; height:80px; border-radius:12px; overflow:hidden; flex-shrink:0; border:1px solid var(--pms-border-light)">
                <img :src="memberForm.photoPreview" style="width:100%; height:100%; object-fit:cover" />
              </div>
              <v-avatar v-else size="80" color="grey-lighten-3" style="border-radius:12px; flex-shrink:0">
                <v-icon size="32" color="grey">mdi-account</v-icon>
              </v-avatar>
              <div>
                <v-btn size="x-small" variant="outlined" prepend-icon="mdi-camera" @click="($refs.photoInput as HTMLInputElement)?.click()">사진 선택</v-btn>
                <v-btn v-if="memberForm.photoPreview" size="x-small" variant="text" color="error" class="ml-1" @click="memberForm.photoPreview = ''; memberForm.photoFile = null; memberForm.photoDeleted = true">삭제</v-btn>
                <input ref="photoInput" type="file" accept="image/*" hidden @change="onPhotoChange" />
                <div style="font-size:var(--pms-font-mini); color:var(--pms-text-hint); margin-top:4px">JPG, PNG (최대 5MB)</div>
              </div>
            </div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="outlined" @click="memberDialog = false">취소</v-btn>
          <v-btn size="small" color="primary" @click="saveMember">저장</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 회의실 등록 다이얼로그 -->
    <v-dialog v-model="roomDialog" max-width="400" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">회의실 등록</v-card-title>
        <v-card-text>
          <v-text-field v-model="roomForm.roomName" variant="outlined" density="compact" hide-details class="pms-form mb-2">
            <template #label>회의실명<span class="pms-required">*</span></template>
          </v-text-field>
          <v-text-field v-model="roomForm.location" label="위치" variant="outlined" density="compact" hide-details class="pms-form mb-2" />
          <v-text-field v-model.number="roomForm.capacity" label="수용인원" type="number" variant="outlined" density="compact" hide-details class="pms-form" />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn size="small" variant="outlined" @click="roomDialog = false">취소</v-btn><v-btn size="small" color="primary" @click="saveRoom">저장</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 예약 등록 다이얼로그 -->
    <v-dialog v-model="bookingDialog" max-width="460" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">{{ bookingEditMode ? '회의실 예약 수정' : '회의실 예약' }}</v-card-title>
        <v-card-text>
          <v-select v-model="bookingForm.roomId" :items="rooms.map(r => ({ title: r.roomName, value: String(r.roomId) }))" variant="outlined" density="compact" hide-details class="pms-form mb-2">
            <template #label>회의실<span class="pms-required">*</span></template>
          </v-select>
          <v-text-field v-model="bookingForm.bookingDate" type="date" variant="outlined" density="compact" hide-details class="pms-form mb-2">
            <template #label>날짜<span class="pms-required">*</span></template>
          </v-text-field>
          <v-row dense class="mb-2">
            <v-col cols="6"><v-text-field v-model="bookingForm.startTime" type="time" label="시작" variant="outlined" density="compact" hide-details class="pms-form" /></v-col>
            <v-col cols="6"><v-text-field v-model="bookingForm.endTime" type="time" label="종료" variant="outlined" density="compact" hide-details class="pms-form" /></v-col>
          </v-row>
          <v-text-field v-model="bookingForm.title" variant="outlined" density="compact" hide-details class="pms-form mb-2">
            <template #label>회의명<span class="pms-required">*</span></template>
          </v-text-field>
          <v-text-field v-model="bookingForm.attendees" label="참석자 (콤마 구분)" variant="outlined" density="compact" hide-details class="pms-form mb-2" />
          <!-- 반복 예약 (신규 등록 시만) -->
          <div v-if="!bookingEditMode" class="pa-2 booking-recur" style="background:var(--pms-surface-variant, #f5f5f5); border-radius:var(--pms-radius)">
            <div style="font-size:var(--pms-font-label); font-weight:600; margin-bottom:4px">
              <v-icon size="12" class="mr-1">mdi-repeat</v-icon>반복 설정
            </div>
            <v-radio-group v-model="bookingForm.recurrenceType" inline hide-details density="compact" class="mt-0">
              <v-radio value="" density="compact">
                <template #label><span style="font-size:var(--pms-font-body)">없음 (일회성)</span></template>
              </v-radio>
              <v-radio value="weekly" density="compact">
                <template #label><span style="font-size:var(--pms-font-body)">매주</span></template>
              </v-radio>
              <v-radio value="monthly" density="compact">
                <template #label><span style="font-size:var(--pms-font-body)">매월</span></template>
              </v-radio>
            </v-radio-group>
            <div v-if="bookingForm.recurrenceType" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint); margin-top:4px">
              ※ 사업기간 종료일까지 {{ bookingForm.recurrenceType === 'weekly' ? '매주 같은 요일' : '매월 같은 날짜' }}에 예약이 자동 생성됩니다.
            </div>
          </div>
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn size="small" variant="outlined" @click="bookingDialog = false">취소</v-btn><v-btn size="small" color="primary" @click="saveBooking">예약</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </MainLayout>
</template>

<style scoped>
.pms-row-click { cursor: pointer; transition: background 0.15s; }
.pms-row-click:hover { background: var(--pms-hover, #f5f5f5); }

/* 조직도 */
.org-tree { display: flex; flex-wrap: wrap; gap: 16px; }
.org-dept { min-width: 220px; border: 1px solid var(--pms-border-light); border-radius: var(--pms-radius); overflow: hidden; }
.org-dept-header { padding: 8px 12px; background: var(--pms-surface-variant, #f5f5f5); font-size: var(--pms-font-body); display: flex; align-items: center; }
.org-members { padding: 4px 0; }
.org-member { display: flex; align-items: center; padding: 6px 12px; transition: background 0.15s; }
.org-member:hover { background: var(--pms-hover, #f5f5f5); }
.org-highlight { background: #FFF9C4 !important; }

/* 드래그&드랍 스타일 */
.org-member[draggable="true"] { cursor: grab; }
.org-member[draggable="true"]:active { cursor: grabbing; }
.org-member-dragging { opacity: 0.4; }
.org-dept { transition: all 0.15s; }
.org-drop-hover {
  background: rgba(var(--v-theme-primary), 0.08);
  border-color: var(--pms-primary) !important;
  border-width: 2px !important;
  box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.15);
}

/* 회의실 캘린더 */
.room-calendar { width: 100%; border-collapse: collapse; font-size: var(--pms-font-caption, 10px); }
.room-calendar th, .room-calendar td { border: 1px solid var(--pms-border-light, #eee); padding: 2px; text-align: center; vertical-align: top; }
.room-calendar th { background: var(--pms-surface-variant, #f5f5f5); font-weight: 600; }
.day-weekend { background: #f9f9fb; }
.day-weekend th { color: var(--pms-error, #E53935); }
.room-cell { cursor: pointer; min-height: 28px; }
.room-cell:hover { background: #E3F2FD; }
.booking-chip {
  font-size: 8px; background: #1565C0; color: #fff; border-radius: 2px;
  padding: 1px 3px; margin: 1px 0; cursor: pointer; white-space: nowrap;
}
.booking-chip:hover { background: #E53935; }

/* 반복 예약 라디오 컴팩트 */
.booking-recur :deep(.v-selection-control) { min-height: 24px; }
.booking-recur :deep(.v-radio) { padding-right: 12px; }
.booking-recur :deep(.v-selection-control__wrapper) { height: 22px; width: 22px; }
.booking-recur :deep(.v-selection-control__input) { height: 22px; width: 22px; }
.booking-recur :deep(.v-icon) { font-size: 16px !important; }
</style>
