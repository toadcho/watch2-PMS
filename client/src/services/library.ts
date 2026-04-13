import api from './api'

export const libraryService = {
  async getList(projectId: number, params?: any) {
    return (await api.get(`/projects/${projectId}/library`, { params })).data
  },
  async upload(projectId: number, file: File, data: { title?: string; description?: string; category?: string }, onProgress?: (pct: number) => void) {
    const fd = new FormData()
    fd.append('file', file)
    if (data.title) fd.append('title', data.title)
    if (data.description) fd.append('description', data.description)
    if (data.category) fd.append('category', data.category)
    return (await api.post(`/projects/${projectId}/library`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 600000, // 10분 타임아웃 (대용량)
      onUploadProgress: (e: any) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
      },
    })).data
  },
  async update(projectId: number, fileId: number, data: any) {
    return (await api.put(`/projects/${projectId}/library/${fileId}`, data)).data
  },
  async remove(projectId: number, fileId: number) {
    return (await api.delete(`/projects/${projectId}/library/${fileId}`)).data
  },
  async download(projectId: number, fileId: number, fileName: string, onProgress?: (pct: number) => void) {
    const res = await api.get(`/projects/${projectId}/library/${fileId}/download`, {
      responseType: 'blob',
      timeout: 600000,
      onDownloadProgress: (e: any) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
      },
    })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a')
    a.href = url; a.download = fileName; a.click()
    window.URL.revokeObjectURL(url)
  },
}
