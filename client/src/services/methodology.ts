import api from './api'

export const methodologyService = {
  // 방법론
  async getList() { return (await api.get('/methodologies')).data },
  async create(data: { name: string; description?: string }) { return (await api.post('/methodologies', data)).data },
  async update(id: number, data: any) { return (await api.put(`/methodologies/${id}`, data)).data },
  async remove(id: number) { return (await api.delete(`/methodologies/${id}`)).data },

  // 방법론 산출물
  async getDeliverables(methodologyId: number) { return (await api.get(`/methodologies/${methodologyId}/deliverables`)).data },
  async createDeliverable(methodologyId: number, data: any) { return (await api.post(`/methodologies/${methodologyId}/deliverables`, data)).data },
  async updateDeliverable(methodologyId: number, masterId: number, data: any) { return (await api.put(`/methodologies/${methodologyId}/deliverables/${masterId}`, data)).data },
  async removeDeliverable(methodologyId: number, masterId: number) { return (await api.delete(`/methodologies/${methodologyId}/deliverables/${masterId}`)).data },

  // 테일러링
  async getTailoring(projectId: number) { return (await api.get(`/projects/${projectId}/tailoring`)).data },
  async initTailoring(projectId: number) { return (await api.post(`/projects/${projectId}/tailoring/init`)).data },
  async updateItem(projectId: number, projDelId: number, data: any) { return (await api.put(`/projects/${projectId}/tailoring/${projDelId}`, data)).data },

  // 엑셀 export
  exportUrl(projectId: number) {
    return `${api.defaults.baseURL}/projects/${projectId}/tailoring/export`
  },
}
