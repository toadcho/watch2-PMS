import api from './api'

export const issueService = {
  async getList(projectId: number, params?: { page?: number; size?: number; priority?: string; status?: string }) {
    const { data } = await api.get(`/projects/${projectId}/issues`, { params })
    return data
  },

  async create(projectId: number, issueData: { issueTitle: string; description?: string; priority?: string; assigneeId?: string }) {
    const { data } = await api.post(`/projects/${projectId}/issues`, issueData)
    return data
  },

  async update(projectId: number, issueId: number, issueData: Record<string, any>) {
    const { data } = await api.put(`/projects/${projectId}/issues/${issueId}`, issueData)
    return data
  },

  async remove(projectId: number, issueId: number) {
    const { data } = await api.delete(`/projects/${projectId}/issues/${issueId}`)
    return data
  },
}
