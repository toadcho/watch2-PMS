import api from './api'

export const approvalService = {
  async getMaxRate(projectId: number, taskId: number) {
    return (await api.get(`/projects/${projectId}/approval/max-rate/${taskId}`)).data
  },
  async getDeliverableStatus(projectId: number, docId: number) {
    return (await api.get(`/projects/${projectId}/approval/deliverable/${docId}`)).data
  },
  async completeDeliverable(projectId: number, docId: number) {
    return (await api.post(`/projects/${projectId}/approval/complete/${docId}`)).data
  },
  async requestApproval(projectId: number, docId: number) {
    return (await api.post(`/projects/${projectId}/approval/request/${docId}`)).data
  },
  async approve(projectId: number, docId: number, comment?: string) {
    return (await api.post(`/projects/${projectId}/approval/approve/${docId}`, { comment })).data
  },
  async approveBulk(projectId: number, docIds: number[], comment?: string) {
    return (await api.post(`/projects/${projectId}/approval/approve-bulk`, { docIds, comment })).data
  },
  async reject(projectId: number, docId: number, comment?: string) {
    return (await api.post(`/projects/${projectId}/approval/reject/${docId}`, { comment })).data
  },
  async requestNextForTask(projectId: number, taskId: number, approverId?: string) {
    return (await api.post(`/projects/${projectId}/approval/request-next/${taskId}`, { approverId })).data
  },
  async getApprovers(projectId: number, role: string) {
    return (await api.get(`/projects/${projectId}/approval/approvers/${role}`)).data
  },
  async reRequestForTask(projectId: number, taskId: number) {
    return (await api.post(`/projects/${projectId}/approval/re-request/${taskId}`)).data
  },
  async withdrawTask(projectId: number, taskId: number) {
    return (await api.post(`/projects/${projectId}/approval/withdraw-task/${taskId}`)).data
  },
  async withdraw(projectId: number, docId: number) {
    return (await api.post(`/projects/${projectId}/approval/withdraw/${docId}`)).data
  },
  async getPending(projectId: number) {
    return (await api.get(`/projects/${projectId}/approval/pending`)).data
  },
}
