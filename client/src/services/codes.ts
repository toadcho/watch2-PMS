import api from './api'

export const codeService = {
  async getAll(codeGroup?: string) {
    const { data } = await api.get('/codes', { params: codeGroup ? { codeGroup } : {} })
    return data
  },

  async getGroups() {
    const { data } = await api.get('/codes/groups')
    return data
  },

  async create(codeData: { codeGroup: string; code: string; codeName: string; sortOrder?: number; description?: string }) {
    const { data } = await api.post('/codes', codeData)
    return data
  },

  async update(codeGroup: string, code: string, codeData: Record<string, any>) {
    const { data } = await api.put(`/codes/${codeGroup}/${code}`, codeData)
    return data
  },

  async remove(codeGroup: string, code: string) {
    const { data } = await api.delete(`/codes/${codeGroup}/${code}`)
    return data
  },
}
