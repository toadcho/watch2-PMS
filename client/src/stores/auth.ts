import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/services/api'

interface UserInfo {
  userId: string
  userName: string
  email: string
  systemRole: string
  department?: string
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserInfo | null>(null)
  const token = ref<string | null>(localStorage.getItem('token'))

  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.systemRole === 'ADMIN')
  const myProjectId = ref<number | null>(null)
  const myProjectName = ref<string | null>(null)

  function setAuth(tokenValue: string, userInfo: UserInfo) {
    token.value = tokenValue
    user.value = userInfo
    localStorage.setItem('token', tokenValue)
    localStorage.setItem('user', JSON.stringify(userInfo))
    // 시스템관리자는 프로젝트 소속 없음
    if (userInfo.systemRole === 'ADMIN') {
      myProjectId.value = null
      myProjectName.value = null
    }
  }

  function clearAuth() {
    token.value = null
    user.value = null
    myProjectId.value = null
    myProjectName.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('user')
  }

  function restoreFromToken() {
    if (user.value) return // 이미 복원됨

    // 1순위: localStorage에 저장된 user 객체 (한글 안전)
    const storedUser = localStorage.getItem('user')
    if (storedUser) {
      try {
        user.value = JSON.parse(storedUser)
        token.value = localStorage.getItem('token')
        return
      } catch {}
    }

    // 2순위: JWT 디코딩 (한글 UTF-8 안전 처리)
    const stored = localStorage.getItem('token')
    if (stored) {
      try {
        const base64 = stored.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        const payload = JSON.parse(new TextDecoder().decode(bytes))
        user.value = {
          userId: payload.userId,
          userName: payload.userName,
          email: payload.email,
          systemRole: payload.systemRole,
          department: payload.department,
        }
        token.value = stored
      } catch {
        clearAuth()
      }
    }
  }

  // 일반 사용자: 투입 프로젝트 정보 로드
  async function loadMyProject() {
    if (myProjectId.value) return // 이미 로드됨
    if (isAdmin.value) return // 관리자는 불필요
    try {
      const { data } = await api.get('/projects', { params: { page: 1, size: 1 } })
      if (data.success && data.data.length > 0) {
        myProjectId.value = data.data[0].projectId
        myProjectName.value = data.data[0].projectName
      }
    } catch {}
  }

  return {
    user,
    token,
    isLoggedIn,
    isAdmin,
    myProjectId,
    myProjectName,
    setAuth,
    clearAuth,
    restoreFromToken,
    loadMyProject,
  }
})
