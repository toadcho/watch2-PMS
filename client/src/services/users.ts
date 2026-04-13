import api from './api'

export const userService = {
  async getList(params?: { page?: number; size?: number; keyword?: string; systemRole?: string; isActive?: string }) {
    const { data } = await api.get('/users', { params })
    return data
  },

  async getDetail(userId: string) {
    const { data } = await api.get(`/users/${userId}`)
    return data
  },

  async create(userData: {
    userId: string; userName: string; email: string; password: string;
    department?: string; position?: string; phone?: string; systemRole?: string;
  }) {
    const { data } = await api.post('/users', userData)
    return data
  },

  async update(userId: string, userData: Record<string, any>) {
    const { data } = await api.put(`/users/${userId}`, userData)
    return data
  },

  async deactivate(userId: string) {
    const { data } = await api.delete(`/users/${userId}`)
    return data
  },

  async uploadPhoto(userId: string, file: File) {
    const fd = new FormData()
    fd.append('photo', file)
    const { data } = await api.post(`/users/${userId}/photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    return data
  },
}
