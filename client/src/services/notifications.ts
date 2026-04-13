import api from './api'

export const notificationService = {
  async getList(params?: any) {
    return (await api.get('/notifications', { params })).data
  },
  async getUnreadCount() {
    return (await api.get('/notifications/unread-count')).data
  },
  async markRead(notifId: number) {
    return (await api.put(`/notifications/${notifId}/read`)).data
  },
  async markAllRead() {
    return (await api.put('/notifications/read-all')).data
  },
}
