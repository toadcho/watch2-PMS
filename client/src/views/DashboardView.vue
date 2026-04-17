<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import MainLayout from '@/components/common/MainLayout.vue'
import BulkApprovalDialog from '@/components/common/BulkApprovalDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { dashboardService } from '@/services/dashboard'
import { approvalService } from '@/services/approval'
import { notificationService } from '@/services/notifications'
import { useDialog } from '@/composables/useDialog'
const { showAlert, showConfirm, showPrompt } = useDialog()
const authStore = useAuthStore()
const router = useRouter()

const loading = ref(false)
const data = ref<any>(null)

// 위젯 정의
interface WidgetDef { id: string; label: string; icon: string; color: string; column: 'left' | 'right'; pinned?: boolean }
const WIDGET_DEFS: WidgetDef[] = [
  { id: 'notices', label: '공지사항', icon: 'mdi-bullhorn', color: '', column: 'left', pinned: true },
  { id: 'progress', label: '전체 진척률', icon: 'mdi-chart-donut', color: 'primary', column: 'left' },
  { id: 'bizProgress', label: '업무별 진척률', icon: 'mdi-chart-bar', color: 'indigo', column: 'left' },
  { id: 'schedule', label: '일정/마일스톤', icon: 'mdi-calendar-star', color: 'deep-purple', column: 'right', pinned: true },
  { id: 'recentIssues', label: '이슈 현황', icon: 'mdi-alert-circle', color: 'error', column: 'right' },
  { id: 'recentRisks', label: '리스크 현황', icon: 'mdi-shield-alert', color: 'warning', column: 'right' },
  { id: 'pendingApprovals', label: '승인 대기', icon: 'mdi-clipboard-clock', color: 'orange', column: 'right' },
  { id: 'myTasks', label: '내 진행 태스크', icon: 'mdi-clipboard-check', color: '', column: 'right' },
  { id: 'roomBookings', label: '회의실 예약', icon: 'mdi-door', color: 'teal', column: 'left' },
  { id: 'miniCalendar', label: '프로젝트 달력', icon: 'mdi-calendar-month', color: 'cyan', column: 'right' },
]

// 위젯 접기/펼치기
const widgetExpanded = reactive<Record<string, boolean>>({
  progress: true, myBizProgress: true, bizProgress: true, notices: true,
  schedule: true, pendingApprovals: true, myApprovalStatus: true, myTasks: true, roomBookings: true,
  recentIssues: true, recentRisks: true, miniCalendar: true,
})

// 위젯 표시/숨김 설정
const STORAGE_KEY = 'pms-dashboard-widgets'
const widgetVisible = reactive<Record<string, boolean>>(
  JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') ||
  Object.fromEntries(WIDGET_DEFS.map(w => [w.id, true]))
)
function saveWidgetSettings() { localStorage.setItem(STORAGE_KEY, JSON.stringify(widgetVisible)) }

// 위젯 고정 설정 (사용자 토글 가능)
const PINNED_KEY = 'pms-dashboard-pinned'
const widgetPinned = reactive<Record<string, boolean>>(
  JSON.parse(localStorage.getItem(PINNED_KEY) || 'null') ||
  Object.fromEntries(WIDGET_DEFS.map(w => [w.id, !!w.pinned]))
)
function savePinnedSettings() { localStorage.setItem(PINNED_KEY, JSON.stringify(widgetPinned)) }
function togglePinned(id: string) {
  widgetPinned[id] = !widgetPinned[id]
  savePinnedSettings()
  // 고정 해제되면 드래그 순서 목록에 추가, 고정되면 제거
  const def = WIDGET_DEFS.find(w => w.id === id)
  if (!def) return
  const list = def.column === 'left' ? widgetOrder.left : widgetOrder.right
  const idx = list.indexOf(id)
  if (widgetPinned[id]) {
    if (idx >= 0) list.splice(idx, 1)
  } else {
    if (idx < 0) list.push(id)
  }
  saveOrder()
}

const settingsDialog = ref(false)
function toggleWidget(id: string) { widgetVisible[id] = !widgetVisible[id]; saveWidgetSettings() }

// 위젯 수직라인 색상 맵
const WIDGET_BORDER: Record<string, string> = {
  notices: '', progress: '#43A047', bizProgress: '#66BB6A', roomBookings: '#00897B',
  schedule: '#7E57C2', miniCalendar: '#00ACC1', recentIssues: '#FB8C00', recentRisks: '#FF7043',
  pendingApprovals: '#EF5350', myTasks: '#5C6BC0', unreadNotifications: '#E53935',
}
function widgetBorderStyle(id: string) {
  const c = WIDGET_BORDER[id]
  return c ? `border-left:3px solid ${c}` : ''
}

// 드래그 가능 위젯 순서 관리
const ORDER_KEY = 'pms-dashboard-order'
const defaultLeftOrder = WIDGET_DEFS.filter(w => w.column === 'left' && !widgetPinned[w.id]).map(w => w.id)
const defaultRightOrder = WIDGET_DEFS.filter(w => w.column === 'right' && !widgetPinned[w.id]).map(w => w.id)

function loadOrder(): { left: string[]; right: string[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null')
    if (saved?.left && saved?.right) return saved
  } catch {}
  return { left: [...defaultLeftOrder], right: [...defaultRightOrder] }
}
const widgetOrder = reactive(loadOrder())
function saveOrder() { localStorage.setItem(ORDER_KEY, JSON.stringify({ left: widgetOrder.left, right: widgetOrder.right })) }

// 데이터가 없으면 렌더링 자체를 건너뛸 위젯
function hasWidgetData(id: string): boolean {
  if (id === 'pendingApprovals') return !!(data.value?.pendingApprovals?.length)
  return true
}

// 컬럼별 위젯 목록 (고정 먼저 → 드래그 순)
const leftDragWidgets = computed(() => {
  const pinned = WIDGET_DEFS.filter(w => w.column === 'left' && widgetPinned[w.id] && widgetVisible[w.id] && hasWidgetData(w.id)).map(w => w.id)
  const rest = widgetOrder.left.filter(id => widgetVisible[id] && !widgetPinned[id] && hasWidgetData(id))
  return Array.from(new Set([...pinned, ...rest]))
})
const rightDragWidgets = computed(() => {
  const pinned = WIDGET_DEFS.filter(w => w.column === 'right' && widgetPinned[w.id] && widgetVisible[w.id] && hasWidgetData(w.id)).map(w => w.id)
  const rest = widgetOrder.right.filter(id => widgetVisible[id] && !widgetPinned[id] && !widgetOrder.left.includes(id) && hasWidgetData(id))
  return Array.from(new Set([...pinned, ...rest]))
})

// 컬럼별 고정 위젯
const leftPinnedWidgets = computed(() => WIDGET_DEFS.filter(w => w.column === 'left' && widgetPinned[w.id] && widgetVisible[w.id]))
const rightPinnedWidgets = computed(() => WIDGET_DEFS.filter(w => w.column === 'right' && widgetPinned[w.id] && widgetVisible[w.id]))

// 컬럼별 드래그 위젯 (고정 제외)
const leftDragOrder = computed(() => widgetOrder.left.filter(id => !widgetPinned[id]))
const rightDragOrder = computed(() => widgetOrder.right.filter(id => !widgetPinned[id]))

// 새 위젯이 추가되었을 때 order에 없는 위젯 보충
function ensureAllWidgets() {
  // stale 데이터 정리: 양쪽 컬럼에 중복되거나 고정된 위젯은 order 에서 제거
  const seen = new Set<string>()
  widgetOrder.left = widgetOrder.left.filter(id => {
    if (widgetPinned[id]) return false
    if (seen.has(id)) return false
    seen.add(id); return true
  })
  widgetOrder.right = widgetOrder.right.filter(id => {
    if (widgetPinned[id]) return false
    if (seen.has(id)) return false
    seen.add(id); return true
  })
  const allLeft = WIDGET_DEFS.filter(w => w.column === 'left' && !widgetPinned[w.id]).map(w => w.id)
  const allRight = WIDGET_DEFS.filter(w => w.column === 'right' && !widgetPinned[w.id]).map(w => w.id)
  for (const id of allLeft) { if (!widgetOrder.left.includes(id) && !widgetOrder.right.includes(id)) widgetOrder.left.push(id) }
  for (const id of allRight) { if (!widgetOrder.right.includes(id) && !widgetOrder.left.includes(id)) widgetOrder.right.push(id) }
  saveOrder()
}

