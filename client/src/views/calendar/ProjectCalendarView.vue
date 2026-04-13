<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import { calendarService } from '@/services/calendar'
import { milestoneService } from '@/services/milestones'
import { projectService } from '@/services/projects'
import { useDialog } from '@/composables/useDialog'
import { isWeekend, isHoliday, getHolidayName } from '@/utils/holidays'

const { showAlert, showConfirm } = useDialog()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)

const project = ref<any>(null)
const myRole = ref<any>(null)
const isPmsAdmin = computed(() => myRole.value?.isPmsAdmin || false)

const currentYear = ref(new Date().getFullYear())
const currentMonth = ref(new Date().getMonth() + 1)
const loading = ref(false)

const events = ref<any[]>([])
const milestones = ref<any[]>([])       // 해당 월
const allMilestones = ref<any[]>([])    // 전체 (타임라인용)

// 이벤트 다이얼로그
const eventDialog = ref(false)
const eventEditMode = ref(false)
const eventForm = ref({ eventId: 0, title: '', eventType: 'other', eventDate: '', endDate: '', color: '', description: '' })

// 마일스톤 다이얼로그
const msDialog = ref(false)
const msEditMode = ref(false)
const msForm = ref({ milestoneId: 0, milestoneName: '', dueDate: '', milestoneType: '기타', status: '예정', description: '' })

// 날짜 상세
const dayDetailDialog = ref(false)
const selectedDate = ref('')
const selectedDayEvents = ref<any[]>([])

const eventTypes = [
  { title: '회의', value: 'meeting' },
  { title: '감리', value: 'audit' },
  { title: '릴리즈', value: 'release' },
  { title: '휴무', value: 'holiday' },
  { title: '기타', value: 'other' },
]
const eventTypeColor: Record<string, string> = {
  meeting: '#1E88E5', audit: '#FB8C00', release: '#43A047', holiday: '#757575', other: '#5C6BC0',
}
const msTypeColor: Record<string, string> = {
  '감리': '#FB8C00', '보고': '#1E88E5', '이행': '#43A047', '기타': '#9E9E9E',
}
const msStatusColor: Record<string, string> = { '예정': 'info', '완료': 'success', '지연': 'error' }
const msTypes = ['감리', '보고', '이행', '기타']
const msStatuses = ['예정', '완료', '지연']
const msFormCompleted = computed({
  get: () => msForm.value.status === '완료',
  set: (v: boolean) => { msForm.value.status = v ? '완료' : '예정' },
})

const colorPalette = [
  { value: '#E53935', label: '빨강' }, { value: '#D81B60', label: '핑크' },
  { value: '#8E24AA', label: '보라' }, { value: '#5C6BC0', label: '인디고' },
  { value: '#1E88E5', label: '파랑' }, { value: '#039BE5', label: '하늘' },
  { value: '#00ACC1', label: '청록' }, { value: '#00897B', label: '틸' },
  { value: '#43A047', label: '초록' }, { value: '#7CB342', label: '연두' },
  { value: '#F9A825', label: '노랑' }, { value: '#FB8C00', label: '주황' },
  { value: '#F4511E', label: '딥오렌지' }, { value: '#6D4C41', label: '갈색' },
  { value: '#757575', label: '회색' }, { value: '#546E7A', label: '청회' },
]

// ── 타임라인 계산 ──
const timelineMonths = computed(() => {
  if (!project.value) return []
  const s = new Date(project.value.startDate)
  const e = new Date(project.value.endDate)
  const months: { year: number; month: number; label: string; sub: string }[] = []
  const cur = new Date(s.getFullYear(), s.getMonth(), 1)
  let seq = 1
  while (cur <= e) {
    const m = cur.getMonth() + 1
    const showYear = seq === 1 || m === 1 // 첫 월 또는 1월일 때 연도 표시
    months.push({
      year: cur.getFullYear(),
      month: m,
      label: showYear ? `${cur.getFullYear()}.${m}월` : `${m}월`,
      sub: `M${seq}`,
    })
    cur.setMonth(cur.getMonth() + 1)
    seq++
  }
  return months
})

const timelineTotalMonths = computed(() => timelineMonths.value.length || 1)

function getMsTimelinePos(dueDate: string) {
  if (!project.value || !timelineMonths.value.length) return 0
  const s = new Date(project.value.startDate)
  const e = new Date(project.value.endDate)
  const d = new Date(dueDate)
  const totalMs = e.getTime() - s.getTime()
  if (totalMs <= 0) return 0
  return Math.max(0, Math.min(100, ((d.getTime() - s.getTime()) / totalMs) * 100))
}

