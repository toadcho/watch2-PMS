import api from './api'

export const dashboardService = {
  async getData() {
    const { data } = await api.get('/dashboard')
    return data
  },
}
