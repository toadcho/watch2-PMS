import api from './api'

export const projectService = {
  async getList(params?: { page?: number; size?: number; keyword?: string; status?: string }) {
    const { data } = await api.get('/projects', { params })
    return data
  },

  async getDetail(id: number) {
    const { data } = await api.get(`/projects/${id}`)
    return data
  },

  async create(projectData: {
    projectName: string; startDate: string; endDate: string;
    clientOrg?: string; pmUserId?: string; description?: string;
  }) {
    const { data } = await api.post('/projects', projectData)
    return data
  },

  async update(id: number, projectData: Record<string, any>) {
    const { data } = await api.put(`/projects/${id}`, projectData)
    return data
  },

  async remove(id: number) {
    const { data } = await api.delete(`/projects/${id}`)
    return data
  },

  // 프로젝트 내 역할 조회
  async getMyRole(projectId: number) {
    const { data } = await api.get(`/projects/${projectId}/members/my-role`)
    return data
  },

  // 투입인력
  async getMembers(projectId: number) {
    const { data } = await api.get(`/projects/${projectId}/members`)
    return data
  },

  async addMember(projectId: number, memberData: { userId: string; role: string; joinDate: string; leaveDate?: string; manMonth?: number }) {
    const { data } = await api.post(`/projects/${projectId}/members`, memberData)
    return data
  },

  async updateMember(projectId: number, memberId: number, memberData: Record<string, any>) {
    const { data } = await api.put(`/projects/${projectId}/members/${memberId}`, memberData)
    return data
  },

  async removeMember(projectId: number, memberId: number) {
    const { data } = await api.delete(`/projects/${projectId}/members/${memberId}`)
    return data
  },

  async exportMembersExcel(projectId: number) {
    const res = await api.get(`/projects/${projectId}/members/export/excel`, { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a'); a.href = url; a.download = 'members.xlsx'; a.click()
    window.URL.revokeObjectURL(url)
  },

  // 위험
  async getRisks(projectId: number) {
    const { data } = await api.get(`/projects/${projectId}/risks`)
    return data
  },

  async addRisk(projectId: number, riskData: { riskName: string; impactLevel: string; probability: string; mitigationPlan?: string; ownerId?: string }) {
    const { data } = await api.post(`/projects/${projectId}/risks`, riskData)
    return data
  },

  async updateRisk(projectId: number, riskId: number, riskData: Record<string, any>) {
    const { data } = await api.put(`/projects/${projectId}/risks/${riskId}`, riskData)
    return data
  },

  async removeRisk(projectId: number, riskId: number) {
    const { data } = await api.delete(`/projects/${projectId}/risks/${riskId}`)
    return data
  },

  // 캐치프레이즈 이미지
  async uploadCatchphrase(projectId: number, file: File) {
    const fd = new FormData()
    fd.append('image', file)
    return (await api.post(`/projects/${projectId}/catchphrase`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })).data
  },
  async deleteCatchphrase(projectId: number) {
    return (await api.delete(`/projects/${projectId}/catchphrase`)).data
  },
}
