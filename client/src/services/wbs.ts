import api from './api'

export const wbsService = {
  async getTree(projectId: number) {
    const { data } = await api.get(`/projects/${projectId}/wbs`)
    return data
  },

  async getFlat(projectId: number) {
    const { data } = await api.get(`/projects/${projectId}/wbs`, { params: { flat: 'true' } })
    return data
  },

  async getDetail(projectId: number, taskId: number) {
    const { data } = await api.get(`/projects/${projectId}/wbs/${taskId}`)
    return data
  },

  async create(projectId: number, taskData: {
    taskName: string; parentTaskId?: number; phase?: string;
    planStart?: string; planEnd?: string; assigneeId?: string;
  }) {
    const { data } = await api.post(`/projects/${projectId}/wbs`, taskData)
    return data
  },

  async update(projectId: number, taskId: number, taskData: Record<string, any>) {
    const { data } = await api.put(`/projects/${projectId}/wbs/${taskId}`, taskData)
    return data
  },

  async remove(projectId: number, taskId: number) {
    const { data } = await api.delete(`/projects/${projectId}/wbs/${taskId}`)
    return data
  },

  async reorder(projectId: number, taskId: number, newParentId: number | null, newSortOrder: number) {
    const { data } = await api.put(`/projects/${projectId}/wbs/${taskId}/reorder`, { newParentId, newSortOrder })
    return data
  },
}
