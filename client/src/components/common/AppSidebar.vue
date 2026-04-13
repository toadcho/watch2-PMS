<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const route = useRoute()
const authStore = useAuthStore()
const isAdmin = authStore.isAdmin

// 프로젝트 내 PMS관리자 여부 (시스템관리자는 모니터링 전용)
const isPmsAdmin = ref(false)
async function checkPmsAdmin() {
  if (isAdmin) { isPmsAdmin.value = false; return }
  const pid = authStore.myProjectId
  if (!pid) return
  try {
    const { projectService } = await import('@/services/projects')
    const res = await projectService.getMyRole(pid)
    if (res.success) isPmsAdmin.value = res.data.isPmsAdmin || false
  } catch {}
}
onMounted(checkPmsAdmin)

// 프로젝트 컨텍스트 감지: URL 파라미터 또는 store에 저장된 프로젝트 ID
const projectId = computed(() => {
  return route.params.projectId || route.params.id || (!isAdmin ? authStore.myProjectId : null) || null
})

// 글로벌 메뉴 (시스템관리자 전용)
const globalItems = [
  { title: '프로젝트 관리', icon: 'mdi-folder-multiple', to: '/projects', sysAdmin: true },
  { title: '사용자 관리', icon: 'mdi-account-cog', to: '/admin/users', sysAdmin: true },
  { title: '공통코드 관리', icon: 'mdi-code-tags', to: '/admin/codes', sysAdmin: true },
  { title: '감사 로그', icon: 'mdi-file-document-outline', to: '/admin/audit-logs', sysAdmin: true },
  { title: '백업 관리', icon: 'mdi-database-export', to: '/admin/backup', sysAdmin: true },
]

// 프로젝트 내부 메뉴 (동적)
const projectItems = computed(() => {
  const pid = projectId.value
  if (!pid) return []
  return [
    { title: '대시보드', icon: 'mdi-view-dashboard', to: '/' },
    { divider: true },
    { title: '프로젝트 기본정보', icon: 'mdi-information', to: `/projects/${pid}?tab=info` },
    { divider: true },
    { title: '공정진척 현황', icon: 'mdi-chart-line', to: `/projects/${pid}/progress` },
    { title: '개발진척 현황', icon: 'mdi-chart-bell-curve-cumulative', to: `/projects/${pid}/dev-progress/stats` },
    { divider: true },
    { title: '자원 관리', icon: 'mdi-account-group', to: `/projects/${pid}/resources` },
    { title: 'WBS/일정 관리', icon: 'mdi-chart-gantt', to: `/projects/${pid}/wbs` },
    { title: '요구사항 관리', icon: 'mdi-format-list-checks', to: `/projects/${pid}/requirements` },
    { title: '의사소통 관리', icon: 'mdi-file-chart', to: `/projects/${pid}/reports` },
    { title: '산출물 관리', icon: 'mdi-folder-multiple', to: `/projects/${pid}/doc-storage` },
    { title: '이슈/리스크 관리', icon: 'mdi-shield-alert', to: `/projects/${pid}/issue-risk` },
    { title: '개발진척 관리', icon: 'mdi-code-braces', to: `/projects/${pid}/dev-progress` },
    { divider: true },
    { title: 'WorkSpace', icon: 'mdi-briefcase-outline', to: `/projects/${pid}/workspace` },
    { divider: true },
    { title: '설정', icon: 'mdi-cog', to: `/projects/${pid}?tab=settings`, admin: true },
    { title: '공지사항', icon: 'mdi-bullhorn', to: `/projects/${pid}/notices` },
    { title: '자료실', icon: 'mdi-folder-open', to: `/projects/${pid}/library` },
    { title: '프로젝트 캘린더', icon: 'mdi-calendar-month', to: `/projects/${pid}/calendar` },
    { title: '방법론/산출물 정의', icon: 'mdi-file-cog', to: `/projects/${pid}/deliverable-def`, admin: true },
  ]
})

const menuItems = computed(() => {
  // 일반 사용자: 프로젝트 ID가 있으면 항상 프로젝트 메뉴
  if (!isAdmin && projectId.value) return projectItems.value
  // 시스템관리자: 프로젝트 진입 시 프로젝트 메뉴 + 글로벌 관리 메뉴 병합
  if (isAdmin && (route.params.projectId || route.params.id)) {
    return [...projectItems.value, { divider: true }, ...globalItems]
  }
  return globalItems
})

// 현재 활성 메뉴 판별
function isActive(to: string) {
  const path = route.path
  const query = route.query

  // query 포함 링크 (?tab=xxx)
  if (to.includes('?tab=')) {
    const [base, qs] = to.split('?')
    const tabVal = new URLSearchParams(qs).get('tab')
    return path === base && (query.tab === tabVal || (!query.tab && tabVal === 'info'))
  }

  // 정확 매칭
  return path === to
}
</script>

<template>
  <v-navigation-drawer
    :rail="!modelValue"
    :width="220"
    permanent
  >
    <v-list density="compact" nav>
      <!-- rail 상태일 때 펼치기 버튼 -->
      <v-list-item
        v-if="!modelValue"
        prepend-icon="mdi-chevron-double-right"
        title=""
        @click.stop="emit('update:modelValue', true)"
        color="grey"
      />

      <template v-for="(item, i) in menuItems" :key="i">
        <v-divider v-if="item.divider" class="my-1" />
        <v-list-item
          v-else-if="item.external && (!item.admin || isPmsAdmin) && (!item.sysAdmin || isAdmin)"
          :prepend-icon="item.icon"
          :title="item.title"
          :href="item.href"
          target="_blank"
          color="primary"
        />
        <v-list-item
          v-else-if="(!item.admin || isPmsAdmin) && (!item.sysAdmin || isAdmin)"
          :to="item.to"
          :prepend-icon="item.icon"
          :title="item.title"
          :active="isActive(item.to!)"
          color="primary"
          exact
        />
      </template>
    </v-list>

    <template #append>
      <v-list density="compact" nav>
        <v-list-item
          v-if="modelValue"
          prepend-icon="mdi-chevron-double-left"
          title="메뉴 접기"
          @click.stop="emit('update:modelValue', false)"
          color="grey"
        />
      </v-list>
    </template>
  </v-navigation-drawer>
</template>
