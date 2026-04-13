<script setup lang="ts">
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRouter, useRoute } from 'vue-router'
import { projectService } from '@/services/projects'
import { notificationService } from '@/services/notifications'
import { useProjectTheme } from '@/composables/useTheme'

defineProps<{
  drawer: boolean
}>()

const emit = defineEmits<{
  'update:drawer': [value: boolean]
}>()

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const { applyTheme, resetTheme } = useProjectTheme()

const currentPhases = ref<string[]>([])
const projectEndDate = ref<string>('')
const myTeamName = ref<string>('')
const myRoleLabel = ref<string>('')

// 오늘 날짜/요일
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']
const todayDisplay = computed(() => {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}.${mm}.${dd} (${DAY_NAMES[d.getDay()]})`
})

// D-day 카운트 (종료일 기준)
const dDayDisplay = computed(() => {
  if (!projectEndDate.value) return ''
  const end = new Date(projectEndDate.value)
  end.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diff > 0) return `D-${diff}`
  if (diff === 0) return 'D-Day'
  return `D+${Math.abs(diff)}`
})
const dDayColor = computed(() => {
  if (!projectEndDate.value) return ''
  const end = new Date(projectEndDate.value)
  end.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diff <= 0) return '#FF5252'
  if (diff <= 14) return '#FB8C00'
  if (diff <= 30) return '#FFD740'
  return '#81C784'
})

// 알림
const notifMenu = ref(false)
const unreadCount = ref(0)
const notifications = ref<any[]>([])
const notifLoading = ref(false)
let notifTimer: any = null

function getPhaseColor(phase: string) {
  const c: Record<string, string> = { '분석': 'blue', '설계': 'indigo', '구현': 'green', '시험': 'orange', '이행': 'purple' }
  return c[phase] || 'grey'
}

async function loadPhases() {
  const pid = authStore.myProjectId
  if (!pid) { currentPhases.value = []; projectEndDate.value = ''; myTeamName.value = ''; myRoleLabel.value = ''; resetTheme(); return }
  try {
    const [detailRes, roleRes] = await Promise.all([
      projectService.getDetail(pid),
      projectService.getMyRole(pid).catch(() => null),
    ])
    if (detailRes.success) {
      currentPhases.value = detailRes.data.currentPhases || []
      projectEndDate.value = detailRes.data.endDate || ''
      // 프로젝트 테마 적용
      if (detailRes.data.themeConfig) {
        applyTheme(detailRes.data.themeConfig)
      } else {
        resetTheme()
      }
    }
    if (roleRes?.success) {
      myTeamName.value = roleRes.data.department || ''
      const ROLE_LABELS: Record<string, string> = {
        PMSAdmin: 'PMS관리자', PL: '팀장', TM: '팀원', QA: 'QA',
        PM: 'PM', PMO: 'PMO', Customer: '고객', Inspector: '감리',
        TA: 'TA', AA: 'AA', DBA: 'DBA', DA: 'DA',
      }
      myRoleLabel.value = roleRes.data.role ? (ROLE_LABELS[roleRes.data.role] || roleRes.data.role) : ''
    }
  } catch { currentPhases.value = []; projectEndDate.value = ''; myTeamName.value = ''; myRoleLabel.value = '' }
}

async function fetchUnreadCount() {
  try {
    const res = await notificationService.getUnreadCount()
    if (res.success) unreadCount.value = res.data.count
  } catch {}
}

async function openNotifMenu() {
  notifMenu.value = true
  notifLoading.value = true
  try {
    const res = await notificationService.getList({ size: 15 })
    if (res.success) {
      notifications.value = res.data
      unreadCount.value = res.unreadCount
    }
  } catch {}
  finally { notifLoading.value = false }
}

async function markRead(notif: any) {
  if (!notif.isRead) {
    await notificationService.markRead(notif.notifId)
    notif.isRead = true
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  }
  if (notif.link) { notifMenu.value = false; router.push(notif.link) }
}

async function markAllRead() {
  await notificationService.markAllRead()
  notifications.value.forEach(n => n.isRead = true)
  unreadCount.value = 0
}

function formatTime(d: string) {
  if (!d) return ''
  const dt = new Date(d)
  const now = new Date()
  const diff = now.getTime() - dt.getTime()
  if (diff < 60000) return '방금'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`
  return dt.toLocaleDateString('ko-KR')
}

const notifTypeIcon: Record<string, string> = {
  report_request: 'mdi-file-document-edit',
  report_section_done: 'mdi-check-circle',
  approval_request: 'mdi-clipboard-check',
  approval_done: 'mdi-check-decagram',
  approval_rejected: 'mdi-close-circle',
  issue_assign: 'mdi-alert-circle',
  register_request: 'mdi-account-plus',
  default: 'mdi-bell',
}

watch(() => authStore.myProjectId, () => loadPhases())
onMounted(() => {
  loadPhases()
  fetchUnreadCount()
  notifTimer = setInterval(fetchUnreadCount, 60000) // 1분마다 폴링
})
onBeforeUnmount(() => { if (notifTimer) clearInterval(notifTimer) })

function logout() {
  authStore.clearAuth()
  router.push('/login')
}
</script>

