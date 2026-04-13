import api from './api'

export const auditLogService = {
  async getList(params?: {
    page?: number; size?: number;
    userId?: string; action?: string; targetType?: string;
    startDate?: string; endDate?: string;
  }) {
    const { data } = await api.get('/audit-logs', { params })
    return data
  },
}
