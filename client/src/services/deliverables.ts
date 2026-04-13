import api from './api'

export const deliverableService = {
  async getList(projectId: number, params?: { page?: number; size?: number; docType?: string; status?: string; auditorCheck?: string }) {
    const { data } = await api.get(`/projects/${projectId}/deliverables`, { params })
    return data
  },

  async getDetail(projectId: number, docId: number) {
    const { data } = await api.get(`/projects/${projectId}/deliverables/${docId}`)
    return data
  },

  async create(projectId: number, formData: FormData) {
    const { data } = await api.post(`/projects/${projectId}/deliverables`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  async update(projectId: number, docId: number, formData: FormData) {
    const { data } = await api.put(`/projects/${projectId}/deliverables/${docId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  async updateStatus(projectId: number, docId: number, statusData: { status?: string; auditorCheck?: string }) {
    const { data } = await api.put(`/projects/${projectId}/deliverables/${docId}`, statusData)
    return data
  },

  async addReview(projectId: number, docId: number, review: { result: string; comment?: string }) {
    const { data } = await api.post(`/projects/${projectId}/deliverables/${docId}/review`, review)
    return data
  },

  async remove(projectId: number, docId: number) {
    const { data } = await api.delete(`/projects/${projectId}/deliverables/${docId}`)
    return data
  },
}