<template>
  <v-app-bar color="primary" density="comfortable" elevation="2">
    <v-app-bar-nav-icon @click="emit('update:drawer', !drawer)" />
    <v-toolbar-title v-if="authStore.myProjectName" class="d-flex align-center">
      <v-icon size="18" class="mr-2" style="opacity:0.8">mdi-folder-open</v-icon>
      <span style="font-size:15px; font-weight:700; letter-spacing:0.5px">{{ authStore.myProjectName }}</span>
      <template v-if="currentPhases.length">
        <v-chip v-for="ph in currentPhases" :key="ph" :color="getPhaseColor(ph)" variant="flat" size="x-small" class="ml-2" style="font-size:10px; font-weight:600">{{ ph }}</v-chip>
      </template>
    </v-toolbar-title>
    <v-toolbar-title v-else class="text-subtitle-1 font-weight-bold">
      PMS 프로젝트관리시스템
    </v-toolbar-title>

    <v-spacer />

    <!-- 날짜 + D-day -->
    <div v-if="authStore.myProjectId" class="d-flex align-center mr-3" style="gap:8px">
      <div class="header-date">
        <v-icon size="13" class="mr-1" style="opacity:0.7">mdi-calendar-today</v-icon>{{ todayDisplay }}
      </div>
      <div v-if="dDayDisplay" class="header-dday" :style="{ background: dDayColor }">{{ dDayDisplay }}</div>
    </div>

    <!-- 알림 벨 (시스템관리자 제외) -->
    <v-menu v-if="!authStore.isAdmin" v-model="notifMenu" :close-on-content-click="false" location="bottom end" max-width="380">
      <template #activator="{ props: menuProps }">
        <v-btn icon size="small" v-bind="menuProps" @click="openNotifMenu" class="mr-1">
          <v-badge :content="unreadCount" :model-value="unreadCount > 0" color="error" floating>
            <v-icon>mdi-bell-outline</v-icon>
          </v-badge>
        </v-btn>
      </template>
      <v-card min-width="340" max-width="380">
        <div class="d-flex align-center pa-3" style="border-bottom:1px solid #eee">
          <span style="font-size:13px; font-weight:700">알림</span>
          <v-chip v-if="unreadCount" size="x-small" color="error" variant="tonal" class="ml-1">{{ unreadCount }}</v-chip>
          <v-spacer />
          <v-btn v-if="unreadCount" size="x-small" variant="text" color="primary" @click="markAllRead">모두 읽음</v-btn>
        </div>
        <v-progress-linear v-if="notifLoading" indeterminate color="primary" />
        <div style="max-height:360px; overflow-y:auto">
          <div v-if="!notifications.length" class="text-center pa-6" style="color:#999; font-size:12px">알림이 없습니다.</div>
          <div v-for="n in notifications" :key="n.notifId" class="notif-item" :class="{ 'notif-unread': !n.isRead }" @click="markRead(n)">
            <v-icon size="16" :color="n.isRead ? 'grey' : 'primary'" class="mr-2 mt-1" style="flex-shrink:0">{{ notifTypeIcon[n.type] || notifTypeIcon.default }}</v-icon>
            <div style="flex:1; min-width:0">
              <div style="font-size:11px; font-weight:600" :style="{ color: n.isRead ? '#999' : '#333' }">{{ n.title }}</div>
              <div v-if="n.message" style="font-size:10px; color:#888; margin-top:1px">{{ n.message }}</div>
              <div style="font-size:9px; color:#bbb; margin-top:2px">{{ formatTime(n.createdAt) }}</div>
            </div>
            <v-icon v-if="!n.isRead" size="8" color="primary" class="ml-1" style="flex-shrink:0">mdi-circle</v-icon>
          </div>
        </div>
      </v-card>
    </v-menu>

    <v-chip variant="text" class="mr-2">
      <v-icon start size="small">mdi-account-circle</v-icon>
      <template v-if="myTeamName"><span style="opacity:0.8">{{ myTeamName }}</span><span style="margin:0 4px; opacity:0.5">·</span></template>{{ authStore.user?.userName }}<template v-if="myRoleLabel"><span style="opacity:0.7; margin-left:2px">({{ myRoleLabel }})</span></template>
    </v-chip>

    <v-btn icon size="small" @click="logout">
      <v-icon>mdi-logout</v-icon>
      <v-tooltip activator="parent" location="bottom">로그아웃</v-tooltip>
    </v-btn>
  </v-app-bar>
</template>

<style scoped>
.header-date {
  font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.85);
  display: flex; align-items: center; letter-spacing: 0.3px;
}
.header-dday {
  font-size: 11px; font-weight: 700; color: #fff;
  padding: 1px 8px; border-radius: 10px; letter-spacing: 0.5px;
  line-height: 20px; white-space: nowrap;
}
.notif-item {
  display: flex; align-items: flex-start; padding: 10px 12px;
  border-bottom: 1px solid #f5f5f5; cursor: pointer; transition: background 0.15s;
}
.notif-item:hover { background: #f8f9ff; }
.notif-unread { background: #EEF5FF; }
</style>
