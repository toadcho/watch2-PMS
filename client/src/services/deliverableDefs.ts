import api from './api'

export const deliverableDefService = {
  async getMasters() {
    const { data } = await api.get('/deliverable-masters/masters')
    return data
  },

  async createMaster(masterData: { phase: string; docCode: string; docName: string; mandatory?: string; description?: string; remark?: string }) {
    const { data } = await api.post('/deliverable-masters/masters', masterData)
    return data
  },

  async updateMaster(masterId: number, masterData: Record<string, any>) {
    const { data } = await api.put(`/deliverable-masters/masters/${masterId}`, masterData)
    return data
  },

  async deleteMaster(masterId: number) {
    const { data } = await api.delete(`/deliverable-masters/masters/${masterId}`)
    return data
  },

  async getProjectDefs(projectId: number) {
    const { data } = await api.get(`/projects/${projectId}/deliverable-defs`)
    return data
  },

  async addDefs(projectId: number, masterIds: number[]) {
    const { data } = await api.post(`/projects/${projectId}/deliverable-defs`, { masterIds })
    return data
  },

  async removeDefs(projectId: number, masterIds: number[]) {
    const { data } = await api.delete(`/projects/${projectId}/deliverable-defs`, { data: { masterIds } })
    return data
  },
}