function getMsMarkerStyle(ms: any) {
  const pos = getMsTimelinePos(ms.dueDate)
  const style: any = { left: pos + '%' }
  // 시작 근처: 좌측 정렬 (겹침 방지)
  if (pos < 8) {
    style.transform = 'translateX(0)'
    style.alignItems = 'flex-start'
  }
  // 끝 근처: 우측 정렬 (잘림 방지)
  else if (pos > 92) {
    style.transform = 'translateX(-100%)'
    style.alignItems = 'flex-end'
  }
  // 중간: 중앙 정렬
  else {
    style.transform = 'translateX(-50%)'
  }
  return style
}

// 현재 월이 타임라인에서 어디인지
function isCurrentTimelineMonth(tm: { year: number; month: number }) {
  return tm.year === currentYear.value && tm.month === currentMonth.value
}

// ── 달력 ──
const calendarDays = computed(() => {
  const y = currentYear.value, m = currentMonth.value - 1
  const firstDay = new Date(y, m, 1), lastDay = new Date(y, m + 1, 0)
  const startDow = firstDay.getDay()
  const days: { date: string; day: number; inMonth: boolean; isToday: boolean }[] = []
  for (let i = 0; i < startDow; i++) {
    const d = new Date(y, m, -(startDow - 1 - i)); days.push({ date: fmt(d), day: d.getDate(), inMonth: false, isToday: false })
  }
  const todayStr = fmt(new Date())
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dt = new Date(y, m, d); const dateStr = fmt(dt)
    days.push({ date: dateStr, day: d, inMonth: true, isToday: dateStr === todayStr })
  }
  const remaining = 42 - days.length
  for (let i = 1; i <= remaining; i++) {
    const d = new Date(y, m + 1, i); days.push({ date: fmt(d), day: d.getDate(), inMonth: false, isToday: false })
  }
  return days
})

const dateEventsMap = computed(() => {
  const map = new Map<string, any[]>()
  for (const e of events.value) {
    const d = e.eventDate?.substring(0, 10); if (!d) continue
    if (!map.has(d)) map.set(d, [])
    map.get(d)!.push({ ...e, _type: 'event', _color: e.color || eventTypeColor[e.eventType] || '#5C6BC0' })
  }
  for (const m of milestones.value) {
    const d = m.dueDate?.substring(0, 10); if (!d) continue
    if (!map.has(d)) map.set(d, [])
    map.get(d)!.push({ ...m, _type: 'milestone', _color: msTypeColor[m.milestoneType] || '#E53935', title: m.milestoneName })
  }
  return map
})

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fmtDate(d: string | null) { return d ? d.substring(0, 10) : '-' }

function getDayClass(day: any): string {
  const cls: string[] = []
  if (!day.inMonth) cls.push('cal-other-month')
  if (day.isToday) cls.push('cal-today')
  if (isWeekend(day.date)) cls.push('cal-weekend')
  if (isHoliday(day.date)) cls.push('cal-holiday')
  return cls.join(' ')
}
function getDayTextColor(dateStr: string): string {
  if (isHoliday(dateStr)) return '#E53935'
  const dow = new Date(dateStr + 'T00:00:00').getDay()
  if (dow === 0) return '#E53935'
  if (dow === 6) return '#1565C0'
  return ''
}

// ── 데이터 로딩 ──
async function fetchData() {
  loading.value = true
  try {
    const res = await calendarService.getData(projectId, { year: currentYear.value, month: currentMonth.value })
    if (res.success) {
      events.value = res.data.events || []
      milestones.value = res.data.milestones || []
      allMilestones.value = res.data.allMilestones || []
      if (res.data.project && !project.value) {
        project.value = { ...project.value, ...res.data.project }
      }
    }
  } catch (err) { console.error(err) }
  finally { loading.value = false }
}

function prevMonth() { if (currentMonth.value === 1) { currentMonth.value = 12; currentYear.value-- } else currentMonth.value-- }
function nextMonth() { if (currentMonth.value === 12) { currentMonth.value = 1; currentYear.value++ } else currentMonth.value++ }
function goToday() { currentYear.value = new Date().getFullYear(); currentMonth.value = new Date().getMonth() + 1 }
function goMonth(tm: { year: number; month: number }) { currentYear.value = tm.year; currentMonth.value = tm.month }

