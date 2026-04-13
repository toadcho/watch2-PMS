import api from './api'

export const calendarService = {
  async getData(projectId: number, params?: { year?: number; month?: number }) {
    const { data } = await api.get(`/projects/${projectId}/calendar`, { params })
    return data
  },

  async getEvents(projectId: number) {
    const { data } = await api.get(`/projects/${projectId}/calendar/events`)
    return data
  },

  async createEvent(projectId: number, body: any) {
    const { data } = await api.post(`/projects/${projectId}/calendar/events`, body)
    return data
  },

  async updateEvent(projectId: number, eventId: number, body: any) {
    const { data } = await api.put(`/projects/${projectId}/calendar/events/${eventId}`, body)
    return data
  },

  async removeEvent(projectId: number, eventId: number) {
    const { data } = await api.delete(`/projects/${projectId}/calendar/events/${eventId}`)
    return data
  },
}
