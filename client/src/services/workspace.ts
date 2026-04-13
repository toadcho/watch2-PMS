import api from './api'

export const workspaceService = {
  // 팀 목록
  async getTeams(projectId: number) {
    return (await api.get(`/projects/${projectId}/workspace/teams`)).data
  },

  // ── 웹폴더 ──
  async getFolders(projectId: number, teamDept: string) {
    return (await api.get(`/projects/${projectId}/workspace/folders`, { params: { teamDept } })).data
  },
  async createFolder(projectId: number, data: { teamDept: string; folderName: string; parentId?: number }) {
    return (await api.post(`/projects/${projectId}/workspace/folders`, data)).data
  },
  async updateFolder(projectId: number, folderId: number, data: { folderName: string }) {
    return (await api.put(`/projects/${projectId}/workspace/folders/${folderId}`, data)).data
  },
  async deleteFolder(projectId: number, folderId: number) {
    return (await api.delete(`/projects/${projectId}/workspace/folders/${folderId}`)).data
  },
  async uploadFiles(projectId: number, folderId: number, files: File[]) {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    return (await api.post(`/projects/${projectId}/workspace/folders/${folderId}/files`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })).data
  },
  async deleteFile(projectId: number, fileId: number) {
    return (await api.delete(`/projects/${projectId}/workspace/files/${fileId}`)).data
  },

  // ── 게시판 ──
  async getPosts(projectId: number, params?: any) {
    return (await api.get(`/projects/${projectId}/workspace/posts`, { params })).data
  },
  async createPost(projectId: number, formData: FormData) {
    return (await api.post(`/projects/${projectId}/workspace/posts`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })).data
  },
  async updatePost(projectId: number, postId: number, formData: FormData) {
    return (await api.put(`/projects/${projectId}/workspace/posts/${postId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })).data
  },
  async deletePost(projectId: number, postId: number) {
    return (await api.delete(`/projects/${projectId}/workspace/posts/${postId}`)).data
  },

  // ── 할일 ──
  async getTodos(projectId: number, params?: any) {
    return (await api.get(`/projects/${projectId}/workspace/todos`, { params })).data
  },
  async createTodo(projectId: number, data: any) {
    return (await api.post(`/projects/${projectId}/workspace/todos`, data)).data
  },
  async updateTodo(projectId: number, todoId: number, data: any) {
    return (await api.put(`/projects/${projectId}/workspace/todos/${todoId}`, data)).data
  },
  async deleteTodo(projectId: number, todoId: number) {
    return (await api.delete(`/projects/${projectId}/workspace/todos/${todoId}`)).data
  },

  // ── 메모/위키 ──
  async getMemos(projectId: number, params?: any) {
    return (await api.get(`/projects/${projectId}/workspace/memos`, { params })).data
  },
  async getMemo(projectId: number, memoId: number) {
    return (await api.get(`/projects/${projectId}/workspace/memos/${memoId}`)).data
  },
  async createMemo(projectId: number, data: any) {
    return (await api.post(`/projects/${projectId}/workspace/memos`, data)).data
  },
  async updateMemo(projectId: number, memoId: number, data: any) {
    return (await api.put(`/projects/${projectId}/workspace/memos/${memoId}`, data)).data
  },
  async deleteMemo(projectId: number, memoId: number) {
    return (await api.delete(`/projects/${projectId}/workspace/memos/${memoId}`)).data
  },
}
