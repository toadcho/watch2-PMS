import api from './api'

export const docStorageService = {
  async getFolders(projectId: number) {
    return (await api.get(`/projects/${projectId}/doc-storage`)).data
  },
  async initFolders(projectId: number, force: boolean = false, type?: string) {
    return (await api.post(`/projects/${projectId}/doc-storage/init`, { force, type })).data
  },
  async refreshFolders(projectId: number, type?: string) {
    return (await api.post(`/projects/${projectId}/doc-storage/refresh`, { type })).data
  },
  async resetFolders(projectId: number, type?: string) {
    return (await api.post(`/projects/${projectId}/doc-storage/reset`, { type })).data
  },
  async uploadFiles(projectId: number, folderId: number, files: File[], description?: string) {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    if (description) fd.append('description', description)
    return (await api.post(`/projects/${projectId}/doc-storage/${folderId}/files`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })).data
  },
  async deleteFile(projectId: number, fileId: number) {
    return (await api.delete(`/projects/${projectId}/doc-storage/files/${fileId}`)).data
  },
  async lockFolder(projectId: number, folderId: number, isLocked: boolean) {
    return (await api.put(`/projects/${projectId}/doc-storage/${folderId}/lock`, { isLocked })).data
  },
  async syncLocks(projectId: number) {
    return (await api.post(`/projects/${projectId}/doc-storage/sync-locks`)).data
  },
}
