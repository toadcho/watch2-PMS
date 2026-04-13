import api from './api'

export const devProgramService = {
  async getList(projectId: number, params?: any) {
    return (await api.get(`/projects/${projectId}/dev-programs`, { params })).data
  },
  async getSummary(projectId: number) {
    return (await api.get(`/projects/${projectId}/dev-programs/summary`)).data
  },
  async getDetail(projectId: number, pgmId: number) {
    return (await api.get(`/projects/${projectId}/dev-programs/${pgmId}`)).data
  },
  async create(projectId: number, body: any) {
    return (await api.post(`/projects/${projectId}/dev-programs`, body)).data
  },
  async update(projectId: number, pgmId: number, body: any) {
    return (await api.put(`/projects/${projectId}/dev-programs/${pgmId}`, body)).data
  },
  async remove(projectId: number, pgmId: number) {
    return (await api.delete(`/projects/${projectId}/dev-programs/${pgmId}`)).data
  },
  async updateActual(projectId: number, pgmId: number, body: any) {
    return (await api.put(`/projects/${projectId}/dev-programs/${pgmId}/actual`, body)).data
  },
  async exportExcel(projectId: number) {
    const res = await api.get(`/projects/${projectId}/dev-programs/export/excel`, { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a'); a.href = url; a.download = 'dev-programs.xlsx'; a.click()
    window.URL.revokeObjectURL(url)
  },
  async importExcel(projectId: number, file: File, mode: string = 'append') {
    const fd = new FormData(); fd.append('file', file); fd.append('mode', mode)
    return (await api.post(`/projects/${projectId}/dev-programs/import/excel`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })).data
  },

  // 주차별 계획
  async getPlans(projectId: number, pgmId: number) {
    return (await api.get(`/projects/${projectId}/dev-programs/${pgmId}/plans`)).data
  },
  async autoPlans(projectId: number, pgmId: number) {
    return (await api.post(`/projects/${projectId}/dev-programs/${pgmId}/plans/auto`)).data
  },
  async updatePlans(projectId: number, pgmId: number, plans: any[]) {
    return (await api.put(`/projects/${projectId}/dev-programs/${pgmId}/plans`, { plans })).data
  },

  // 주간 실적
  async getWeeklyActuals(projectId: number, params?: any) {
    return (await api.get(`/projects/${projectId}/dev-programs/actuals/weekly`, { params })).data
  },
  async saveWeeklyActuals(projectId: number, body: { weekNo: number; yearWeek: string; actuals: any[] }) {
    return (await api.post(`/projects/${projectId}/dev-programs/actuals/batch`, body)).data
  },

  // 통계
  async getWeeklyTrend(projectId: number, params?: any) {
    return (await api.get(`/projects/${projectId}/dev-programs/stats/weekly-trend`, { params })).data
  },
  async getStatsByTask(projectId: number) {
    return (await api.get(`/projects/${projectId}/dev-programs/stats/by-task`)).data
  },
  async getStatsByDeveloper(projectId: number) {
    return (await api.get(`/projects/${projectId}/dev-programs/stats/by-developer`)).data
  },
  async getWeeks(projectId: number) {
    return (await api.get(`/projects/${projectId}/dev-programs/stats/weeks`)).data
  },
}
