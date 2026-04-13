import api from './api'

export const requirementService = {
  async getStats(projectId: number, userName?: string) {
    const params: any = {}
    if (userName) params.userName = userName
    const { data } = await api.get(`/projects/${projectId}/requirements/stats`, { params })
    return data
  },

  async getList(projectId: number, params?: Record<string, any>) {
    const { data } = await api.get(`/projects/${projectId}/requirements`, { params })
    return data
  },

  async getDetail(projectId: number, requirementId: number) {
    const { data } = await api.get(`/projects/${projectId}/requirements/${requirementId}`)
    return data
  },

  async create(projectId: number, body: Record<string, any>) {
    const { data } = await api.post(`/projects/${projectId}/requirements`, body)
    return data
  },

  async update(projectId: number, requirementId: number, body: Record<string, any>) {
    const { data } = await api.put(`/projects/${projectId}/requirements/${requirementId}`, body)
    return data
  },

  async remove(projectId: number, requirementId: number) {
    const { data } = await api.delete(`/projects/${projectId}/requirements/${requirementId}`)
    return data
  },

  async baseline(projectId: number, requirementId: number) {
    const { data } = await api.post(`/projects/${projectId}/requirements/${requirementId}/baseline`)
    return data
  },

  async baselineAll(projectId: number) {
    const { data } = await api.post(`/projects/${projectId}/requirements/baseline-all`)
    return data
  },

  async change(projectId: number, requirementId: number, body: Record<string, any>) {
    const { data } = await api.post(`/projects/${projectId}/requirements/${requirementId}/change`, body)
    return data
  },

  async getHistory(projectId: number, requirementId: number) {
    const { data } = await api.get(`/projects/${projectId}/requirements/${requirementId}/history`)
    return data
  },

  getExportUrl(projectId: number) {
    return `${api.defaults.baseURL}/projects/${projectId}/requirements/export`
  },

  getTemplateUrl(projectId: number) {
    return `${api.defaults.baseURL}/projects/${projectId}/requirements/import-template`
  },

  async importExcel(projectId: number, file: File, mode: string = 'append') {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('mode', mode)
    const { data } = await api.post(`/projects/${projectId}/requirements/import`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },
}
