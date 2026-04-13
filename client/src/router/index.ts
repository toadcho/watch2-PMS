import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/LoginView.vue'),
    },
    {
      path: '/register',
      name: 'Register',
      component: () => import('@/views/RegisterView.vue'),
    },
    {
      path: '/',
      name: 'Dashboard',
      component: () => import('@/views/DashboardView.vue'),
      meta: { requiresAuth: true },
    },
    // M1: 프로젝트 관리
    {
      path: '/projects',
      name: 'ProjectList',
      component: () => import('@/views/project/ProjectListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:id',
      name: 'ProjectDetail',
      component: () => import('@/views/project/ProjectDetailView.vue'),
      meta: { requiresAuth: true },
    },
    // M2: WBS/일정 관리
    {
      path: '/projects/:projectId/wbs',
      name: 'WbsManage',
      component: () => import('@/views/wbs/WbsManageView.vue'),
      meta: { requiresAuth: true },
    },
    // 공정 진척현황
    {
      path: '/projects/:projectId/progress',
      name: 'ProgressWeekly',
      component: () => import('@/views/wbs/ProgressWeeklyView.vue'),
      meta: { requiresAuth: true },
    },
    // 요구사항 관리
    {
      path: '/projects/:projectId/requirements',
      name: 'RequirementList',
      component: () => import('@/views/requirement/RequirementListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:projectId/requirements/:requirementId',
      name: 'RequirementDetail',
      component: () => import('@/views/requirement/RequirementDetailView.vue'),
      meta: { requiresAuth: true },
    },
    // M3: 산출물 관리
    {
      path: '/projects/:projectId/deliverables',
      name: 'DeliverableList',
      component: () => import('@/views/deliverable/DeliverableListView.vue'),
      meta: { requiresAuth: true },
    },
    // 이슈/리스크 관리
    {
      path: '/projects/:projectId/issue-risk',
      name: 'IssueRisk',
      component: () => import('@/views/issueRisk/IssueRiskView.vue'),
      meta: { requiresAuth: true },
    },
    // M5: 의사소통/협업 (레거시 이슈 경로 유지)
    {
      path: '/projects/:projectId/issues',
      name: 'IssueList',
      component: () => import('@/views/issueRisk/IssueRiskView.vue'),
      meta: { requiresAuth: true },
    },
    // M5: 공지사항 (프로젝트별)
    {
      path: '/projects/:projectId/notices',
      name: 'NoticeList',
      component: () => import('@/views/communication/NoticeListView.vue'),
      meta: { requiresAuth: true },
    },
    // M5: 자료실 (프로젝트별)
    {
      path: '/projects/:projectId/library',
      name: 'Library',
      component: () => import('@/views/communication/LibraryView.vue'),
      meta: { requiresAuth: true },
    },
    // 산출물 정의 (설정 하위)
    {
      path: '/projects/:projectId/deliverable-def',
      name: 'DeliverableDef',
      component: () => import('@/views/settings/DeliverableDefView.vue'),
      meta: { requiresAuth: true },
    },
    // M6: 시스템 관리
    {
      path: '/admin/users',
      name: 'UserManage',
      component: () => import('@/views/admin/UserManageView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/admin/codes',
      name: 'CodeManage',
      component: () => import('@/views/admin/CodeManageView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/admin/audit-logs',
      name: 'AuditLog',
      component: () => import('@/views/admin/AuditLogView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/admin/backup',
      name: 'Backup',
      component: () => import('@/views/admin/BackupView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    // 자원 관리
    {
      path: '/projects/:projectId/resources',
      name: 'Resources',
      component: () => import('@/views/resource/ResourceView.vue'),
      meta: { requiresAuth: true },
    },
    // 산출물관리
    {
      path: '/projects/:projectId/doc-storage',
      name: 'DocStorage',
      component: () => import('@/views/docStorage/DocStorageView.vue'),
      meta: { requiresAuth: true },
    },
    // WorkSpace
    {
      path: '/projects/:projectId/workspace',
      name: 'Workspace',
      component: () => import('@/views/workspace/WorkspaceView.vue'),
      meta: { requiresAuth: true },
    },
    // 개발진척현황
    {
      path: '/projects/:projectId/dev-progress',
      name: 'DevProgress',
      component: () => import('@/views/devProgress/DevProgressView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:projectId/dev-progress/actual',
      name: 'DevActualInput',
      component: () => import('@/views/devProgress/DevActualInputView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:projectId/dev-progress/stats',
      name: 'DevStats',
      component: () => import('@/views/devProgress/DevStatsView.vue'),
      meta: { requiresAuth: true },
    },
    // 프로젝트 캘린더
    {
      path: '/projects/:projectId/calendar',
      name: 'ProjectCalendar',
      component: () => import('@/views/calendar/ProjectCalendarView.vue'),
      meta: { requiresAuth: true },
    },
    // C2: 보고서
    {
      path: '/projects/:projectId/reports',
      name: 'Reports',
      component: () => import('@/views/report/ReportView.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

// Navigation guard
router.beforeEach(async (to, _from, next) => {
  const token = localStorage.getItem('token')

  if (to.meta.requiresAuth && !token) {
    next({ name: 'Login' })
  } else if (to.name === 'Login' && token) {
    const { useAuthStore } = await import('@/stores/auth')
    const authStore = useAuthStore()
    authStore.restoreFromToken()
    // 시스템관리자는 프로젝트 관리로, 일반 사용자는 대시보드로
    next(authStore.isAdmin ? { name: 'ProjectList' } : { name: 'Dashboard' })
  } else {
    // 일반 사용자: 프로젝트 정보 로드 (헤더/사이드바용)
    if (token && to.meta.requiresAuth) {
      const { useAuthStore } = await import('@/stores/auth')
      const authStore = useAuthStore()
      authStore.restoreFromToken()
      // 시스템관리자가 대시보드 접근 시 프로젝트 관리로 리다이렉트
      if (authStore.isAdmin && to.name === 'Dashboard') {
        next({ name: 'ProjectList' }); return
      }
      await authStore.loadMyProject()
    }
    next()
  }
})

export default router