watch([currentYear, currentMonth], fetchData)

// ── 날짜 클릭 ──
function onDayClick(day: any) {
  selectedDate.value = day.date
  const dayEvents = dateEventsMap.value.get(day.date) || []
  const hName = getHolidayName(day.date)
  selectedDayEvents.value = hName ? [{ _type: 'holiday', title: hName, _color: '#E53935' }, ...dayEvents] : dayEvents
  dayDetailDialog.value = true
}

// ── 이벤트 CRUD ──
function openCreateEvent(date?: string) {
  eventEditMode.value = false
  eventForm.value = { eventId: 0, title: '', eventType: 'other', eventDate: date || fmt(new Date()), endDate: '', color: '#5C6BC0', description: '' }
  dayDetailDialog.value = false; eventDialog.value = true
}
function openEditEvent(ev: any) {
  eventEditMode.value = true
  eventForm.value = { eventId: ev.eventId, title: ev.title, eventType: ev.eventType || 'other', eventDate: ev.eventDate?.substring(0, 10) || '', endDate: ev.endDate?.substring(0, 10) || '', color: ev.color || '', description: ev.description || '' }
  dayDetailDialog.value = false; eventDialog.value = true
}
async function saveEvent() {
  if (!eventForm.value.title || !eventForm.value.eventDate) { await showAlert('제목과 날짜는 필수입니다.', { color: 'error' }); return }
  try {
    if (eventEditMode.value) await calendarService.updateEvent(projectId, eventForm.value.eventId, eventForm.value)
    else await calendarService.createEvent(projectId, eventForm.value)
    eventDialog.value = false; await fetchData(); await showAlert('저장되었습니다.')
  } catch (err: any) { showAlert(err?.response?.data?.message || '저장 실패', { color: 'error' }) }
}
async function deleteEvent(ev: any) {
  if (ev._type !== 'event') return
  if (!(await showConfirm('이벤트를 삭제하시겠습니까?'))) return
  try { await calendarService.removeEvent(projectId, ev.eventId); dayDetailDialog.value = false; await fetchData(); await showAlert('삭제되었습니다.') }
  catch (err: any) { showAlert(err?.response?.data?.message || '삭제 실패', { color: 'error' }) }
}
function onTypeChange() { eventForm.value.color = eventTypeColor[eventForm.value.eventType] || '#5C6BC0' }

// ── 마일스톤 CRUD ──
function openCreateMs() {
  msEditMode.value = false
  msForm.value = { milestoneId: 0, milestoneName: '', dueDate: '', milestoneType: '기타', status: '예정', description: '' }
  msDialog.value = true
}
function openEditMs(ms: any) {
  msEditMode.value = true
  msForm.value = { milestoneId: ms.milestoneId, milestoneName: ms.milestoneName, dueDate: ms.dueDate?.substring(0, 10) || '', milestoneType: ms.milestoneType, status: ms.status, description: ms.description || '' }
  dayDetailDialog.value = false; msDialog.value = true
}
async function saveMs() {
  if (!msForm.value.milestoneName || !msForm.value.dueDate) { await showAlert('명칭과 날짜는 필수입니다.', { color: 'error' }); return }
  try {
    if (msEditMode.value) await milestoneService.update(projectId, msForm.value.milestoneId, msForm.value)
    else await milestoneService.create(projectId, msForm.value)
    msDialog.value = false; await fetchData(); await showAlert('저장되었습니다.')
  } catch (err: any) { showAlert(err?.response?.data?.message || '저장 실패', { color: 'error' }) }
}
async function deleteMs(ms: any) {
  if (!(await showConfirm('마일스톤을 삭제하시겠습니까?'))) return
  try { await milestoneService.remove(projectId, ms.milestoneId); dayDetailDialog.value = false; await fetchData(); await showAlert('삭제되었습니다.') }
  catch (err: any) { showAlert(err?.response?.data?.message || '삭제 실패', { color: 'error' }) }
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
  fetchData()
})
</script>

