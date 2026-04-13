import api from './api'

export const noticeService = {
  async getList(params?: any) { return (await api.get('/notices', { params })).data },

  async create(formData: FormData) {
    return (await api.post('/notices', formData, { headers: { 'Content-Type': 'multipart/form-data' } })).data
  },

  async update(noticeId: number, formData: FormData) {
    return (await api.put(`/notices/${noticeId}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })).data
  },

  async remove(noticeId: number) { return (await api.delete(`/notices/${noticeId}`)).data },

  // 게시판
  async getBoards(projectId: number, category?: string) { return (await api.get('/notices/boards', { params: { projectId, category } })).data },
  async createBoard(data: { projectId: number; boardName: string; description?: string; category?: string }) { return (await api.post('/notices/boards', data)).data },
  async updateBoard(boardId: number, data: any) { return (await api.put(`/notices/boards/${boardId}`, data)).data },
  async deleteBoard(boardId: number) { return (await api.delete(`/notices/boards/${boardId}`)).data },

  // 이미지 업로드 (에디터 붙여넣기)
  async uploadImage(file: File) {
    const fd = new FormData()
    fd.append('image', file)
    return (await api.post('/notices/upload-image', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data
  },
}