// ── 네이티브 HTML5 드래그 ──
const dragSrcCol = ref<'left' | 'right' | ''>('')
const dragSrcId = ref('')
const dragOverId = ref('')

function onDragStart(e: DragEvent, col: 'left' | 'right', wid: string) {
  dragSrcCol.value = col; dragSrcId.value = wid
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', wid)
  // 다음 프레임에서 투명 처리 (즉시 하면 고스트 이미지도 투명해짐)
  requestAnimationFrame(() => { dragSrcId.value = wid })
}
function onDragEnd() {
  dragSrcId.value = ''; dragSrcCol.value = ''; dragOverId.value = ''
}
function onDragOverWidget(e: DragEvent, wid: string) {
  e.preventDefault(); e.dataTransfer!.dropEffect = 'move'
  if (wid !== dragSrcId.value) dragOverId.value = wid
}
function onDragLeaveWidget(e: DragEvent) {
  const rel = e.relatedTarget as HTMLElement
  if (!rel || !(e.currentTarget as HTMLElement).contains(rel)) dragOverId.value = ''
}
function onDropWidget(e: DragEvent, targetCol: 'left' | 'right', targetId: string) {
  e.preventDefault(); e.stopPropagation(); dragOverId.value = ''
  const srcId = dragSrcId.value; const srcCol = dragSrcCol.value
  if (!srcId || !srcCol || srcId === targetId) return
  // 소스에서 제거
  const srcList = srcCol === 'left' ? widgetOrder.left : widgetOrder.right
  const srcIdx = srcList.indexOf(srcId)
  if (srcIdx >= 0) srcList.splice(srcIdx, 1)
  // 타겟 위치에 삽입
  const tgtList = targetCol === 'left' ? widgetOrder.left : widgetOrder.right
  const tgtIdx = tgtList.indexOf(targetId)
  if (tgtIdx >= 0) tgtList.splice(tgtIdx, 0, srcId)
  else tgtList.push(srcId)
  saveOrder()
}
function onDropColumn(e: DragEvent, targetCol: 'left' | 'right') {
  e.preventDefault(); dragOverId.value = ''
  const srcId = dragSrcId.value; const srcCol = dragSrcCol.value
  if (!srcId || !srcCol) return
  const srcList = srcCol === 'left' ? widgetOrder.left : widgetOrder.right
  const srcIdx = srcList.indexOf(srcId)
  if (srcIdx >= 0) srcList.splice(srcIdx, 1)
  const tgtList = targetCol === 'left' ? widgetOrder.left : widgetOrder.right
  if (!tgtList.includes(srcId)) tgtList.push(srcId)
  saveOrder()
}

// ── 미니 캘린더 ──
const calMonth = ref(new Date())
const calSelectedDate = ref('')
const CAL_DAYS = ['일', '월', '화', '수', '목', '금', '토']

