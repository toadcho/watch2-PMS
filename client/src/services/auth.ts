import api from './api'

export const authService = {
  async login(userId: string, password: string) {
    const { data } = await api.post('/auth/login', { userId, password })
    return data
  },

  async refresh(refreshToken: string) {
    const { data } = await api.post('/auth/refresh', { refreshToken })
    return data
  },

  async changePassword(currentPassword: string, newPassword: string) {
    const { data } = await api.put('/auth/password', { currentPassword, newPassword })
    return data
  },

  async getQuickLoginUsers() {
    const { data } = await api.get('/auth/quick-login-users')
    return data
  },

  async quickLogin(userId: string) {
    const { data } = await api.post('/auth/quick-login', { userId })
    return data
  },
}