<template>
  <MainLayout>
    <v-row class="mb-1" align="center" dense>
      <v-col cols="auto"><v-btn icon size="small" variant="text" @click="router.push(`/projects/${projectId}`)"><v-icon>mdi-arrow-left</v-icon></v-btn></v-col>
      <v-col>
        <span class="pms-page-title">프로젝트 캘린더</span>
        <span class="pms-page-subtitle">{{ project?.projectName }}</span>
      </v-col>
    </v-row>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- 마일스톤 타임라인 바 -->
    <!-- ═══════════════════════════════════════════════ -->
    <div v-if="project && timelineMonths.length" class="pms-card mb-3">
      <div class="pms-section-header d-flex align-center" style="background:#FFEBEE">
        <v-icon size="14">mdi-flag-checkered</v-icon> 마일스톤
        <v-spacer />
        <v-btn v-if="isPmsAdmin" size="x-small" color="error" variant="outlined" prepend-icon="mdi-plus" @click="openCreateMs" style="background:#fff">등록</v-btn>
      </div>
      <!-- 월 헤더 -->
      <div class="tl-row tl-header">
        <div class="tl-label">세부내용</div>
        <div class="tl-bar">
          <div v-for="tm in timelineMonths" :key="`${tm.year}-${tm.month}`"
               class="tl-month" :class="{ 'tl-month-current': isCurrentTimelineMonth(tm) }"
               :style="{ width: (100 / timelineTotalMonths) + '%' }"
               @click="goMonth(tm)">
            <div class="tl-month-main">{{ tm.label }}</div>
            <div class="tl-month-sub">{{ tm.sub }}</div>
          </div>
        </div>
      </div>
      <!-- 마일스톤 행 -->
      <div class="tl-row">
        <div class="tl-label" style="font-size:9px">주요<br/>마일스톤</div>
        <div class="tl-bar tl-ms-bar">
          <!-- 프로젝트 기간 바 -->
          <div class="tl-project-line" />
          <!-- 마일스톤 마커 -->
          <div v-for="ms in allMilestones" :key="ms.milestoneId"
               class="tl-ms-marker"
               :style="getMsMarkerStyle(ms)"
               :title="`${ms.milestoneName} (${fmtDate(ms.dueDate)})`"
               @click="openEditMs(ms)">
            <div class="tl-ms-dot" :style="{ background: msTypeColor[ms.milestoneType] || '#E53935' }" />
            <div class="tl-ms-label">{{ ms.milestoneName }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- 캘린더 헤더 -->
    <!-- ═══════════════════════════════════════════════ -->
    <div class="d-flex align-center mb-2" style="gap:8px; flex-wrap:wrap">
      <v-btn icon size="small" variant="text" @click="prevMonth"><v-icon>mdi-chevron-left</v-icon></v-btn>
      <span style="font-size:var(--pms-font-subtitle, 14px); font-weight:700; min-width:120px; text-align:center">
        {{ currentYear }}년 {{ currentMonth }}월
      </span>
      <v-btn icon size="small" variant="text" @click="nextMonth"><v-icon>mdi-chevron-right</v-icon></v-btn>
      <v-btn size="x-small" variant="outlined" @click="goToday">오늘</v-btn>
      <v-spacer />
      <v-btn v-if="isPmsAdmin" size="x-small" color="primary" prepend-icon="mdi-plus" @click="openCreateEvent()">이벤트</v-btn>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-1" />

    <!-- ═══════════════════════════════════════════════ -->
    <!-- 캘린더 그리드 -->
    <!-- ═══════════════════════════════════════════════ -->
    <div class="pms-card mb-3">
      <div class="cal-header">
        <div v-for="dow in ['일','월','화','수','목','금','토']" :key="dow" class="cal-header-cell"
             :style="{ color: dow === '일' ? '#E53935' : dow === '토' ? '#1565C0' : '' }">{{ dow }}</div>
      </div>
      <div class="cal-grid">
        <div v-for="day in calendarDays" :key="day.date" :class="['cal-cell', getDayClass(day)]" @click="onDayClick(day)">
          <div class="cal-day-num" :style="{ color: getDayTextColor(day.date) }">
            {{ day.day }}
            <span v-if="getHolidayName(day.date)" class="cal-holiday-name">{{ getHolidayName(day.date) }}</span>
          </div>
          <div class="cal-events">
            <div v-for="(ev, idx) in (dateEventsMap.get(day.date) || []).slice(0, 3)" :key="idx"
                 class="cal-event-bar" :style="{ background: ev._color }">
              <v-icon v-if="ev._type === 'milestone'" size="8" class="mr-1" style="color:#fff">mdi-flag-checkered</v-icon>
              {{ ev.title }}
            </div>
            <div v-if="(dateEventsMap.get(day.date) || []).length > 3" class="cal-event-more">
              +{{ (dateEventsMap.get(day.date) || []).length - 3 }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- 하단: 마일스톤 + 이벤트 목록 -->
    <!-- ═══════════════════════════════════════════════ -->
    <v-row dense>
      <!-- 마일스톤 목록 -->
      <v-col cols="12" md="6">
        <div class="pms-card">
          <div class="pms-section-header" style="background:#FFEBEE">
            <v-icon size="14">mdi-flag-checkered</v-icon> 마일스톤 ({{ allMilestones.length }})
          </div>
          <div v-if="!allMilestones.length" class="pa-3 text-center" style="font-size:var(--pms-font-body); color:var(--pms-text-hint)">등록된 마일스톤이 없습니다.</div>
          <div v-for="ms in allMilestones" :key="ms.milestoneId" class="d-flex align-center px-3 py-2" style="gap:8px; border-bottom:1px solid var(--pms-border-light, #eee); cursor:pointer" @click="openEditMs(ms)">
            <span :style="{ width:'8px', height:'8px', borderRadius:'50%', background: msTypeColor[ms.milestoneType] || '#E53935', flexShrink:0 }" />
            <div style="flex:1; min-width:0">
              <div style="font-size:var(--pms-font-body, 11px); font-weight:600">{{ ms.milestoneName }}</div>
              <div style="font-size:var(--pms-font-caption, 10px); color:var(--pms-text-secondary)">{{ fmtDate(ms.dueDate) }} · {{ ms.milestoneType }}</div>
            </div>
            <v-chip :color="msStatusColor[ms.status] || 'grey'" size="x-small" variant="tonal">{{ ms.status }}</v-chip>
          </div>
        </div>
      </v-col>
      <!-- 이벤트 목록 -->
      <v-col cols="12" md="6">
        <div class="pms-card">
          <div class="pms-section-header" style="background:#E3F2FD">
            <v-icon size="14">mdi-calendar-star</v-icon> 이벤트 ({{ events.length }})
          </div>
          <div v-if="!events.length" class="pa-3 text-center" style="font-size:var(--pms-font-body); color:var(--pms-text-hint)">이번 달 등록된 이벤트가 없습니다.</div>
          <div v-for="ev in events" :key="ev.eventId" class="d-flex align-center px-3 py-2" style="gap:8px; border-bottom:1px solid var(--pms-border-light, #eee); cursor:pointer" @click="openEditEvent(ev)">
            <span :style="{ width:'8px', height:'8px', borderRadius:'50%', background: ev.color || eventTypeColor[ev.eventType] || '#5C6BC0', flexShrink:0 }" />
            <div style="flex:1; min-width:0">
              <div style="font-size:var(--pms-font-body, 11px); font-weight:600">{{ ev.title }}</div>
              <div style="font-size:var(--pms-font-caption, 10px); color:var(--pms-text-secondary)">{{ fmtDate(ev.eventDate) }} · {{ eventTypes.find(t => t.value === ev.eventType)?.title || ev.eventType }}</div>
            </div>
          </div>
        </div>
      </v-col>
    </v-row>

    <!-- ═══════════════════════════════════════════════ -->
    <!-- 날짜 상세 팝업 -->
    <!-- ═══════════════════════════════════════════════ -->
    <v-dialog v-model="dayDetailDialog" max-width="420">
      <v-card>
        <v-card-title class="d-flex align-center" style="font-size:var(--pms-font-subtitle)">
          {{ selectedDate }}
          <span v-if="getHolidayName(selectedDate)" class="ml-2" style="font-size:var(--pms-font-caption); color:#E53935">{{ getHolidayName(selectedDate) }}</span>
          <v-spacer />
          <v-btn v-if="isPmsAdmin" icon size="x-small" variant="text" title="이벤트 추가" @click="openCreateEvent(selectedDate)"><v-icon>mdi-plus</v-icon></v-btn>
        </v-card-title>
        <v-divider />
        <v-card-text style="max-height:400px; overflow-y:auto">
          <div v-if="!selectedDayEvents.length" class="text-center py-4" style="color:var(--pms-text-hint); font-size:var(--pms-font-body)">등록된 일정이 없습니다.</div>
          <div v-for="(ev, idx) in selectedDayEvents" :key="idx" class="d-flex align-center py-2" style="gap:8px; border-bottom:1px solid var(--pms-border-light, #eee)">
            <span :style="{ width:'10px', height:'10px', borderRadius:'2px', background: ev._color, flexShrink:0 }" />
            <div style="flex:1; min-width:0">
              <div style="font-size:var(--pms-font-body, 11px); font-weight:600">{{ ev.title }}</div>
              <div v-if="ev.description" style="font-size:var(--pms-font-caption, 10px); color:var(--pms-text-secondary)">{{ ev.description }}</div>
              <div style="font-size:var(--pms-font-mini, 9px); color:var(--pms-text-hint)">
                <template v-if="ev._type === 'event'">{{ eventTypes.find(t => t.value === ev.eventType)?.title || ev.eventType }}</template>
                <template v-else-if="ev._type === 'milestone'">마일스톤 ({{ ev.milestoneType }}) — {{ ev.status }}</template>
              </div>
            </div>
            <template v-if="isPmsAdmin">
              <template v-if="ev._type === 'event'">
                <v-btn icon size="x-small" variant="text" @click="openEditEvent(ev)"><v-icon size="14">mdi-pencil</v-icon></v-btn>
                <v-btn icon size="x-small" variant="text" color="error" @click="deleteEvent(ev)"><v-icon size="14">mdi-delete</v-icon></v-btn>
              </template>
              <template v-if="ev._type === 'milestone'">
                <v-btn icon size="x-small" variant="text" @click="openEditMs(ev)"><v-icon size="14">mdi-pencil</v-icon></v-btn>
                <v-btn icon size="x-small" variant="text" color="error" @click="deleteMs(ev)"><v-icon size="14">mdi-delete</v-icon></v-btn>
              </template>
            </template>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- 이벤트 등록/수정 다이얼로그 -->
    <v-dialog v-model="eventDialog" max-width="460" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">{{ eventEditMode ? '이벤트 수정' : '이벤트 등록' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="eventForm.title" variant="outlined" density="compact" hide-details class="pms-form mb-3">
            <template #label>제목<span class="pms-required">*</span></template>
          </v-text-field>
          <v-select v-model="eventForm.eventType" :items="eventTypes" item-title="title" item-value="value"
                    label="유형" variant="outlined" density="compact" hide-details class="pms-form mb-3" @update:model-value="onTypeChange" />
          <v-row dense class="mb-3">
            <v-col cols="6">
              <v-text-field v-model="eventForm.eventDate" type="date" variant="outlined" density="compact" hide-details class="pms-form">
                <template #label>날짜<span class="pms-required">*</span></template>
              </v-text-field>
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="eventForm.endDate" label="종료일" type="date" variant="outlined" density="compact" hide-details class="pms-form" />
            </v-col>
          </v-row>
          <div class="mb-3">
            <div style="font-size:var(--pms-font-caption, 10px); color:var(--pms-text-secondary); margin-bottom:4px">색상</div>
            <div class="d-flex flex-wrap" style="gap:6px">
              <div v-for="c in colorPalette" :key="c.value" class="color-swatch" :class="{ 'color-selected': eventForm.color === c.value }"
                   :style="{ background: c.value }" :title="c.label" @click="eventForm.color = c.value" />
            </div>
          </div>
          <v-textarea v-model="eventForm.description" label="설명" rows="2" variant="outlined" density="compact" hide-details class="pms-form" auto-grow />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="outlined" @click="eventDialog = false">취소</v-btn>
          <v-btn size="small" color="primary" @click="saveEvent">저장</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 마일스톤 등록/수정 다이얼로그 -->
    <v-dialog v-model="msDialog" max-width="460" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">{{ msEditMode ? '마일스톤 수정' : '마일스톤 등록' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="msForm.milestoneName" variant="outlined" density="compact" hide-details class="pms-form mb-3">
            <template #label>명칭<span class="pms-required">*</span></template>
          </v-text-field>
          <v-row dense class="mb-3">
            <v-col cols="6">
              <v-select v-model="msForm.milestoneType" :items="msTypes" label="유형" variant="outlined" density="compact" hide-details class="pms-form" />
            </v-col>
            <v-col v-if="msEditMode" cols="6" class="d-flex align-center">
              <v-checkbox v-model="msFormCompleted" label="완료 처리" density="compact" hide-details />
            </v-col>
          </v-row>
          <v-text-field v-model="msForm.dueDate" type="date" variant="outlined" density="compact" hide-details class="pms-form mb-3">
            <template #label>날짜<span class="pms-required">*</span></template>
          </v-text-field>
          <v-textarea v-model="msForm.description" label="설명" rows="2" variant="outlined" density="compact" hide-details class="pms-form" auto-grow />
        </v-card-text>
        <v-card-actions>
          <v-btn v-if="msEditMode && isPmsAdmin" size="small" variant="outlined" color="error" @click="deleteMs(msForm)">삭제</v-btn>
          <v-spacer />
          <v-btn size="small" variant="outlined" @click="msDialog = false">취소</v-btn>
          <v-btn size="small" color="primary" @click="saveMs">저장</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </MainLayout>
</template>

<style scoped>
/* ── 타임라인 ── */
.tl-row { display: flex; border-bottom: 1px solid var(--pms-border-light, #eee); overflow: visible; }
.tl-label { width: 50px; min-width: 50px; font-size: 9px; font-weight: 700; padding: 4px 6px; border-right: 1px solid var(--pms-border-light, #eee); display: flex; align-items: center; justify-content: center; text-align: center; color: var(--pms-text-secondary); }
.tl-bar { flex: 1; display: flex; position: relative; min-height: 28px; }
.tl-header .tl-bar { border-bottom: none; }
.tl-month { text-align: center; padding: 2px 0; border-right: 1px solid var(--pms-border-light, #eee); cursor: pointer; color: var(--pms-text-secondary); transition: background 0.1s; }
.tl-month:hover { background: #E3F2FD; }
.tl-month-current { background: #BBDEFB !important; }
.tl-month-current .tl-month-main { color: #1565C0; font-weight: 700; }
.tl-month:last-child { border-right: none; }
.tl-month-main { font-size: 9px; font-weight: 600; line-height: 1.2; }
.tl-month-sub { font-size: 7px; color: #999; line-height: 1; }

.tl-ms-bar { position: relative; min-height: 52px; align-items: flex-start; padding-top: 4px; overflow: visible; }
.tl-project-line { position: absolute; top: 14px; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #42A5F5, #1E88E5, #FB8C00); border-radius: 2px; }
.tl-ms-marker { position: absolute; top: 4px; display: flex; flex-direction: column; align-items: center; cursor: pointer; z-index: 1; }
.tl-ms-dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 3px rgba(0,0,0,0.3); flex-shrink: 0; }
.tl-ms-label { font-size: 8px; max-width: 80px; text-align: center; color: var(--pms-text-primary, #333); margin-top: 2px; line-height: 1.2; word-break: keep-all; overflow-wrap: break-word; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* ── 캘린더 ── */
.cal-header { display: grid; grid-template-columns: repeat(7, 1fr); border-bottom: 2px solid var(--pms-border, #ccc); }
.cal-header-cell { text-align: center; font-size: var(--pms-font-caption, 10px); font-weight: 700; padding: 6px 0; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
.cal-cell { min-height: 85px; border-right: 1px solid var(--pms-border-light, #eee); border-bottom: 1px solid var(--pms-border-light, #eee); padding: 2px 4px; cursor: pointer; transition: background 0.1s; }
.cal-cell:hover { background: var(--pms-hover, #f5f5f5); }
.cal-cell:nth-child(7n) { border-right: none; }
.cal-other-month { background: #fafafa; }
.cal-other-month .cal-day-num { opacity: 0.35; }
.cal-today { background: #E3F2FD !important; }
.cal-weekend { background: #f9f9fb; }
.cal-holiday { background: #FFF3F0; }
.cal-day-num { font-size: var(--pms-font-body, 11px); font-weight: 600; margin-bottom: 2px; display: flex; align-items: center; gap: 4px; }
.cal-holiday-name { font-size: 8px; color: #E53935; font-weight: 400; }
.cal-events { display: flex; flex-direction: column; gap: 1px; }
.cal-event-bar { font-size: 9px; color: #fff; padding: 1px 4px; border-radius: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3; }
.cal-event-more { font-size: 8px; color: var(--pms-text-hint, #999); text-align: center; }

/* ── 색상 스와치 ── */
.color-swatch { width: 28px; height: 28px; border-radius: 4px; cursor: pointer; border: 2px solid transparent; transition: border-color 0.15s, transform 0.15s; }
.color-swatch:hover { transform: scale(1.15); }
.color-selected { border-color: #212121; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #212121; }
</style>
