import api from './api'

export const milestoneService = {
  async getList(projectId: number) { return (await api.get(`/projects/${projectId}/milestones`)).data },
  async create(projectId: number, data: any) { return (await api.post(`/projects/${projectId}/milestones`, data)).data },
  async update(projectId: number, milestoneId: number, data: any) { return (await api.put(`/projects/${projectId}/milestones/${milestoneId}`, data)).data },
  async remove(projectId: number, milestoneId: number) { return (await api.delete(`/projects/${projectId}/milestones/${milestoneId}`)).data },
}