const calYearMonth = computed(() => {
  const d = calMonth.value
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`
})

const calGrid = computed(() => {
  const y = calMonth.value.getFullYear()
  const m = calMonth.value.getMonth()
  const firstDay = new Date(y, m, 1).getDay()
  const lastDate = new Date(y, m + 1, 0).getDate()
  const rows: { date: number; key: string; isToday: boolean; isWeekend: boolean; events: any[] }[][] = []
  let row: typeof rows[0] = []
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  // 빈 칸
  for (let i = 0; i < firstDay; i++) row.push({ date: 0, key: `e${i}`, isToday: false, isWeekend: i === 0 || i === 6, events: [] })

  for (let d = 1; d <= lastDate; d++) {
    const dow = (firstDay + d - 1) % 7
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const evts = calEventsMap.value[dateStr] || []
    row.push({ date: d, key: dateStr, isToday: dateStr === todayStr, isWeekend: dow === 0 || dow === 6, events: evts })
    if (dow === 6 || d === lastDate) { rows.push(row); row = [] }
  }
  return rows
})

// 마일스톤 + 이벤트를 날짜별 맵으로
const calEventsMap = computed(() => {
  const map: Record<string, any[]> = {}
  const milestones = data.value?.milestones || []
  const events = data.value?.upcomingEvents || []
  for (const ms of milestones) {
    const d = ms.dueDate?.substring(0, 10)
    if (d) { if (!map[d]) map[d] = []; map[d].push({ type: 'milestone', title: ms.milestoneName, color: '#7E57C2', sub: ms.milestoneType }) }
  }
  for (const ev of events) {
    const d = ev.eventDate?.substring(0, 10)
    if (d) { if (!map[d]) map[d] = []; map[d].push({ type: 'event', title: ev.title, color: ev.color || '#5C6BC0', sub: ev.eventType }) }
  }
  return map
})

const calSelectedEvents = computed(() => {
  if (!calSelectedDate.value) return []
  return calEventsMap.value[calSelectedDate.value] || []
})

function calPrev() {
  const d = new Date(calMonth.value)
  d.setMonth(d.getMonth() - 1)
  calMonth.value = d
}
function calNext() {
  const d = new Date(calMonth.value)
  d.setMonth(d.getMonth() + 1)
  calMonth.value = d
}
function calClickDate(cell: any) {
  if (!cell.date) return
  calSelectedDate.value = calSelectedDate.value === cell.key ? '' : cell.key
}

async function fetchDashboard() {
  loading.value = true
  try {
    authStore.restoreFromToken()
    const res = await dashboardService.getData()
    if (res.success) {
      data.value = res.data
      if (res.data.project?.projectId) {
        authStore.myProjectId = res.data.project.projectId
        authStore.myProjectName = res.data.project.projectName
      }
    }
  } catch (err) { console.error('Dashboard error:', err) }
  finally { loading.value = false }
}

function getLevelColor(l: string) { return ({ '높음': 'error', '중간': 'warning', '낮음': 'success', '상': 'error', '중': 'warning', '하': 'success' } as any)[l] || 'grey' }
function getPhaseColor(p: string) { return ({ '분석': 'blue', '설계': 'indigo', '구현': 'green', '시험': 'orange', '이행': 'purple' } as any)[p] || 'grey' }
function fmtDate(d: string) { return d ? d.substring(0, 10) : '-' }
function isOverdue(d: string) { return d && new Date(d) < new Date() }

// 공지 게시판 색상
const BOARD_COLORS = ['#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#E53935', '#00ACC1', '#F4511E', '#3949AB', '#7CB342', '#D81B60']
function noticeBoardColor(boardId: number | null): string {
  if (!boardId) return '#9E9E9E'
  const boards = data.value?.noticeBoards || []
  const idx = boards.findIndex((b: any) => b.boardId === boardId)
  return idx >= 0 ? BOARD_COLORS[idx % BOARD_COLORS.length] : '#9E9E9E'
}
function isNewNotice(n: any): boolean {
  if (!n.createdAt) return false
  return Date.now() - new Date(n.createdAt).getTime() < 24 * 60 * 60 * 1000
}
const statusColor: Record<string, string> = { Opened: 'error', Progressed: 'warning', Solved: 'success', Cancelled: 'grey', Accepted: 'info', Resolved: 'success', Closed: 'grey' }

async function quickApprove(a: any) {
  if (!(await showConfirm(`"${a.docName}" 산출물을 승인하시겠습니까?`))) return
  try {
    const res = await approvalService.approve(data.value?.project?.projectId, a.docId)
    window.dispatchEvent(new CustomEvent('pms:notif-refresh'))
    await showAlert(res.message); await fetchDashboard()
  } catch (err: any) { showAlert(err.response?.data?.message || '승인 실패', { color: 'error' }) }
}

// 일괄승인 다이얼로그
const bulkDialog = ref(false)
function openBulkDialog() {
  if (!data.value?.pendingApprovals?.length) return
  bulkDialog.value = true
}
async function onBulkApproved() {
  await fetchDashboard()
}

// "새 알림" 위젯에서 알림 클릭 시 읽음처리 + 링크 이동
async function clickNotification(n: any) {
  try {
    if (!n.isRead) {
      await notificationService.markRead(n.notifId)
      n.isRead = true
      window.dispatchEvent(new CustomEvent('pms:notif-refresh'))
    }
  } catch {}
  if (n.link) router.push(n.link)
}
async function quickReject(a: any) {
  const comment = await showPrompt(`"${a.docName}" 반려 사유를 입력하세요:`)
  if (comment === null) return
  try {
    await approvalService.reject(data.value?.project?.projectId, a.docId, comment)
    window.dispatchEvent(new CustomEvent('pms:notif-refresh'))
    await fetchDashboard()
  } catch (err: any) { showAlert(err.response?.data?.message || '반려 실패', { color: 'error' }) }
}

function goWbs(wbsCode: string) { router.push(`/projects/${data.value?.project?.projectId}/wbs?task=${wbsCode}`) }
function goIssueRisk() { router.push(`/projects/${data.value?.project?.projectId}/issue-risk`) }

onMounted(() => { ensureAllWidgets(); fetchDashboard() })
</script>

<template>
  <MainLayout>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

    <!-- 투입 프로젝트 없음 -->
    <template v-if="data?.mode === 'no-project'">
      <div class="pms-page-title mb-4">대시보드</div>
      <div class="pms-card pa-8 text-center">
        <v-icon size="48" color="grey-lighten-1" class="mb-2">mdi-folder-off</v-icon>
        <div style="font-size:var(--pms-font-subtitle); color:var(--pms-text-secondary)">투입된 프로젝트가 없습니다</div>
      </div>
    </template>

    <!-- ═══ 관리자 대시보드 ═══ -->
    <template v-else-if="data?.mode === 'admin'">
      <div class="pms-page-title mb-3">PMO 통합 대시보드</div>
      <v-row dense>
        <v-col cols="6" md="3"><div class="stat-mini-card" style="border-left:3px solid var(--pms-primary)"><div class="smc-num">{{ data.totalProjects }}</div><div class="smc-label">전체 프로젝트</div></div></v-col>
        <v-col cols="6" md="3"><div class="stat-mini-card" style="border-left:3px solid var(--pms-success)"><div class="smc-num">{{ data.activeProjects }}</div><div class="smc-label">진행중 프로젝트</div></div></v-col>
        <v-col cols="6" md="3"><div class="stat-mini-card" style="border-left:3px solid var(--pms-error)"><div class="smc-num">{{ data.openDefects }}</div><div class="smc-label">미해결 결함</div></div></v-col>
        <v-col cols="6" md="3"><div class="stat-mini-card" style="border-left:3px solid var(--pms-warning)"><div class="smc-num">{{ data.openIssues }}</div><div class="smc-label">미해결 이슈</div></div></v-col>
      </v-row>
    </template>

    <!-- ═══ 프로젝트 사용자 대시보드 ═══ -->
    <template v-else-if="data?.mode === 'project'">
      <div class="d-flex align-center mb-2">
        <span class="pms-page-title">대시보드</span>
        <span class="pms-page-subtitle">{{ data.project?.projectName }}</span>
        <v-spacer />
        <v-btn icon size="small" variant="text" @click="settingsDialog = true" title="위젯 설정"><v-icon size="18">mdi-cog</v-icon></v-btn>
      </div>
      <!-- 캐치프레이즈 이미지 (전체 너비) -->
      <div v-if="data.project?.catchphraseImage" class="catchphrase-card mb-2">
        <img :src="data.project.catchphraseImage" alt="캐치프레이즈" class="catchphrase-img" />
      </div>

      <v-row dense>
        <!-- ═══ 좌측 컬럼 ═══ -->
        <v-col cols="12" md="6">
          <!-- 위젯 (고정 + 드래그) -->
          <div class="drag-column" @dragover.prevent @drop="onDropColumn($event, 'left')">
            <div v-for="wid in leftDragWidgets" :key="wid"
              class="widget mb-2 drag-widget" :style="widgetBorderStyle(wid)"
              :class="{ 'is-dragging': dragSrcId === wid, 'drag-over': dragOverId === wid && dragSrcId !== wid, 'is-pinned': widgetPinned[wid] }"
              :draggable="!widgetPinned[wid]"
              @dragstart="!widgetPinned[wid] && onDragStart($event, 'left', wid)"
              @dragend="onDragEnd"
              @dragover="!widgetPinned[wid] && onDragOverWidget($event, wid)"
              @dragleave="onDragLeaveWidget($event)"
              @drop="!widgetPinned[wid] && onDropWidget($event, 'left', wid)"
            >
              <div v-if="widgetPinned[wid]" class="drag-handle"><v-icon size="12" color="primary">mdi-pin</v-icon></div>
              <div v-else class="drag-handle"><v-icon size="12" color="grey">mdi-drag-horizontal-variant</v-icon></div>
                <!-- notices -->
                <template v-if="wid === 'notices'">
                  <div class="widget-hd" @click="widgetExpanded.notices = !widgetExpanded.notices">
                    <v-icon size="14" class="mr-1">{{ widgetExpanded.notices ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
                    <v-icon size="14" class="mr-1">mdi-bullhorn</v-icon>공지사항
                    <v-spacer />
                    <v-btn variant="text" size="x-small" :to="`/projects/${data.project?.projectId}/notices`" @click.stop>전체보기</v-btn>
                  </div>
                  <div v-if="widgetExpanded.notices" class="widget-bd pa-0" style="max-height:200px; overflow-y:auto">
                    <div v-for="n in data.notices" :key="n.noticeId" class="notice-item" :class="{ 'notice-new': isNewNotice(n) }" @click="router.push(`/projects/${data.project?.projectId}/notices`)">
                      <div class="notice-flag" :style="{ background: noticeBoardColor(n.boardId) }"></div>
                      <v-icon v-if="n.isPinned" color="error" size="12" class="mr-1">mdi-pin</v-icon>
                      <v-chip v-if="n.boardName" size="x-small" variant="flat" :style="{ background: noticeBoardColor(n.boardId), color: '#fff' }" class="mr-1">{{ n.boardName }}</v-chip>
                      <span style="font-size:var(--pms-font-body)">{{ n.title }}</span>
                      <span v-if="isNewNotice(n)" class="new-badge ml-1">NEW</span>
                      <span class="ml-auto" style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ fmtDate(n.createdAt) }}</span>
                    </div>
                    <div v-if="!data.notices?.length" class="text-center pa-4" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">공지 없음</div>
                  </div>
                </template>
                <!-- progress -->
                <template v-else-if="wid === 'progress'">
                  <div class="widget-hd" @click="widgetExpanded.progress = !widgetExpanded.progress">
                    <v-icon size="14" class="mr-1">{{ widgetExpanded.progress ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
                    <v-icon size="14" color="primary" class="mr-1">mdi-chart-donut</v-icon>전체 진척률
                    <v-spacer />
                    <span v-if="!widgetExpanded.progress" class="widget-summary">계획 {{ data.totalPlanProgress || 0 }}% · 실적 {{ data.totalActualProgress || 0 }}%</span>
                  </div>
                  <div v-if="widgetExpanded.progress" class="widget-bd">
                    <div class="progress-cards">
                      <div class="progress-card">
                        <div class="progress-card-label">계획</div>
                        <div class="progress-card-value" style="color:#424242">{{ data.totalPlanProgress || 0 }}%</div>
                      </div>
                      <div class="progress-card">
                        <div class="progress-card-label">실적</div>
                        <div class="progress-card-value" style="color:#1976D2">{{ data.totalActualProgress || 0 }}%</div>
                      </div>
                      <div class="progress-card">
                        <div class="progress-card-label">계획대비</div>
                        <div class="progress-card-value" :style="{ color: (data.totalActualProgress||0) >= (data.totalPlanProgress||0) ? '#2E7D32' : '#C62828' }">
                          {{ ((data.totalActualProgress||0) - (data.totalPlanProgress||0)).toFixed(1) }}%p
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <!-- bizProgress -->
                <template v-else-if="wid === 'bizProgress'">
                  <div class="widget-hd" @click="widgetExpanded.bizProgress = !widgetExpanded.bizProgress">
                    <v-icon size="14" class="mr-1">{{ widgetExpanded.bizProgress ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
                    <v-icon size="14" color="indigo" class="mr-1">mdi-chart-bar</v-icon>업무별 진척률
                  </div>
                  <div v-if="widgetExpanded.bizProgress" class="widget-bd">
                    <div v-for="b in data.businessProgress" :key="b.wbsCode" class="mb-2">
                      <div class="d-flex justify-space-between mb-1"><span style="font-size:var(--pms-font-body); font-weight:500">{{ b.taskName }}</span><span style="font-size:var(--pms-font-caption)"><span style="color:var(--pms-primary)">계획 {{ b.progress }}%</span> · <span style="color:var(--pms-success)">실적 {{ b.actualProgress }}%</span><span v-if="b.bizWeight" class="text-grey ml-1">({{ b.bizWeight }}%)</span></span></div>
                      <div class="d-flex ga-1"><v-progress-linear :model-value="b.progress" color="primary" height="5" rounded style="flex:1" /><v-progress-linear :model-value="b.actualProgress" color="success" height="5" rounded style="flex:1" /></div>
                    </div>
                    <div v-if="!data.businessProgress?.length" class="text-center pa-3" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">등록된 업무가 없습니다.</div>
                  </div>
                </template>
                <!-- roomBookings -->
                <template v-else-if="wid === 'roomBookings'">
                  <div class="widget-hd" @click="widgetExpanded.roomBookings = !widgetExpanded.roomBookings">
                    <v-icon size="14" class="mr-1">{{ widgetExpanded.roomBookings ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
                    <v-icon size="14" color="teal" class="mr-1">mdi-door</v-icon>오늘 회의실 예약
                    <v-chip size="x-small" variant="tonal" color="teal" class="ml-1">{{ data.todayBookings?.length || 0 }}</v-chip>
                    <v-spacer /><v-btn variant="text" size="x-small" :to="`/projects/${data.project?.projectId}/resources?tab=rooms`" @click.stop>전체보기</v-btn>
                  </div>
                  <div v-if="widgetExpanded.roomBookings" class="widget-bd pa-0" style="max-height:220px; overflow-y:auto">
                    <div v-for="b in data.todayBookings" :key="b.bookingId" class="booking-item">
                      <v-icon size="12" color="teal" class="mr-1">mdi-clock-outline</v-icon>
                      <span class="booking-time">{{ b.startTime }} ~ {{ b.endTime }}</span>
                      <v-chip size="x-small" color="teal" variant="flat" class="mx-1" style="font-weight:700">{{ b.roomName }}</v-chip>
                      <span class="booking-title-inline">{{ b.title }}</span>
                      <v-spacer />
                      <v-icon size="11" class="mr-1">mdi-account</v-icon>
                      <span class="booking-booker-inline">{{ b.bookerName }}</span>
                    </div>
                    <div v-if="!data.todayBookings?.length" class="text-center pa-4" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">오늘 예약 없음</div>
                  </div>
                </template>
                <!-- 공통: 우측에서 이동해온 위젯도 렌더링 -->
                <template v-else-if="wid === 'miniCalendar'">
                  <div class="widget-hd" @click="widgetExpanded.miniCalendar = !widgetExpanded.miniCalendar"><v-icon size="14" class="mr-1">{{ widgetExpanded.miniCalendar ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" color="cyan-darken-1" class="mr-1">mdi-calendar-month</v-icon>프로젝트 달력<v-spacer /><v-btn variant="text" size="x-small" :to="`/projects/${data.project?.projectId}/calendar`" @click.stop>전체보기</v-btn></div>
                  <div v-if="widgetExpanded.miniCalendar" class="widget-bd pa-2">
                    <div class="d-flex align-center justify-center mb-1" style="gap:8px"><v-btn icon size="x-small" variant="text" @click="calPrev"><v-icon size="16">mdi-chevron-left</v-icon></v-btn><span style="font-size:var(--pms-font-body); font-weight:700; min-width:100px; text-align:center">{{ calYearMonth }}</span><v-btn icon size="x-small" variant="text" @click="calNext"><v-icon size="16">mdi-chevron-right</v-icon></v-btn></div>
                    <div class="cal-grid"><div v-for="d in CAL_DAYS" :key="d" class="cal-hd" :class="{ 'cal-sun': d === '일', 'cal-sat': d === '토' }">{{ d }}</div></div>
                    <div v-for="(row, ri) in calGrid" :key="ri" class="cal-grid"><div v-for="cell in row" :key="cell.key" class="cal-cell" :class="{ 'cal-today': cell.isToday, 'cal-selected': calSelectedDate === cell.key, 'cal-empty': !cell.date, 'cal-sun': cell.isWeekend && row.indexOf(cell) % 7 === 0, 'cal-sat': cell.isWeekend && row.indexOf(cell) % 7 === 6 }" @click="calClickDate(cell)"><span v-if="cell.date" class="cal-date">{{ cell.date }}</span><div v-if="cell.events.length" class="cal-dots"><span v-for="(ev, ei) in cell.events.slice(0, 3)" :key="ei" class="cal-dot" :style="{ background: ev.color }"></span></div></div></div>
                    <div v-if="calSelectedDate" class="mt-2 pt-2" style="border-top:1px solid var(--pms-border-light, #eee)"><div style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">{{ calSelectedDate }} 일정</div><div v-if="!calSelectedEvents.length" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">일정 없음</div><div v-for="(ev, i) in calSelectedEvents" :key="i" class="d-flex align-center mb-1" style="gap:4px"><span class="cal-dot" :style="{ background: ev.color }"></span><span style="font-size:var(--pms-font-caption); font-weight:500">{{ ev.title }}</span><span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ ev.sub }}</span></div></div>
                  </div>
                </template>
                <template v-else-if="wid === 'recentIssues'">
                  <div class="widget-hd" @click="widgetExpanded.recentIssues = !widgetExpanded.recentIssues"><v-icon size="14" class="mr-1">{{ widgetExpanded.recentIssues ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" color="error" class="mr-1">mdi-alert-circle</v-icon>이슈 현황<v-chip size="x-small" variant="tonal" color="error" class="ml-1">{{ data.recentIssues?.length || 0 }}</v-chip><v-spacer /><v-btn variant="text" size="x-small" @click.stop="goIssueRisk">전체보기</v-btn></div>
                  <div v-if="widgetExpanded.recentIssues" class="widget-bd pa-0" style="max-height:220px; overflow-y:auto">
                    <div v-for="i in data.recentIssues" :key="i.issueId" class="ir-item" @click="router.push(`/projects/${data.project?.projectId}/issue-risk?tab=issue`)"><div class="d-flex align-center ga-1"><v-chip :color="statusColor[i.status]||'grey'" size="x-small" variant="tonal">{{ i.status }}</v-chip><v-chip v-if="i.category" size="x-small" variant="outlined">{{ i.category }}</v-chip><v-spacer /><span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ fmtDate(i.identifiedAt || i.createdAt) }}</span></div><div style="font-size:var(--pms-font-body); font-weight:500; margin-top:2px">{{ i.issueTitle }}</div><div style="font-size:var(--pms-font-mini); color:var(--pms-text-secondary)"><span v-if="i.assigneeName"><v-icon size="10">mdi-account</v-icon> {{ i.assigneeName }}</span><span v-if="i.importance" class="ml-1">중요도:{{ i.importance }}</span></div></div>
                    <div v-if="!data.recentIssues?.length" class="text-center pa-4" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">미해결 이슈 없음</div>
                  </div>
                </template>
                <template v-else-if="wid === 'recentRisks'">
                  <div class="widget-hd" @click="widgetExpanded.recentRisks = !widgetExpanded.recentRisks"><v-icon size="14" class="mr-1">{{ widgetExpanded.recentRisks ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" color="warning" class="mr-1">mdi-shield-alert</v-icon>리스크 현황<v-chip size="x-small" variant="tonal" color="warning" class="ml-1">{{ data.recentRisks?.length || 0 }}</v-chip><v-spacer /><v-btn variant="text" size="x-small" @click.stop="router.push(`/projects/${data.project?.projectId}/issue-risk?tab=risk`)">전체보기</v-btn></div>
                  <div v-if="widgetExpanded.recentRisks" class="widget-bd pa-0" style="max-height:220px; overflow-y:auto">
                    <div v-for="r in data.recentRisks" :key="r.riskId" class="ir-item" @click="router.push(`/projects/${data.project?.projectId}/issue-risk?tab=risk`)"><div class="d-flex align-center ga-1"><v-chip :color="statusColor[r.status]||'grey'" size="x-small" variant="tonal">{{ r.status }}</v-chip><v-chip :color="getLevelColor(r.impactLevel)" size="x-small" variant="tonal">{{ r.impactLevel }}</v-chip><v-spacer /><span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ fmtDate(r.identifiedAt || r.createdAt) }}</span></div><div style="font-size:var(--pms-font-body); font-weight:500; margin-top:2px">{{ r.riskName }}</div></div>
                    <div v-if="!data.recentRisks?.length" class="text-center pa-4" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">미해결 리스크 없음</div>
                  </div>
                </template>
                <template v-else-if="wid === 'pendingApprovals' && data.pendingApprovals?.length">
                  <div class="widget-hd" @click="widgetExpanded.pendingApprovals = !widgetExpanded.pendingApprovals"><v-icon size="14" class="mr-1">{{ widgetExpanded.pendingApprovals ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" color="orange" class="mr-1">mdi-clipboard-clock</v-icon>승인 대기<v-chip size="x-small" variant="tonal" color="orange" class="ml-1">{{ data.pendingApprovals.length }}</v-chip><v-spacer /><v-btn variant="text" size="x-small" color="orange-darken-2" prepend-icon="mdi-check-all" @click.stop="openBulkDialog">일괄승인</v-btn></div>
                  <div v-if="widgetExpanded.pendingApprovals" class="widget-bd pa-0" style="max-height:300px; overflow-y:auto">
                    <div v-for="a in data.pendingApprovals" :key="a.approvalId" class="approval-item"><div class="d-flex align-center mb-1"><span style="font-size:var(--pms-font-body); font-weight:600">{{ a.docName }}</span><v-spacer /><v-btn size="x-small" color="success" variant="tonal" class="mr-1" @click="quickApprove(a)">승인</v-btn><v-btn size="x-small" color="error" variant="text" @click="quickReject(a)">반려</v-btn></div><a style="cursor:pointer; color:var(--pms-primary); text-decoration:none" @click="goWbs(a.wbsCode)"><div style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ a.wbsCode }}</div><div style="font-size:var(--pms-font-body)">{{ a.taskName }}</div></a></div>
                  </div>
                </template>
                <template v-else-if="wid === 'myTasks'">
                  <div class="widget-hd" @click="widgetExpanded.myTasks = !widgetExpanded.myTasks"><v-icon size="14" class="mr-1">{{ widgetExpanded.myTasks ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" class="mr-1">mdi-clipboard-check</v-icon>내 진행 태스크<v-chip size="x-small" variant="tonal" class="ml-1">{{ data.myTasks?.length || 0 }}</v-chip></div>
                  <div v-if="widgetExpanded.myTasks" class="widget-bd pa-0" style="max-height:300px; overflow-y:auto">
                    <div v-for="t in data.myTasks" :key="t.taskId" class="task-item" @click="goWbs(t.wbsCode)"><div class="d-flex align-center mb-1"><v-chip v-if="t.phase" :color="getPhaseColor(t.phase)" size="x-small" variant="tonal" class="mr-1">{{ t.phase }}</v-chip><span style="font-size:var(--pms-font-body); font-weight:500">{{ t.taskName }}</span></div><div class="d-flex align-center ga-2" style="font-size:var(--pms-font-mini); color:var(--pms-text-secondary)"><span :style="{ color: isOverdue(t.planEnd) ? 'var(--pms-error)' : '' }">{{ fmtDate(t.planStart) }} ~ {{ fmtDate(t.planEnd) }}</span><v-spacer /><span style="color:var(--pms-primary)">계획 {{ t.progressRate }}%</span><span style="color:var(--pms-success)">실적 {{ t.actualRate||0 }}%</span></div></div>
                    <div v-if="!data.myTasks?.length" class="text-center pa-4" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">진행 태스크 없음</div>
                  </div>
                </template>
                <template v-else-if="wid === 'schedule'">
                  <div class="widget-hd" @click="widgetExpanded.schedule = !widgetExpanded.schedule"><v-icon size="14" class="mr-1">{{ widgetExpanded.schedule ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" color="deep-purple" class="mr-1">mdi-calendar-star</v-icon>일정/마일스톤<v-spacer /><v-btn variant="text" size="x-small" :to="`/projects/${data.project?.projectId}/calendar`" @click.stop>전체보기</v-btn></div>
                  <div v-if="widgetExpanded.schedule" class="widget-bd pa-0" style="max-height:320px; overflow-y:auto">
                    <div v-if="data.milestones?.length" class="px-3 pt-2 pb-1" style="font-size:var(--pms-font-caption); font-weight:700; color:var(--pms-text-secondary)"><v-icon size="12" class="mr-1">mdi-flag-checkered</v-icon>마일스톤</div>
                    <div v-for="ms in data.milestones" :key="'ms-'+ms.milestoneId" class="sched-item" @click="router.push(`/projects/${data.project?.projectId}/calendar`)"><span class="sched-dot" :style="{ background: ({'감리':'#FB8C00','보고':'#1E88E5','이행':'#43A047','기타':'#9E9E9E'})[ms.milestoneType as string] || '#E53935' }" /><div style="flex:1; min-width:0"><div class="sched-title">{{ ms.milestoneName }}</div><div class="sched-sub">{{ fmtDate(ms.dueDate) }} · {{ ms.milestoneType }}</div></div><v-chip :color="({'예정':'info','완료':'success','지연':'error'})[ms.status as string]||'grey'" size="x-small" variant="tonal">{{ ms.status }}</v-chip></div>
                    <div v-if="data.upcomingEvents?.length" class="px-3 pt-2 pb-1" style="font-size:var(--pms-font-caption); font-weight:700; color:var(--pms-text-secondary)"><v-icon size="12" class="mr-1">mdi-calendar</v-icon>예정 이벤트</div>
                    <div v-for="ev in data.upcomingEvents" :key="'ev-'+ev.eventId" class="sched-item" @click="router.push(`/projects/${data.project?.projectId}/calendar`)"><span class="sched-dot" :style="{ background: ev.color || '#5C6BC0' }" /><div style="flex:1; min-width:0"><div class="sched-title">{{ ev.title }}</div><div class="sched-sub">{{ fmtDate(ev.eventDate) }} · {{ ({'meeting':'회의','audit':'감리','release':'릴리즈','holiday':'휴무','other':'기타'})[ev.eventType as string] || ev.eventType }}</div></div></div>
                    <div v-if="!data.milestones?.length && !data.upcomingEvents?.length" class="text-center pa-4" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">등록된 일정 없음</div>
                  </div>
                </template>
              </div>
          </div>
        </v-col>

        <!-- ═══ 우측 컬럼 ═══ -->
        <v-col cols="12" md="6">
          <!-- 미읽은 알림 (시스템, 고정) -->
          <div v-if="data.unreadNotifications?.length" class="widget mb-2" style="border-left:3px solid #E53935">
            <div class="widget-hd"><v-icon size="14" color="error" class="mr-1">mdi-bell-ring</v-icon>새 알림<v-chip size="x-small" variant="tonal" color="error" class="ml-1">{{ data.unreadNotifications.length }}</v-chip></div>
            <div class="widget-bd pa-0" style="max-height:200px; overflow-y:auto">
              <div v-for="n in data.unreadNotifications" :key="n.notifId" class="sched-item" @click="clickNotification(n)"><span class="sched-dot" style="background:#E53935" /><div style="flex:1; min-width:0"><div class="sched-title">{{ n.title }}</div><div v-if="n.message" class="sched-sub">{{ n.message }}</div></div></div>
            </div>
          </div>
          <!-- 위젯 (고정 + 드래그) -->
          <div class="drag-column" @dragover.prevent @drop="onDropColumn($event, 'right')">
            <div v-for="wid in rightDragWidgets" :key="wid"
              class="widget mb-2 drag-widget" :style="widgetBorderStyle(wid)"
              :class="{ 'is-dragging': dragSrcId === wid, 'drag-over': dragOverId === wid && dragSrcId !== wid, 'is-pinned': widgetPinned[wid] }"
              :draggable="!widgetPinned[wid]"
              @dragstart="!widgetPinned[wid] && onDragStart($event, 'right', wid)"
              @dragend="onDragEnd"
              @dragover="!widgetPinned[wid] && onDragOverWidget($event, wid)"
              @dragleave="onDragLeaveWidget($event)"
              @drop="!widgetPinned[wid] && onDropWidget($event, 'right', wid)"
            >
              <div v-if="widgetPinned[wid]" class="drag-handle"><v-icon size="12" color="primary">mdi-pin</v-icon></div>
              <div v-else class="drag-handle"><v-icon size="12" color="grey">mdi-drag-horizontal-variant</v-icon></div>
                <!-- schedule -->
                <template v-if="wid === 'schedule'">
                  <div class="widget-hd" @click="widgetExpanded.schedule = !widgetExpanded.schedule"><v-icon size="14" class="mr-1">{{ widgetExpanded.schedule ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" color="deep-purple" class="mr-1">mdi-calendar-star</v-icon>일정/마일스톤<v-spacer /><v-btn variant="text" size="x-small" :to="`/projects/${data.project?.projectId}/calendar`" @click.stop>전체보기</v-btn></div>
                  <div v-if="widgetExpanded.schedule" class="widget-bd pa-0" style="max-height:320px; overflow-y:auto">
                    <div v-if="data.milestones?.length" class="px-3 pt-2 pb-1" style="font-size:var(--pms-font-caption); font-weight:700; color:var(--pms-text-secondary)"><v-icon size="12" class="mr-1">mdi-flag-checkered</v-icon>마일스톤</div>
                    <div v-for="ms in data.milestones" :key="'ms-'+ms.milestoneId" class="sched-item" @click="router.push(`/projects/${data.project?.projectId}/calendar`)"><span class="sched-dot" :style="{ background: ({'감리':'#FB8C00','보고':'#1E88E5','이행':'#43A047','기타':'#9E9E9E'})[ms.milestoneType as string] || '#E53935' }" /><div style="flex:1; min-width:0"><div class="sched-title">{{ ms.milestoneName }}</div><div class="sched-sub">{{ fmtDate(ms.dueDate) }} · {{ ms.milestoneType }}</div></div><v-chip :color="({'예정':'info','완료':'success','지연':'error'})[ms.status as string]||'grey'" size="x-small" variant="tonal">{{ ms.status }}</v-chip></div>
                    <div v-if="data.upcomingEvents?.length" class="px-3 pt-2 pb-1" style="font-size:var(--pms-font-caption); font-weight:700; color:var(--pms-text-secondary)"><v-icon size="12" class="mr-1">mdi-calendar</v-icon>예정 이벤트</div>
                    <div v-for="ev in data.upcomingEvents" :key="'ev-'+ev.eventId" class="sched-item" @click="router.push(`/projects/${data.project?.projectId}/calendar`)"><span class="sched-dot" :style="{ background: ev.color || '#5C6BC0' }" /><div style="flex:1; min-width:0"><div class="sched-title">{{ ev.title }}</div><div class="sched-sub">{{ fmtDate(ev.eventDate) }} · {{ ({'meeting':'회의','audit':'감리','release':'릴리즈','holiday':'휴무','other':'기타'})[ev.eventType as string] || ev.eventType }}</div></div></div>
                    <div v-if="!data.milestones?.length && !data.upcomingEvents?.length" class="text-center pa-4" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">등록된 일정 없음</div>
                  </div>
                </template>
                <template v-else-if="wid === 'progress'">
                  <div class="widget-hd" @click="widgetExpanded.progress = !widgetExpanded.progress"><v-icon size="14" class="mr-1">{{ widgetExpanded.progress ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" color="primary" class="mr-1">mdi-chart-donut</v-icon>전체 진척률<v-spacer /><span v-if="!widgetExpanded.progress" class="widget-summary">계획 {{ data.totalPlanProgress || 0 }}% · 실적 {{ data.totalActualProgress || 0 }}%</span></div>
                  <div v-if="widgetExpanded.progress" class="widget-bd">
                    <div class="progress-cards">
                      <div class="progress-card">
                        <div class="progress-card-label">계획</div>
                        <div class="progress-card-value" style="color:#424242">{{ data.totalPlanProgress || 0 }}%</div>
                      </div>
                      <div class="progress-card">
                        <div class="progress-card-label">실적</div>
                        <div class="progress-card-value" style="color:#1976D2">{{ data.totalActualProgress || 0 }}%</div>
                      </div>
                      <div class="progress-card">
                        <div class="progress-card-label">계획대비</div>
                        <div class="progress-card-value" :style="{ color: (data.totalActualProgress||0) >= (data.totalPlanProgress||0) ? '#2E7D32' : '#C62828' }">
                          {{ ((data.totalActualProgress||0) - (data.totalPlanProgress||0)).toFixed(1) }}%p
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else-if="wid === 'bizProgress'">
                  <div class="widget-hd" @click="widgetExpanded.bizProgress = !widgetExpanded.bizProgress"><v-icon size="14" class="mr-1">{{ widgetExpanded.bizProgress ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" color="indigo" class="mr-1">mdi-chart-bar</v-icon>업무별 진척률</div>
                  <div v-if="widgetExpanded.bizProgress" class="widget-bd">
                    <div v-for="b in data.businessProgress" :key="b.wbsCode" class="mb-2"><div class="d-flex justify-space-between mb-1"><span style="font-size:var(--pms-font-body); font-weight:500">{{ b.taskName }}</span><span style="font-size:var(--pms-font-caption)"><span style="color:var(--pms-primary)">계획 {{ b.progress }}%</span> · <span style="color:var(--pms-success)">실적 {{ b.actualProgress }}%</span><span v-if="b.bizWeight" class="text-grey ml-1">({{ b.bizWeight }}%)</span></span></div><div class="d-flex ga-1"><v-progress-linear :model-value="b.progress" color="primary" height="5" rounded style="flex:1" /><v-progress-linear :model-value="b.actualProgress" color="success" height="5" rounded style="flex:1" /></div></div>
                    <div v-if="!data.businessProgress?.length" class="text-center pa-3" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">등록된 업무가 없습니다.</div>
                  </div>
                </template>
                <template v-else-if="wid === 'roomBookings'">
                  <div class="widget-hd" @click="widgetExpanded.roomBookings = !widgetExpanded.roomBookings"><v-icon size="14" class="mr-1">{{ widgetExpanded.roomBookings ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" color="teal" class="mr-1">mdi-door</v-icon>오늘 회의실 예약<v-chip size="x-small" variant="tonal" color="teal" class="ml-1">{{ data.todayBookings?.length || 0 }}</v-chip><v-spacer /><v-btn variant="text" size="x-small" :to="`/projects/${data.project?.projectId}/resources?tab=rooms`" @click.stop>전체보기</v-btn></div>
                  <div v-if="widgetExpanded.roomBookings" class="widget-bd pa-0" style="max-height:220px; overflow-y:auto"><div v-for="b in data.todayBookings" :key="b.bookingId" class="booking-item">
                      <v-icon size="12" color="teal" class="mr-1">mdi-clock-outline</v-icon>
                      <span class="booking-time">{{ b.startTime }} ~ {{ b.endTime }}</span>
                      <v-chip size="x-small" color="teal" variant="flat" class="mx-1" style="font-weight:700">{{ b.roomName }}</v-chip>
                      <span class="booking-title-inline">{{ b.title }}</span>
                      <v-spacer />
                      <v-icon size="11" class="mr-1">mdi-account</v-icon>
                      <span class="booking-booker-inline">{{ b.bookerName }}</span>
                    </div><div v-if="!data.todayBookings?.length" class="text-center pa-4" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">오늘 예약 없음</div></div>
                </template>
                <template v-else-if="wid === 'miniCalendar'">
                  <div class="widget-hd" @click="widgetExpanded.miniCalendar = !widgetExpanded.miniCalendar"><v-icon size="14" class="mr-1">{{ widgetExpanded.miniCalendar ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" color="cyan-darken-1" class="mr-1">mdi-calendar-month</v-icon>프로젝트 달력<v-spacer /><v-btn variant="text" size="x-small" :to="`/projects/${data.project?.projectId}/calendar`" @click.stop>전체보기</v-btn></div>
                  <div v-if="widgetExpanded.miniCalendar" class="widget-bd pa-2">
                    <div class="d-flex align-center justify-center mb-1" style="gap:8px"><v-btn icon size="x-small" variant="text" @click="calPrev"><v-icon size="16">mdi-chevron-left</v-icon></v-btn><span style="font-size:var(--pms-font-body); font-weight:700; min-width:100px; text-align:center">{{ calYearMonth }}</span><v-btn icon size="x-small" variant="text" @click="calNext"><v-icon size="16">mdi-chevron-right</v-icon></v-btn></div>
                    <div class="cal-grid"><div v-for="d in CAL_DAYS" :key="d" class="cal-hd" :class="{ 'cal-sun': d === '일', 'cal-sat': d === '토' }">{{ d }}</div></div>
                    <div v-for="(row, ri) in calGrid" :key="ri" class="cal-grid"><div v-for="cell in row" :key="cell.key" class="cal-cell" :class="{ 'cal-today': cell.isToday, 'cal-selected': calSelectedDate === cell.key, 'cal-empty': !cell.date, 'cal-sun': cell.isWeekend && row.indexOf(cell) % 7 === 0, 'cal-sat': cell.isWeekend && row.indexOf(cell) % 7 === 6 }" @click="calClickDate(cell)"><span v-if="cell.date" class="cal-date">{{ cell.date }}</span><div v-if="cell.events.length" class="cal-dots"><span v-for="(ev, ei) in cell.events.slice(0, 3)" :key="ei" class="cal-dot" :style="{ background: ev.color }"></span></div></div></div>
                    <div v-if="calSelectedDate" class="mt-2 pt-2" style="border-top:1px solid var(--pms-border-light, #eee)"><div style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">{{ calSelectedDate }} 일정</div><div v-if="!calSelectedEvents.length" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">일정 없음</div><div v-for="(ev, i) in calSelectedEvents" :key="i" class="d-flex align-center mb-1" style="gap:4px"><span class="cal-dot" :style="{ background: ev.color }"></span><span style="font-size:var(--pms-font-caption); font-weight:500">{{ ev.title }}</span><span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ ev.sub }}</span></div></div>
                  </div>
                </template>
                <template v-else-if="wid === 'recentIssues'">
                  <div class="widget-hd" @click="widgetExpanded.recentIssues = !widgetExpanded.recentIssues"><v-icon size="14" class="mr-1">{{ widgetExpanded.recentIssues ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" color="error" class="mr-1">mdi-alert-circle</v-icon>이슈 현황<v-chip size="x-small" variant="tonal" color="error" class="ml-1">{{ data.recentIssues?.length || 0 }}</v-chip><v-spacer /><v-btn variant="text" size="x-small" @click.stop="goIssueRisk">전체보기</v-btn></div>
                  <div v-if="widgetExpanded.recentIssues" class="widget-bd pa-0" style="max-height:220px; overflow-y:auto">
                    <div v-for="i in data.recentIssues" :key="i.issueId" class="ir-item" @click="router.push(`/projects/${data.project?.projectId}/issue-risk?tab=issue`)"><div class="d-flex align-center ga-1"><v-chip :color="statusColor[i.status]||'grey'" size="x-small" variant="tonal">{{ i.status }}</v-chip><v-chip v-if="i.category" size="x-small" variant="outlined">{{ i.category }}</v-chip><v-spacer /><span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ fmtDate(i.identifiedAt || i.createdAt) }}</span></div><div style="font-size:var(--pms-font-body); font-weight:500; margin-top:2px">{{ i.issueTitle }}</div><div style="font-size:var(--pms-font-mini); color:var(--pms-text-secondary)"><span v-if="i.assigneeName"><v-icon size="10">mdi-account</v-icon> {{ i.assigneeName }}</span><span v-if="i.importance" class="ml-1">중요도:{{ i.importance }}</span></div></div>
                    <div v-if="!data.recentIssues?.length" class="text-center pa-4" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">미해결 이슈 없음</div>
                  </div>
                </template>
                <template v-else-if="wid === 'recentRisks'">
                  <div class="widget-hd" @click="widgetExpanded.recentRisks = !widgetExpanded.recentRisks"><v-icon size="14" class="mr-1">{{ widgetExpanded.recentRisks ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" color="warning" class="mr-1">mdi-shield-alert</v-icon>리스크 현황<v-chip size="x-small" variant="tonal" color="warning" class="ml-1">{{ data.recentRisks?.length || 0 }}</v-chip><v-spacer /><v-btn variant="text" size="x-small" @click.stop="router.push(`/projects/${data.project?.projectId}/issue-risk?tab=risk`)">전체보기</v-btn></div>
                  <div v-if="widgetExpanded.recentRisks" class="widget-bd pa-0" style="max-height:220px; overflow-y:auto">
                    <div v-for="r in data.recentRisks" :key="r.riskId" class="ir-item" @click="router.push(`/projects/${data.project?.projectId}/issue-risk?tab=risk`)"><div class="d-flex align-center ga-1"><v-chip :color="statusColor[r.status]||'grey'" size="x-small" variant="tonal">{{ r.status }}</v-chip><v-chip :color="getLevelColor(r.impactLevel)" size="x-small" variant="tonal">{{ r.impactLevel }}</v-chip><v-spacer /><span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ fmtDate(r.identifiedAt || r.createdAt) }}</span></div><div style="font-size:var(--pms-font-body); font-weight:500; margin-top:2px">{{ r.riskName }}</div></div>
                    <div v-if="!data.recentRisks?.length" class="text-center pa-4" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">미해결 리스크 없음</div>
                  </div>
                </template>
                <template v-else-if="wid === 'pendingApprovals' && data.pendingApprovals?.length">
                  <div class="widget-hd" @click="widgetExpanded.pendingApprovals = !widgetExpanded.pendingApprovals"><v-icon size="14" class="mr-1">{{ widgetExpanded.pendingApprovals ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" color="orange" class="mr-1">mdi-clipboard-clock</v-icon>승인 대기<v-chip size="x-small" variant="tonal" color="orange" class="ml-1">{{ data.pendingApprovals.length }}</v-chip><v-spacer /><v-btn variant="text" size="x-small" color="orange-darken-2" prepend-icon="mdi-check-all" @click.stop="openBulkDialog">일괄승인</v-btn></div>
                  <div v-if="widgetExpanded.pendingApprovals" class="widget-bd pa-0" style="max-height:300px; overflow-y:auto"><div v-for="a in data.pendingApprovals" :key="a.approvalId" class="approval-item"><div class="d-flex align-center mb-1"><span style="font-size:var(--pms-font-body); font-weight:600">{{ a.docName }}</span><v-spacer /><v-btn size="x-small" color="success" variant="tonal" class="mr-1" @click="quickApprove(a)">승인</v-btn><v-btn size="x-small" color="error" variant="text" @click="quickReject(a)">반려</v-btn></div><a style="cursor:pointer; color:var(--pms-primary); text-decoration:none" @click="goWbs(a.wbsCode)"><div style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ a.wbsCode }}</div><div style="font-size:var(--pms-font-body)">{{ a.taskName }}</div></a></div></div>
                </template>
                <template v-else-if="wid === 'myTasks'">
                  <div class="widget-hd" @click="widgetExpanded.myTasks = !widgetExpanded.myTasks"><v-icon size="14" class="mr-1">{{ widgetExpanded.myTasks ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" class="mr-1">mdi-clipboard-check</v-icon>내 진행 태스크<v-chip size="x-small" variant="tonal" class="ml-1">{{ data.myTasks?.length || 0 }}</v-chip></div>
                  <div v-if="widgetExpanded.myTasks" class="widget-bd pa-0" style="max-height:300px; overflow-y:auto">
                    <div v-for="t in data.myTasks" :key="t.taskId" class="task-item" @click="goWbs(t.wbsCode)"><div class="d-flex align-center mb-1"><v-chip v-if="t.phase" :color="getPhaseColor(t.phase)" size="x-small" variant="tonal" class="mr-1">{{ t.phase }}</v-chip><span style="font-size:var(--pms-font-body); font-weight:500">{{ t.taskName }}</span></div><div class="d-flex align-center ga-2" style="font-size:var(--pms-font-mini); color:var(--pms-text-secondary)"><span :style="{ color: isOverdue(t.planEnd) ? 'var(--pms-error)' : '' }">{{ fmtDate(t.planStart) }} ~ {{ fmtDate(t.planEnd) }}</span><v-spacer /><span style="color:var(--pms-primary)">계획 {{ t.progressRate }}%</span><span style="color:var(--pms-success)">실적 {{ t.actualRate||0 }}%</span></div></div>
                    <div v-if="!data.myTasks?.length" class="text-center pa-4" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">진행 태스크 없음</div>
                  </div>
                </template>
                <template v-else-if="wid === 'notices'">
                  <div class="widget-hd" @click="widgetExpanded.notices = !widgetExpanded.notices"><v-icon size="14" class="mr-1">{{ widgetExpanded.notices ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon><v-icon size="14" class="mr-1">mdi-bullhorn</v-icon>공지사항<v-spacer /><v-btn variant="text" size="x-small" :to="`/projects/${data.project?.projectId}/notices`" @click.stop>전체보기</v-btn></div>
                  <div v-if="widgetExpanded.notices" class="widget-bd pa-0" style="max-height:200px; overflow-y:auto">
                    <div v-for="n in data.notices" :key="n.noticeId" class="notice-item" :class="{ 'notice-new': isNewNotice(n) }" @click="router.push(`/projects/${data.project?.projectId}/notices`)"><div class="notice-flag" :style="{ background: noticeBoardColor(n.boardId) }"></div><v-icon v-if="n.isPinned" color="error" size="12" class="mr-1">mdi-pin</v-icon><v-chip v-if="n.boardName" size="x-small" variant="flat" :style="{ background: noticeBoardColor(n.boardId), color: '#fff' }" class="mr-1">{{ n.boardName }}</v-chip><span style="font-size:var(--pms-font-body)">{{ n.title }}</span><span v-if="isNewNotice(n)" class="new-badge ml-1">NEW</span><span class="ml-auto" style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ fmtDate(n.createdAt) }}</span></div>
                    <div v-if="!data.notices?.length" class="text-center pa-4" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">공지 없음</div>
                  </div>
                </template>
              </div>
          </div>
        </v-col>
      </v-row>
    </template>
    <!-- 위젯 설정 다이얼로그 -->
    <v-dialog v-model="settingsDialog" max-width="400">
      <v-card class="pms-form">
        <v-card-title class="d-flex align-center" style="font-size:13px; font-weight:600">
          <v-icon size="16" class="mr-1">mdi-cog</v-icon>위젯 설정
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-3">
          <div style="font-size:var(--pms-font-caption); color:var(--pms-text-hint); margin-bottom:8px">표시할 위젯을 선택하세요. 📌 클릭으로 상단 고정/해제 할 수 있습니다.</div>
          <div v-for="w in WIDGET_DEFS" :key="w.id" class="d-flex align-center py-1" style="border-bottom:1px solid var(--pms-border-light)">
            <v-checkbox v-model="widgetVisible[w.id]" hide-details density="compact" class="mt-0 pt-0" @update:model-value="saveWidgetSettings" />
            <v-icon :color="w.color || 'grey'" size="14" class="mr-1">{{ w.icon }}</v-icon>
            <span style="font-size:var(--pms-font-body)">{{ w.label }}</span>
            <v-btn
              size="x-small"
              variant="text"
              class="ml-auto"
              :color="widgetPinned[w.id] ? 'primary' : 'default'"
              :title="widgetPinned[w.id] ? '고정 해제' : '상단 고정'"
              @click="togglePinned(w.id)"
            >
              <v-icon size="14">{{ widgetPinned[w.id] ? 'mdi-pin' : 'mdi-pin-outline' }}</v-icon>
              <span style="font-size:10px; margin-left:2px">{{ widgetPinned[w.id] ? '고정' : '해제' }}</span>
            </v-btn>
          </div>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-4 py-2">
          <v-spacer />
          <v-btn size="small" variant="outlined" @click="settingsDialog = false">닫기</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 일괄승인 다이얼로그 -->
    <BulkApprovalDialog
      v-if="data?.project?.projectId"
      v-model="bulkDialog"
      :project-id="data.project.projectId"
      :items="data.pendingApprovals || []"
      @approved="onBulkApproved"
    />
  </MainLayout>
</template>

<style scoped>
/* 캐치프레이즈 */
.catchphrase-card {
  border-radius: var(--pms-radius); overflow: hidden;
  border: 1px solid var(--pms-border);
  background: var(--pms-surface);
}
.catchphrase-img {
  width: 100%; display: block; object-fit: cover;
  max-height: 220px;
}

.progress-ring { width: 90px; height: 90px; }
.progress-ring svg { width: 100%; height: 100%; }
.progress-ring-sm { width: 65px; height: 65px; }
.progress-ring-sm svg { width: 100%; height: 100%; }

/* 통계 미니 카드 */
.stat-mini-card { background: var(--pms-surface); border: 1px solid var(--pms-border); border-radius: var(--pms-radius); padding: 10px 14px; }
.smc-num { font-size: 20px; font-weight: 700; color: var(--pms-text-primary); }
.smc-label { font-size: var(--pms-font-caption); color: var(--pms-text-secondary); }

/* 위젯 */
.widget { border: 1px solid var(--pms-border); border-radius: var(--pms-radius); overflow: hidden; background: var(--pms-surface); }
.widget-hd {
  display: flex; align-items: center; padding: 6px 10px; cursor: pointer; user-select: none;
  font-size: var(--pms-font-body); font-weight: 600; background: var(--pms-surface-variant);
  border-bottom: 1px solid var(--pms-border-light); transition: background 0.15s;
}
.widget-hd:hover { background: var(--pms-surface-hover); }
.widget-summary { font-size: var(--pms-font-caption); font-weight: 400; color: var(--pms-text-secondary); }
.widget-bd { padding: 8px 10px; }

/* 공지 아이템 */
.notice-item { display: flex; align-items: center; padding: 5px 10px 5px 14px; border-bottom: 1px solid var(--pms-border-light); cursor: pointer; transition: background 0.15s; position: relative; }
.notice-item:hover { background: var(--pms-surface-hover); }
.notice-item.notice-new { background: rgba(30, 136, 229, 0.04); }
.notice-flag { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
.new-badge {
  display: inline-block; font-size: 8px; font-weight: 700; color: #fff;
  background: #E53935; border-radius: 3px; padding: 0 3px; line-height: 14px;
  animation: newPulse 2s ease-in-out infinite; flex-shrink: 0;
}
@keyframes newPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

/* 드래그 */
.drag-column { min-height: 40px; }
.drag-widget { position: relative; }
.drag-widget.is-dragging { opacity: 0.3; }
.drag-widget.drag-over { border-top: 3px solid var(--pms-primary, #1E88E5) !important; margin-top: -3px; }
.drag-handle {
  position: absolute; top: 0; left: 0; right: 0; height: 8px;
  cursor: grab; display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.2s; z-index: 1;
}
.drag-widget:hover .drag-handle { opacity: 1; }
.drag-handle:active { cursor: grabbing; }

/* 미니 캘린더 */
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0; }
.cal-hd { text-align: center; font-size: 10px; font-weight: 600; color: var(--pms-text-hint); padding: 2px 0; }
.cal-hd.cal-sun { color: #E53935; }
.cal-hd.cal-sat { color: #1E88E5; }
.cal-cell {
  text-align: center; padding: 3px 0; min-height: 32px; cursor: pointer;
  border-radius: var(--pms-radius); transition: background 0.12s; position: relative;
}
.cal-cell:hover:not(.cal-empty) { background: var(--pms-hover, #f5f5f5); }
.cal-cell.cal-empty { cursor: default; }
.cal-cell.cal-today .cal-date {
  background: #1E88E5; color: #fff; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; font-weight: 700;
}
.cal-cell.cal-selected { background: rgba(30, 136, 229, 0.1); }
.cal-cell.cal-sun .cal-date { color: #E53935; }
.cal-cell.cal-sat .cal-date { color: #1E88E5; }
.cal-cell.cal-today.cal-sun .cal-date, .cal-cell.cal-today.cal-sat .cal-date { color: #fff; }
.cal-date { font-size: 11px; font-weight: 500; line-height: 1; }
.cal-dots { display: flex; justify-content: center; gap: 2px; margin-top: 1px; }
.cal-dot { width: 4px; height: 4px; border-radius: 50%; flex-shrink: 0; }

/* 이슈/리스크 아이템 */
.ir-item { padding: 6px 10px; border-bottom: 1px solid var(--pms-border-light); cursor: pointer; transition: background 0.15s; }
.ir-item:hover { background: var(--pms-surface-hover); }

/* 승인 아이템 */
.approval-item { padding: 8px 10px; border-bottom: 1px solid var(--pms-border-light); }

/* 태스크 아이템 */
.task-item { padding: 6px 10px; border-bottom: 1px solid var(--pms-border-light); cursor: pointer; transition: background 0.15s; }
.task-item:hover { background: var(--pms-surface-hover); }

/* 일정/마일스톤 아이템 */
.sched-item { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--pms-border-light); cursor: pointer; transition: background 0.15s; }
.sched-item:hover { background: var(--pms-surface-hover); }
.sched-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sched-title { font-size: var(--pms-font-body); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sched-sub { font-size: var(--pms-font-mini); color: var(--pms-text-hint); }

/* 회의실 예약 — 한 행 표시 */
.booking-item {
  display: flex; align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--pms-border-light);
  transition: background 0.15s;
  font-size: var(--pms-font-body);
}
.booking-item:hover { background: var(--pms-surface-hover); }
.booking-time {
  font-weight: 700;
  color: #00897B;
  white-space: nowrap;
}
.booking-title-inline {
  font-weight: 600;
  color: var(--pms-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.booking-booker-inline {
  color: var(--pms-text-primary);
  font-weight: 500;
  white-space: nowrap;
}

/* 전체 진척률 — 숫자 카드 */
.progress-cards {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  padding: 4px;
}
.progress-card {
  background: var(--pms-surface-variant, #f5f5f5);
  border-radius: 8px;
  padding: 12px 8px;
  text-align: center;
}
.progress-card-label {
  font-size: var(--pms-font-label);
  color: var(--pms-text-secondary);
  margin-bottom: 4px;
  font-weight: 500;
}
.progress-card-value {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
</style>
