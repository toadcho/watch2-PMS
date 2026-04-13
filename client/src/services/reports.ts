import api from './api'

export const reportService = {
  // 보고서 목록
  async getList(projectId: number, params?: any) {
    const { data } = await api.get(`/projects/${projectId}/reports`, { params })
    return data
  },

  // 보고서 상세
  async getDetail(projectId: number, reportId: number) {
    const { data } = await api.get(`/projects/${projectId}/reports/${reportId}`)
    return data
  },

  // 보고서 생성
  async create(projectId: number, body: { reportType: string; title: string; periodStart?: string; periodEnd?: string; nextStart?: string; nextEnd?: string }) {
    const { data } = await api.post(`/projects/${projectId}/reports`, body)
    return data
  },

  // 보고서 수정 (제목, 기간, 총괄소견)
  async update(projectId: number, reportId: number, body: any) {
    const { data } = await api.put(`/projects/${projectId}/reports/${reportId}`, body)
    return data
  },

  // 보고서 삭제
  async remove(projectId: number, reportId: number) {
    const { data } = await api.delete(`/projects/${projectId}/reports/${reportId}`)
    return data
  },

  // 작성 요청
  async requestWrite(projectId: number, reportId: number) {
    const { data } = await api.post(`/projects/${projectId}/reports/${reportId}/request-write`)
    return data
  },

  // 취합
  async consolidate(projectId: number, reportId: number) {
    const { data } = await api.post(`/projects/${projectId}/reports/${reportId}/consolidate`)
    return data
  },

  // 최종 완료
  async complete(projectId: number, reportId: number) {
    const { data } = await api.post(`/projects/${projectId}/reports/${reportId}/complete`)
    return data
  },

  // 자동 데이터 갱신
  async refresh(projectId: number, reportId: number) {
    const { data } = await api.post(`/projects/${projectId}/reports/${reportId}/refresh`)
    return data
  },

  // 팀 섹션 수정
  async updateSection(projectId: number, reportId: number, sectionId: number, body: any) {
    const { data } = await api.put(`/projects/${projectId}/reports/${reportId}/sections/${sectionId}`, body)
    return data
  },

  // 팀 섹션 추가
  async addSection(projectId: number, reportId: number, body: { teamName: string; writerId?: string; writerName?: string }) {
    const { data } = await api.post(`/projects/${projectId}/reports/${reportId}/sections`, body)
    return data
  },

  // 팀 섹션 삭제
  async removeSection(projectId: number, reportId: number, sectionId: number) {
    const { data } = await api.delete(`/projects/${projectId}/reports/${reportId}/sections/${sectionId}`)
    return data
  },

  // 레거시: 단순 보고서 데이터 생성
  async generate(projectId: number, type: string) {
    const { data } = await api.get(`/projects/${projectId}/reports/${type}`)
    return data
  },

  // DOCX 다운로드
  async exportDocx(projectId: number, reportId: number, title: string) {
    const res = await api.post(`/projects/${projectId}/reports/${reportId}/export/docx`, {}, { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a'); a.href = url; a.download = `${title}.docx`; a.click()
    window.URL.revokeObjectURL(url)
  },
}
