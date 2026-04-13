import api from './api'

export const issueService = {
  async getList(pid: number, params?: any) { return (await api.get(`/projects/${pid}/issues`, { params })).data },
  async getDetail(pid: number, id: number) { return (await api.get(`/projects/${pid}/issues/${id}`)).data },
  async create(pid: number, body: any) { return (await api.post(`/projects/${pid}/issues`, body)).data },
  async update(pid: number, id: number, body: any) { return (await api.put(`/projects/${pid}/issues/${id}`, body)).data },
  async remove(pid: number, id: number) { return (await api.delete(`/projects/${pid}/issues/${id}`)).data },
}

export const riskService = {
  async getList(pid: number, params?: any) { return (await api.get(`/projects/${pid}/risks`, { params })).data },
  async getDetail(pid: number, id: number) { return (await api.get(`/projects/${pid}/risks/${id}`)).data },
  async create(pid: number, body: any) { return (await api.post(`/projects/${pid}/risks`, body)).data },
  async update(pid: number, id: number, body: any) { return (await api.put(`/projects/${pid}/risks/${id}`, body)).data },
  async remove(pid: number, id: number) { return (await api.delete(`/projects/${pid}/risks/${id}`)).data },
}
