import api from './api'

export const mgmtDeliverableService = {
  async getList(projectId: number) { return (await api.get(`/projects/${projectId}/mgmt-deliverables`)).data },
  async create(projectId: number, body: any) { return (await api.post(`/projects/${projectId}/mgmt-deliverables`, body)).data },
  async update(projectId: number, mgmtDelId: number, body: any) { return (await api.put(`/projects/${projectId}/mgmt-deliverables/${mgmtDelId}`, body)).data },
  async remove(projectId: number, mgmtDelId: number) { return (await api.delete(`/projects/${projectId}/mgmt-deliverables/${mgmtDelId}`)).data },
  async batchUpdate(projectId: number, items: any[]) { return (await api.put(`/projects/${projectId}/mgmt-deliverables/batch/update`, { items })).data },
  async getAllDeliverables(projectId: number) { return (await api.get(`/projects/${projectId}/mgmt-deliverables/all-deliverables`)).data },
}
