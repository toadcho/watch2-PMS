import api from './api'

export const meetingRoomService = {
  async getRooms(projectId: number) { return (await api.get(`/projects/${projectId}/meeting-rooms`)).data },
  async createRoom(projectId: number, body: any) { return (await api.post(`/projects/${projectId}/meeting-rooms`, body)).data },
  async deleteRoom(projectId: number, roomId: number) { return (await api.delete(`/projects/${projectId}/meeting-rooms/${roomId}`)).data },
  async getBookings(projectId: number, year: number, month: number) { return (await api.get(`/projects/${projectId}/meeting-rooms/bookings`, { params: { year, month } })).data },
  async createBooking(projectId: number, body: any) { return (await api.post(`/projects/${projectId}/meeting-rooms/bookings`, body)).data },
  async updateBooking(projectId: number, bookingId: number, body: any) { return (await api.put(`/projects/${projectId}/meeting-rooms/bookings/${bookingId}`, body)).data },
  async deleteBooking(projectId: number, bookingId: number, deleteSeries = false) {
    return (await api.delete(`/projects/${projectId}/meeting-rooms/bookings/${bookingId}`, { params: deleteSeries ? { deleteSeries: 'true' } : {} })).data
  },
}
