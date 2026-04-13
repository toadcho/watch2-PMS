<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import UserTreePicker from '@/components/common/UserTreePicker.vue'
import PmsDatePicker from '@/components/common/PmsDatePicker.vue'
import { workspaceService } from '@/services/workspace'
import { projectService } from '@/services/projects'
import { useDialog } from '@/composables/useDialog'

const { showAlert, showConfirm } = useDialog()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)

const project = ref<any>(null)
const myRole = ref<any>(null)
const members = ref<any[]>([])
const teams = ref<string[]>([])
const selectedTeam = ref('')
const myDept = ref('')
const loading = ref(false)

const activeTab = ref('folders')

const isPmsAdmin = computed(() => myRole.value?.isPmsAdmin || false)
const isMyTeam = computed(() => selectedTeam.value === myDept.value)
const canEdit = computed(() => isPmsAdmin.value || isMyTeam.value)

// ════════════════════════════════════════════════════
//  1. 웹폴더
// ════════════════════════════════════════════════════
const folders = ref<any[]>([])
const selectedFolder = ref<any>(null)
const folderDialog = ref(false)
const folderForm = ref({ folderName: '', parentId: null as number | null })
const folderEditMode = ref(false)
const folderEditId = ref<number | null>(null)
const dragOver = ref(false)

async function fetchFolders() {
  if (!selectedTeam.value) { folders.value = []; return }
  try {
    const res = await workspaceService.getFolders(projectId, selectedTeam.value)
    if (res.success) folders.value = res.data
  } catch {}
}

function selectFolder(f: any) { selectedFolder.value = f }

function openFolderCreate(parentId: number | null = null) {
  folderEditMode.value = false; folderEditId.value = null
  folderForm.value = { folderName: '', parentId }
  folderDialog.value = true
}

function openFolderRename(f: any) {
  folderEditMode.value = true; folderEditId.value = f.wsFolderId
  folderForm.value = { folderName: f.folderName, parentId: f.parentId }
  folderDialog.value = true
}

async function saveFolder() {
  if (!folderForm.value.folderName) { await showAlert('폴더명을 입력하세요.', { color: 'error' }); return }
  try {
    if (folderEditMode.value && folderEditId.value) {
      await workspaceService.updateFolder(projectId, folderEditId.value, { folderName: folderForm.value.folderName })
    } else {
      await workspaceService.createFolder(projectId, {
        teamDept: selectedTeam.value,
        folderName: folderForm.value.folderName,
        parentId: folderForm.value.parentId || undefined,
      })
    }
    folderDialog.value = false
    await fetchFolders()
  } catch (err: any) { showAlert(err.response?.data?.message || '실패', { color: 'error' }) }
}

async function deleteFolder(f: any) {
  if (!(await showConfirm(`"${f.folderName}" 폴더를 삭제하시겠습니까?\n하위 폴더와 파일이 모두 삭제됩니다.`))) return
  try {
    await workspaceService.deleteFolder(projectId, f.wsFolderId)
    if (selectedFolder.value?.wsFolderId === f.wsFolderId) selectedFolder.value = null
    await fetchFolders()
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

async function uploadFiles(fileList: FileList | File[]) {
  if (!selectedFolder.value) { await showAlert('폴더를 선택하세요.', { color: 'error' }); return }
  const files = Array.from(fileList)
  if (!files.length) return
  try {
    await workspaceService.uploadFiles(projectId, selectedFolder.value.wsFolderId, files)
    await fetchFolders()
    // 재선택
    const flat = flattenFolders(folders.value)
    selectedFolder.value = flat.find((f: any) => f.wsFolderId === selectedFolder.value?.wsFolderId) || null
    await showAlert(`${files.length}개 파일이 업로드되었습니다.`)
  } catch (err: any) { showAlert(err.response?.data?.message || '업로드 실패', { color: 'error' }) }
}

function flattenFolders(list: any[]): any[] {
  const result: any[] = []
  for (const f of list) { result.push(f); if (f.children?.length) result.push(...flattenFolders(f.children)) }
  return result
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  if (e.dataTransfer?.files) uploadFiles(e.dataTransfer.files)
}

function onFileInput(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files) uploadFiles(files)
}

async function deleteFile(f: any) {
  if (!(await showConfirm(`"${f.fileName}" 파일을 삭제하시겠습니까?`))) return
  try {
    await workspaceService.deleteFile(projectId, f.wsFileId)
    await fetchFolders()
    const flat = flattenFolders(folders.value)
    selectedFolder.value = flat.find((fo: any) => fo.wsFolderId === selectedFolder.value?.wsFolderId) || null
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

function downloadFile(f: any) {
  const a = document.createElement('a')
  a.href = f.filePath; a.download = f.fileName; a.click()
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1024 / 1024).toFixed(1) + 'MB'
}

// ════════════════════════════════════════════════════
//  2. 게시판
// ════════════════════════════════════════════════════
const posts = ref<any[]>([])
const postExpanded = ref<number | null>(null)
const postDialog = ref(false)
const postEditMode = ref(false)
const postEditId = ref<number | null>(null)
const postForm = ref({ title: '', content: '', isPinned: false })
const postFiles = ref<File[]>([])
const postRemoveAttachIds = ref<number[]>([])
const postExistingAttach = ref<any[]>([])

async function fetchPosts() {
  if (!selectedTeam.value) { posts.value = []; return }
  try {
    const res = await workspaceService.getPosts(projectId, { teamDept: selectedTeam.value })
    if (res.success) posts.value = res.data
  } catch {}
}

function togglePost(id: number) {
  postExpanded.value = postExpanded.value === id ? null : id
}

function openPostCreate() {
  postEditMode.value = false; postEditId.value = null
  postForm.value = { title: '', content: '', isPinned: false }
  postFiles.value = []; postRemoveAttachIds.value = []; postExistingAttach.value = []
  postDialog.value = true
}

function openPostEdit(p: any) {
  postEditMode.value = true; postEditId.value = p.wsPostId
  postForm.value = { title: p.title, content: p.content || '', isPinned: p.isPinned }
  postFiles.value = []; postRemoveAttachIds.value = []
  postExistingAttach.value = [...(p.attachments || [])]
  postDialog.value = true
}

function canEditPost(p: any) {
  return isPmsAdmin.value || p.writerId === authStore.user?.userId
}

async function savePost() {
  if (!postForm.value.title) { await showAlert('제목을 입력하세요.', { color: 'error' }); return }
  const fd = new FormData()
  fd.append('teamDept', selectedTeam.value)
  fd.append('title', postForm.value.title)
  fd.append('content', postForm.value.content)
  fd.append('isPinned', String(postForm.value.isPinned))
  for (const f of postFiles.value) fd.append('files', f)
  if (postRemoveAttachIds.value.length) fd.append('removeAttachIds', JSON.stringify(postRemoveAttachIds.value))

  try {
    if (postEditMode.value && postEditId.value) {
      await workspaceService.updatePost(projectId, postEditId.value, fd)
    } else {
      await workspaceService.createPost(projectId, fd)
    }
    postDialog.value = false; await fetchPosts()
  } catch (err: any) { showAlert(err.response?.data?.message || '실패', { color: 'error' }) }
}

async function deletePost(p: any) {
  if (!(await showConfirm(`"${p.title}" 게시글을 삭제하시겠습니까?`))) return
  try {
    await workspaceService.deletePost(projectId, p.wsPostId)
    await fetchPosts()
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

function removeExistingAttach(att: any) {
  postRemoveAttachIds.value.push(att.wsAttachId)
  postExistingAttach.value = postExistingAttach.value.filter(a => a.wsAttachId !== att.wsAttachId)
}

// ════════════════════════════════════════════════════
//  3. 할일 (To-Do)
// ════════════════════════════════════════════════════
const todos = ref<any[]>([])
const todoFilter = ref('')
const todoDialog = ref(false)
const todoEditMode = ref(false)
const todoEditId = ref<number | null>(null)
const todoForm = ref({ title: '', description: '', priority: '보통', dueDate: '', assigneeId: '', assigneeName: '' })
const todoMultiAssigneeIds = ref<string[]>([])  // 신규 등록 시 멀티 담당자

// 현재 팀 소속 멤버만 (워크스페이스는 팀 내부 작업)
const teamMembers = computed(() => {
  if (!selectedTeam.value) return members.value
  return members.value.filter((m: any) => (m.user?.department || '') === selectedTeam.value)
})

const PRIORITY_ITEMS = [
  { title: '긴급', value: '긴급' }, { title: '높음', value: '높음' },
  { title: '보통', value: '보통' }, { title: '낮음', value: '낮음' },
]
const PRIORITY_COLORS: Record<string, string> = { '긴급': 'error', '높음': 'warning', '보통': 'primary', '낮음': 'grey' }
const STATUS_COLORS: Record<string, string> = { '할일': 'grey', '진행중': 'primary', '완료': 'success' }

const filteredTodos = computed(() => {
  if (!todoFilter.value) return todos.value
  return todos.value.filter(t => t.status === todoFilter.value)
})
const todoStats = computed(() => {
  const all = todos.value.length
  const done = todos.value.filter(t => t.status === '완료').length
  const prog = todos.value.filter(t => t.status === '진행중').length
  const pend = todos.value.filter(t => t.status === '할일').length
  return { all, done, prog, pend }
})

async function fetchTodos() {
  if (!selectedTeam.value) { todos.value = []; return }
  try {
    const res = await workspaceService.getTodos(projectId, { teamDept: selectedTeam.value })
    if (res.success) todos.value = res.data
  } catch {}
}

function openTodoCreate() {
  todoEditMode.value = false; todoEditId.value = null
  todoForm.value = { title: '', description: '', priority: '보통', dueDate: '', assigneeId: '', assigneeName: '' }
  todoMultiAssigneeIds.value = []
  todoDialog.value = true
}

function openTodoEdit(t: any) {
  todoEditMode.value = true; todoEditId.value = t.wsTodoId
  todoForm.value = {
    title: t.title, description: t.description || '',
    priority: t.priority, dueDate: t.dueDate ? t.dueDate.substring(0, 10) : '',
    assigneeId: t.assigneeId || '', assigneeName: t.assigneeName || '',
  }
  todoDialog.value = true
}

function canEditTodo(t: any) {
  return isPmsAdmin.value || t.createdBy === authStore.user?.userId || t.assigneeId === authStore.user?.userId
}

async function onTodoDevChange(userId: string) {
  todoForm.value.assigneeId = userId
  if (!userId) { todoForm.value.assigneeName = ''; return }
  const m = members.value.find((m: any) => (m.user?.userId || m.userId) === userId)
  if (m) todoForm.value.assigneeName = m.user?.userName || m.userName || userId
}

async function saveTodo() {
  if (!todoForm.value.title) { await showAlert('제목을 입력하세요.', { color: 'error' }); return }
  try {
    const baseData = {
      teamDept: selectedTeam.value,
      title: todoForm.value.title,
      description: todoForm.value.description || null,
      priority: todoForm.value.priority,
      dueDate: todoForm.value.dueDate || null,
    }
    if (todoEditMode.value && todoEditId.value) {
      // 수정: 단일 담당자
      await workspaceService.updateTodo(projectId, todoEditId.value, {
        ...baseData,
        assigneeId: todoForm.value.assigneeId || null,
        assigneeName: todoForm.value.assigneeName || null,
      })
    } else {
      // 신규: 멀티 담당자 지원
      const assigneeIds = todoMultiAssigneeIds.value.length > 0 ? todoMultiAssigneeIds.value : [''] // 빈 문자열 = 담당자 없음
      for (const uid of assigneeIds) {
        const m = uid ? teamMembers.value.find((m: any) => (m.user?.userId || m.userId) === uid) : null
        const name = m ? (m.user?.userName || m.userName || uid) : null
        await workspaceService.createTodo(projectId, {
          ...baseData,
          assigneeId: uid || null,
          assigneeName: name,
        })
      }
      if (assigneeIds.length > 1) {
        await showAlert(`${assigneeIds.length}명에게 할일이 등록되었습니다.`)
      }
    }
    todoDialog.value = false; await fetchTodos()
  } catch (err: any) { showAlert(err.response?.data?.message || '실패', { color: 'error' }) }
}

async function toggleTodoStatus(t: any) {
  const next = t.status === '할일' ? '진행중' : t.status === '진행중' ? '완료' : '할일'
  try {
    await workspaceService.updateTodo(projectId, t.wsTodoId, { status: next })
    await fetchTodos()
  } catch {}
}

async function deleteTodo(t: any) {
  if (!(await showConfirm(`"${t.title}" 할일을 삭제하시겠습니까?`))) return
  try {
    await workspaceService.deleteTodo(projectId, t.wsTodoId)
    await fetchTodos()
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

function fmtDate(d: string | null) { return d ? d.substring(0, 10) : '' }
function isOverdue(t: any) {
  if (t.status === '완료' || !t.dueDate) return false
  const due = new Date(t.dueDate); due.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return due < today
}

// ════════════════════════════════════════════════════
//  4. 메모/위키
// ════════════════════════════════════════════════════
const memos = ref<any[]>([])
const memoFilter = ref('')
const selectedMemo = ref<any>(null)
const memoDialog = ref(false)
const memoEditMode = ref(false)
const memoEditId = ref<number | null>(null)
const memoForm = ref({ title: '', content: '', category: '일반', isPinned: false })

const MEMO_CATEGORIES = ['일반', '개발컨벤션', '서버정보', '업무노하우', '기타']
const MEMO_CAT_COLORS: Record<string, string> = {
  '일반': 'grey', '개발컨벤션': 'primary', '서버정보': 'warning', '업무노하우': 'success', '기타': 'info',
}
const MEMO_CAT_ICONS: Record<string, string> = {
  '일반': 'mdi-note-text', '개발컨벤션': 'mdi-code-braces', '서버정보': 'mdi-server', '업무노하우': 'mdi-lightbulb-on', '기타': 'mdi-dots-horizontal-circle',
}

const filteredMemos = computed(() => {
  if (!memoFilter.value) return memos.value
  return memos.value.filter(m => m.category === memoFilter.value)
})

async function fetchMemos() {
  if (!selectedTeam.value) { memos.value = []; return }
  try {
    const res = await workspaceService.getMemos(projectId, { teamDept: selectedTeam.value })
    if (res.success) memos.value = res.data
  } catch {}
}

function openMemoCreate() {
  memoEditMode.value = false; memoEditId.value = null
  memoForm.value = { title: '', content: '', category: '일반', isPinned: false }
  memoDialog.value = true
}

function openMemoEdit(m: any) {
  memoEditMode.value = true; memoEditId.value = m.wsMemoId
  memoForm.value = { title: m.title, content: m.content || '', category: m.category, isPinned: m.isPinned }
  memoDialog.value = true
}

function viewMemo(m: any) {
  selectedMemo.value = selectedMemo.value?.wsMemoId === m.wsMemoId ? null : m
}

function canEditMemo(m: any) {
  return isPmsAdmin.value || m.writerId === authStore.user?.userId
}

async function saveMemo() {
  if (!memoForm.value.title) { await showAlert('제목을 입력하세요.', { color: 'error' }); return }
  try {
    const data = {
      teamDept: selectedTeam.value,
      title: memoForm.value.title,
      content: memoForm.value.content,
      category: memoForm.value.category,
      isPinned: memoForm.value.isPinned,
    }
    if (memoEditMode.value && memoEditId.value) {
      await workspaceService.updateMemo(projectId, memoEditId.value, data)
    } else {
      await workspaceService.createMemo(projectId, data)
    }
    memoDialog.value = false; await fetchMemos()
    // 수정 후 선택 갱신
    if (memoEditMode.value && selectedMemo.value?.wsMemoId === memoEditId.value) {
      selectedMemo.value = memos.value.find((m: any) => m.wsMemoId === memoEditId.value) || null
    }
  } catch (err: any) { showAlert(err.response?.data?.message || '실패', { color: 'error' }) }
}

async function deleteMemo(m: any) {
  if (!(await showConfirm(`"${m.title}" 메모를 삭제하시겠습니까?`))) return
  try {
    await workspaceService.deleteMemo(projectId, m.wsMemoId)
    if (selectedMemo.value?.wsMemoId === m.wsMemoId) selectedMemo.value = null
    await fetchMemos()
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

// ════════════════════════════════════════════════════
//  Init
// ════════════════════════════════════════════════════
watch(selectedTeam, () => {
  selectedFolder.value = null
  postExpanded.value = null
  selectedMemo.value = null
  fetchFolders(); fetchPosts(); fetchTodos(); fetchMemos()
})

onMounted(async () => {
  loading.value = true
  try {
    const [p, r, m, t] = await Promise.all([
      projectService.getDetail(projectId),
      projectService.getMyRole(projectId).catch(() => null),
      projectService.getMembers(projectId).catch(() => null),
      workspaceService.getTeams(projectId),
    ])
    if (p.success) project.value = p.data
    if (r?.success) myRole.value = r.data
    if (m?.success) members.value = m.data
    if (t.success) teams.value = t.data

    // 내 부서 찾기
    const me = members.value.find((m: any) => (m.user?.userId || m.userId) === authStore.user?.userId)
    myDept.value = me?.user?.department || me?.department || ''

    // 기본 선택: 내 팀
    if (myDept.value && teams.value.includes(myDept.value)) {
      selectedTeam.value = myDept.value
    } else if (teams.value.length) {
      selectedTeam.value = teams.value[0]
    }
  } catch (err) { console.error(err) }
  finally { loading.value = false }
})
</script>

<template>
  <MainLayout>
    <v-row class="mb-1" align="center" dense>
      <v-col>
        <span class="pms-page-title">WorkSpace</span>
        <span class="pms-page-subtitle">{{ project?.projectName }}</span>
      </v-col>
    </v-row>

    <!-- 팀 선택 + 탭 -->
    <div class="d-flex align-center mb-2" style="gap:12px">
      <v-select
        v-model="selectedTeam" :items="teams" label="팀 선택"
        hide-details variant="outlined" density="compact"
        class="pms-filter" style="max-width:200px"
        :disabled="!isPmsAdmin && teams.length <= 1"
      />
      <v-chip v-if="isMyTeam" size="x-small" color="primary" variant="tonal">내 팀</v-chip>
      <v-chip v-if="!isPmsAdmin && teams.length <= 1" size="x-small" color="grey" variant="tonal">내 팀 전용</v-chip>
    </div>

    <v-tabs v-model="activeTab" density="compact" color="primary" class="mb-2">
      <v-tab value="folders" size="small"><v-icon size="14" class="mr-1">mdi-folder</v-icon>웹폴더</v-tab>
      <v-tab value="posts" size="small"><v-icon size="14" class="mr-1">mdi-bulletin-board</v-icon>게시판</v-tab>
      <v-tab value="todos" size="small"><v-icon size="14" class="mr-1">mdi-checkbox-marked-outline</v-icon>할일</v-tab>
      <v-tab value="memos" size="small"><v-icon size="14" class="mr-1">mdi-note-edit</v-icon>메모/위키</v-tab>
    </v-tabs>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-1" />

    <!-- ═══ 1. 웹폴더 탭 ═══ -->
    <div v-if="activeTab === 'folders'">
      <div v-if="!selectedTeam" class="text-center pa-8" style="color:var(--pms-text-hint)">팀을 선택하세요.</div>
      <v-row v-else dense>
        <!-- 폴더 트리 -->
        <v-col cols="4">
          <div class="pms-card pa-2" style="min-height:400px">
            <div class="d-flex align-center mb-2">
              <span style="font-size:var(--pms-font-body); font-weight:600">폴더</span>
              <v-spacer />
              <v-btn v-if="canEdit" size="x-small" variant="text" color="primary" icon @click="openFolderCreate()"><v-icon size="16">mdi-folder-plus</v-icon></v-btn>
            </div>
            <div v-if="!folders.length" class="text-center pa-4" style="color:var(--pms-text-hint); font-size:var(--pms-font-caption)">폴더가 없습니다. 새 폴더를 생성하세요.</div>
            <template v-for="f in folders" :key="f.wsFolderId">
              <div
                class="folder-item" :class="{ active: selectedFolder?.wsFolderId === f.wsFolderId }"
                @click="selectFolder(f)"
              >
                <v-icon size="16" class="mr-1" :color="selectedFolder?.wsFolderId === f.wsFolderId ? 'primary' : ''">mdi-folder</v-icon>
                <span style="flex:1; font-size:var(--pms-font-body)">{{ f.folderName }}</span>
                <span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ f.files?.length || 0 }}</span>
                <v-menu v-if="canEdit" location="bottom end">
                  <template #activator="{ props: mp }">
                    <v-btn v-bind="mp" icon size="x-small" variant="text" @click.stop><v-icon size="12">mdi-dots-vertical</v-icon></v-btn>
                  </template>
                  <v-list density="compact">
                    <v-list-item @click="openFolderCreate(f.wsFolderId)"><v-list-item-title style="font-size:var(--pms-font-body)">하위 폴더 생성</v-list-item-title></v-list-item>
                    <v-list-item @click="openFolderRename(f)"><v-list-item-title style="font-size:var(--pms-font-body)">이름 변경</v-list-item-title></v-list-item>
                    <v-list-item @click="deleteFolder(f)"><v-list-item-title style="font-size:var(--pms-font-body); color:var(--pms-error)">삭제</v-list-item-title></v-list-item>
                  </v-list>
                </v-menu>
              </div>
              <!-- children (depth 1) -->
              <div v-for="c in f.children" :key="c.wsFolderId"
                class="folder-item" :class="{ active: selectedFolder?.wsFolderId === c.wsFolderId }"
                style="padding-left:28px" @click="selectFolder(c)"
              >
                <v-icon size="14" class="mr-1" :color="selectedFolder?.wsFolderId === c.wsFolderId ? 'primary' : ''">mdi-folder-outline</v-icon>
                <span style="flex:1; font-size:var(--pms-font-body)">{{ c.folderName }}</span>
                <span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ c.files?.length || 0 }}</span>
                <v-menu v-if="canEdit" location="bottom end">
                  <template #activator="{ props: mp }">
                    <v-btn v-bind="mp" icon size="x-small" variant="text" @click.stop><v-icon size="12">mdi-dots-vertical</v-icon></v-btn>
                  </template>
                  <v-list density="compact">
                    <v-list-item @click="openFolderRename(c)"><v-list-item-title style="font-size:var(--pms-font-body)">이름 변경</v-list-item-title></v-list-item>
                    <v-list-item @click="deleteFolder(c)"><v-list-item-title style="font-size:var(--pms-font-body); color:var(--pms-error)">삭제</v-list-item-title></v-list-item>
                  </v-list>
                </v-menu>
              </div>
            </template>
          </div>
        </v-col>

        <!-- 파일 목록 -->
        <v-col cols="8">
          <div class="pms-card pa-3" style="min-height:400px"
            @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop.prevent="onDrop"
            :class="{ 'drag-over': dragOver }"
          >
            <div v-if="!selectedFolder" class="text-center pa-8" style="color:var(--pms-text-hint)">폴더를 선택하세요.</div>
            <template v-else>
              <div class="d-flex align-center mb-2">
                <v-icon size="16" class="mr-1" color="primary">mdi-folder-open</v-icon>
                <span style="font-size:var(--pms-font-body); font-weight:600">{{ selectedFolder.folderName }}</span>
                <v-spacer />
                <label v-if="canEdit" class="upload-btn">
                  <v-btn size="x-small" color="primary" variant="outlined" prepend-icon="mdi-upload" @click="($refs.fileInput as HTMLInputElement)?.click()">파일 업로드</v-btn>
                </label>
                <input ref="fileInput" type="file" multiple hidden @change="onFileInput" />
              </div>
              <div v-if="!selectedFolder.files?.length" class="text-center pa-6" style="color:var(--pms-text-hint); font-size:var(--pms-font-body)">
                파일이 없습니다.<br/>파일을 드래그하여 업로드하세요.
              </div>
              <table v-else class="pms-table" style="width:100%">
                <thead>
                  <tr>
                    <th>파일명</th>
                    <th style="width:80px">크기</th>
                    <th style="width:80px">등록자</th>
                    <th style="width:90px">등록일</th>
                    <th v-if="canEdit" style="width:60px"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="f in selectedFolder.files" :key="f.wsFileId">
                    <td>
                      <a :href="f.filePath" :download="f.fileName" style="color:var(--pms-primary); text-decoration:none; font-size:var(--pms-font-body)">
                        <v-icon size="14" class="mr-1">mdi-file-document-outline</v-icon>{{ f.fileName }}
                      </a>
                    </td>
                    <td style="font-size:var(--pms-font-caption)">{{ formatFileSize(Number(f.fileSize)) }}</td>
                    <td style="font-size:var(--pms-font-caption)">{{ f.uploaderName || '' }}</td>
                    <td style="font-size:var(--pms-font-caption)">{{ fmtDate(f.createdAt) }}</td>
                    <td v-if="canEdit" class="text-center">
                      <v-btn icon size="x-small" variant="text" color="error" @click="deleteFile(f)"><v-icon size="14">mdi-delete</v-icon></v-btn>
                    </td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>
        </v-col>
      </v-row>
    </div>

    <!-- ═══ 2. 게시판 탭 ═══ -->
    <div v-if="activeTab === 'posts'">
      <div v-if="!selectedTeam" class="text-center pa-8" style="color:var(--pms-text-hint)">팀을 선택하세요.</div>
      <template v-else>
        <div class="d-flex align-center mb-2">
          <v-spacer />
          <v-btn v-if="canEdit" size="x-small" color="primary" prepend-icon="mdi-plus" @click="openPostCreate">글쓰기</v-btn>
        </div>
        <div v-if="!posts.length" class="text-center pa-8 pms-card" style="color:var(--pms-text-hint)">게시글이 없습니다.</div>
        <div v-for="p in posts" :key="p.wsPostId" class="pms-card mb-1">
          <div class="post-header" @click="togglePost(p.wsPostId)">
            <v-icon v-if="p.isPinned" size="14" color="warning" class="mr-1">mdi-pin</v-icon>
            <span style="font-weight:600; font-size:var(--pms-font-body); flex:1">{{ p.title }}</span>
            <span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">{{ p.writerName }} · {{ fmtDate(p.createdAt) }}</span>
            <v-icon size="16" class="ml-1">{{ postExpanded === p.wsPostId ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
          </div>
          <div v-if="postExpanded === p.wsPostId" class="pa-3" style="border-top:1px solid var(--pms-border-light, #eee)">
            <div style="font-size:var(--pms-font-body); white-space:pre-wrap; min-height:40px" v-html="p.content"></div>
            <div v-if="p.attachments?.length" class="mt-2">
              <div v-for="att in p.attachments" :key="att.wsAttachId" style="font-size:var(--pms-font-caption)">
                <a :href="att.filePath" :download="att.fileName" style="color:var(--pms-primary)">
                  <v-icon size="12">mdi-paperclip</v-icon> {{ att.fileName }}
                </a>
              </div>
            </div>
            <div v-if="canEditPost(p)" class="d-flex mt-2" style="gap:4px">
              <v-btn size="x-small" variant="text" @click.stop="openPostEdit(p)">수정</v-btn>
              <v-btn size="x-small" variant="text" color="error" @click.stop="deletePost(p)">삭제</v-btn>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- ═══ 3. 할일 탭 ═══ -->
    <div v-if="activeTab === 'todos'">
      <div v-if="!selectedTeam" class="text-center pa-8" style="color:var(--pms-text-hint)">팀을 선택하세요.</div>
      <template v-else>
        <!-- 통계 -->
        <v-row dense class="mb-2">
          <v-col cols="3"><div class="stat-card" @click="todoFilter = ''" style="cursor:pointer"><div class="sc-pct">{{ todoStats.all }}</div><div class="sc-label">전체</div></div></v-col>
          <v-col cols="3"><div class="stat-card" style="border-left:3px solid var(--pms-text-hint); cursor:pointer" @click="todoFilter = '할일'"><div class="sc-pct" style="color:grey">{{ todoStats.pend }}</div><div class="sc-label">할일</div></div></v-col>
          <v-col cols="3"><div class="stat-card" style="border-left:3px solid var(--pms-primary); cursor:pointer" @click="todoFilter = '진행중'"><div class="sc-pct" style="color:var(--pms-primary)">{{ todoStats.prog }}</div><div class="sc-label">진행중</div></div></v-col>
          <v-col cols="3"><div class="stat-card" style="border-left:3px solid var(--pms-success); cursor:pointer" @click="todoFilter = '완료'"><div class="sc-pct" style="color:var(--pms-success)">{{ todoStats.done }}</div><div class="sc-label">완료</div></div></v-col>
        </v-row>
        <div class="d-flex align-center mb-2">
          <v-chip v-if="todoFilter" size="x-small" closable @click:close="todoFilter = ''">{{ todoFilter }}</v-chip>
          <v-spacer />
          <v-btn v-if="canEdit" size="x-small" color="primary" prepend-icon="mdi-plus" @click="openTodoCreate">할일 등록</v-btn>
        </div>
        <div v-if="!filteredTodos.length" class="text-center pa-8 pms-card" style="color:var(--pms-text-hint)">할일이 없습니다.</div>
        <div v-for="t in filteredTodos" :key="t.wsTodoId" class="pms-card mb-1 pa-2 d-flex align-center" style="gap:8px">
          <v-btn icon size="x-small" variant="tonal" :color="STATUS_COLORS[t.status] || 'grey'" @click="canEditTodo(t) ? toggleTodoStatus(t) : null" :title="t.status">
            <v-icon size="16">{{ t.status === '완료' ? 'mdi-check-circle' : t.status === '진행중' ? 'mdi-progress-clock' : 'mdi-circle-outline' }}</v-icon>
          </v-btn>
          <div style="flex:1; min-width:0">
            <div class="d-flex align-center" style="gap:4px">
              <v-chip size="x-small" :color="PRIORITY_COLORS[t.priority]" variant="tonal">{{ t.priority }}</v-chip>
              <span style="font-size:var(--pms-font-body); font-weight:500" :class="{ 'text-decoration-line-through': t.status === '완료' }">{{ t.title }}</span>
            </div>
            <div style="font-size:var(--pms-font-mini); color:var(--pms-text-hint); margin-top:1px">
              <span v-if="t.assigneeName">{{ t.assigneeName }}</span>
              <span v-if="t.dueDate" :style="isOverdue(t) ? 'color:var(--pms-error); font-weight:600' : ''"> · {{ fmtDate(t.dueDate) }}{{ isOverdue(t) ? ' (기한초과)' : '' }}</span>
            </div>
          </div>
          <template v-if="canEditTodo(t)">
            <v-btn icon size="x-small" variant="text" @click="openTodoEdit(t)"><v-icon size="14">mdi-pencil</v-icon></v-btn>
            <v-btn icon size="x-small" variant="text" color="error" @click="deleteTodo(t)"><v-icon size="14">mdi-delete</v-icon></v-btn>
          </template>
        </div>
      </template>
    </div>

    <!-- ═══ 4. 메모/위키 탭 ═══ -->
    <div v-if="activeTab === 'memos'">
      <div v-if="!selectedTeam" class="text-center pa-8" style="color:var(--pms-text-hint)">팀을 선택하세요.</div>
      <template v-else>
        <div class="d-flex align-center mb-2" style="gap:6px">
          <v-chip size="x-small" :variant="memoFilter === '' ? 'flat' : 'outlined'" color="grey" @click="memoFilter = ''">전체</v-chip>
          <v-chip v-for="cat in MEMO_CATEGORIES" :key="cat" size="x-small" :variant="memoFilter === cat ? 'flat' : 'outlined'" :color="MEMO_CAT_COLORS[cat]" @click="memoFilter = memoFilter === cat ? '' : cat">{{ cat }}</v-chip>
          <v-spacer />
          <v-btn v-if="canEdit" size="x-small" color="primary" prepend-icon="mdi-plus" @click="openMemoCreate">메모 작성</v-btn>
        </div>
        <v-row dense>
          <!-- 메모 목록 (좌) -->
          <v-col cols="4">
            <div class="pms-card pa-2" style="min-height:400px; max-height:600px; overflow-y:auto">
              <div v-if="!filteredMemos.length" class="text-center pa-6" style="color:var(--pms-text-hint); font-size:var(--pms-font-body)">메모가 없습니다.</div>
              <div v-for="m in filteredMemos" :key="m.wsMemoId"
                class="memo-item" :class="{ active: selectedMemo?.wsMemoId === m.wsMemoId }"
                @click="viewMemo(m)"
              >
                <div class="d-flex align-center" style="gap:4px">
                  <v-icon v-if="m.isPinned" size="12" color="warning">mdi-pin</v-icon>
                  <v-icon size="14" :color="MEMO_CAT_COLORS[m.category]">{{ MEMO_CAT_ICONS[m.category] || 'mdi-note-text' }}</v-icon>
                  <span style="font-size:var(--pms-font-body); font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ m.title }}</span>
                </div>
                <div style="font-size:var(--pms-font-mini); color:var(--pms-text-hint); margin-top:2px">
                  <v-chip size="x-small" :color="MEMO_CAT_COLORS[m.category]" variant="tonal" class="mr-1">{{ m.category }}</v-chip>
                  {{ m.writerName }} · {{ fmtDate(m.updatedAt) }}
                </div>
              </div>
            </div>
          </v-col>

          <!-- 메모 본문 (우) -->
          <v-col cols="8">
            <div class="pms-card pa-3" style="min-height:400px">
              <div v-if="!selectedMemo" class="text-center pa-8" style="color:var(--pms-text-hint)">메모를 선택하세요.</div>
              <template v-else>
                <div class="d-flex align-center mb-2">
                  <v-icon size="16" :color="MEMO_CAT_COLORS[selectedMemo.category]" class="mr-1">{{ MEMO_CAT_ICONS[selectedMemo.category] || 'mdi-note-text' }}</v-icon>
                  <span style="font-size:var(--pms-font-subtitle); font-weight:700; flex:1">{{ selectedMemo.title }}</span>
                  <v-chip size="x-small" :color="MEMO_CAT_COLORS[selectedMemo.category]" variant="tonal" class="mr-2">{{ selectedMemo.category }}</v-chip>
                  <template v-if="canEditMemo(selectedMemo)">
                    <v-btn size="x-small" variant="text" @click="openMemoEdit(selectedMemo)"><v-icon size="14">mdi-pencil</v-icon></v-btn>
                    <v-btn size="x-small" variant="text" color="error" @click="deleteMemo(selectedMemo)"><v-icon size="14">mdi-delete</v-icon></v-btn>
                  </template>
                </div>
                <div style="font-size:var(--pms-font-mini); color:var(--pms-text-hint); margin-bottom:8px; border-bottom:1px solid var(--pms-border-light, #eee); padding-bottom:6px">
                  작성: {{ selectedMemo.writerName }} ({{ fmtDate(selectedMemo.createdAt) }})
                  <template v-if="selectedMemo.lastEditorName"> · 최종수정: {{ selectedMemo.lastEditorName }} ({{ fmtDate(selectedMemo.updatedAt) }})</template>
                </div>
                <div class="memo-content" v-html="selectedMemo.content"></div>
              </template>
            </div>
          </v-col>
        </v-row>
      </template>
    </div>

    <!-- ═══ 폴더 다이얼로그 ═══ -->
    <v-dialog v-model="folderDialog" max-width="400" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">{{ folderEditMode ? '폴더 이름 변경' : '새 폴더' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="folderForm.folderName" variant="outlined" density="compact" hide-details class="pms-form" autofocus @keyup.enter="saveFolder">
            <template #label>폴더명<span class="pms-required">*</span></template>
          </v-text-field>
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn size="small" variant="outlined" @click="folderDialog = false">취소</v-btn><v-btn size="small" color="primary" @click="saveFolder">저장</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ═══ 게시판 다이얼로그 ═══ -->
    <v-dialog v-model="postDialog" max-width="600" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">{{ postEditMode ? '게시글 수정' : '게시글 작성' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="postForm.title" variant="outlined" density="compact" hide-details class="pms-form mb-2" autofocus>
            <template #label>제목<span class="pms-required">*</span></template>
          </v-text-field>
          <v-textarea v-model="postForm.content" label="내용" variant="outlined" density="compact" hide-details class="pms-form mb-2" rows="6" auto-grow />
          <v-switch v-model="postForm.isPinned" label="고정글" density="compact" hide-details color="warning" />
          <!-- 기존 첨부 -->
          <div v-if="postExistingAttach.length" class="mb-2">
            <div v-for="att in postExistingAttach" :key="att.wsAttachId" class="d-flex align-center" style="gap:4px; font-size:var(--pms-font-caption)">
              <v-icon size="12">mdi-paperclip</v-icon>{{ att.fileName }}
              <v-btn icon size="x-small" variant="text" color="error" @click="removeExistingAttach(att)"><v-icon size="12">mdi-close</v-icon></v-btn>
            </div>
          </div>
          <!-- 새 첨부 -->
          <v-file-input v-model="postFiles" label="첨부파일" variant="outlined" density="compact" hide-details class="pms-form" multiple prepend-icon="" prepend-inner-icon="mdi-paperclip" />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn size="small" variant="outlined" @click="postDialog = false">취소</v-btn><v-btn size="small" color="primary" @click="savePost">저장</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ═══ 메모 다이얼로그 ═══ -->
    <v-dialog v-model="memoDialog" max-width="700" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">{{ memoEditMode ? '메모 수정' : '메모 작성' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="memoForm.title" variant="outlined" density="compact" hide-details class="pms-form mb-2" autofocus>
            <template #label>제목<span class="pms-required">*</span></template>
          </v-text-field>
          <v-row dense class="mb-2">
            <v-col cols="6">
              <v-select v-model="memoForm.category" :items="MEMO_CATEGORIES" label="분류" variant="outlined" density="compact" hide-details class="pms-form" />
            </v-col>
            <v-col cols="6" class="d-flex align-center">
              <v-switch v-model="memoForm.isPinned" label="고정(핀)" density="compact" hide-details color="warning" />
            </v-col>
          </v-row>
          <v-textarea v-model="memoForm.content" label="내용 (HTML 지원)" variant="outlined" density="compact" hide-details class="pms-form" rows="12" auto-grow placeholder="팀 내부 공유 정보를 작성하세요.&#10;HTML 태그 사용 가능 (<b>굵게</b>, <code>코드</code>, <ul><li>목록</li></ul> 등)" />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn size="small" variant="outlined" @click="memoDialog = false">취소</v-btn><v-btn size="small" color="primary" @click="saveMemo">저장</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ═══ 할일 다이얼로그 ═══ -->
    <v-dialog v-model="todoDialog" max-width="500" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">{{ todoEditMode ? '할일 수정' : '할일 등록' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="todoForm.title" variant="outlined" density="compact" hide-details class="pms-form mb-2" autofocus>
            <template #label>제목<span class="pms-required">*</span></template>
          </v-text-field>
          <v-textarea v-model="todoForm.description" label="설명" variant="outlined" density="compact" hide-details class="pms-form mb-2" rows="3" auto-grow />
          <v-row dense class="mb-2">
            <v-col cols="6">
              <v-select v-model="todoForm.priority" :items="PRIORITY_ITEMS" label="우선순위" variant="outlined" density="compact" hide-details class="pms-form" />
            </v-col>
            <v-col cols="6">
              <PmsDatePicker v-model="todoForm.dueDate" label="기한" />
            </v-col>
          </v-row>
          <!-- 수정 모드: 단일 담당자 (현재 팀 멤버만) -->
          <UserTreePicker v-if="todoEditMode" :model-value="todoForm.assigneeId" @update:model-value="onTodoDevChange" :members="teamMembers" label="담당자" class="pms-form" hide-details clearable />
          <!-- 신규 등록: 멀티 담당자 (현재 팀 멤버만) -->
          <v-autocomplete
            v-else
            v-model="todoMultiAssigneeIds"
            :items="teamMembers.map((m: any) => ({ value: m.user?.userId || m.userId, title: `${m.user?.userName || m.userName} [${m.role}]` }))"
            :label="`담당자 (복수 선택 가능) — ${selectedTeam} 소속`"
            multiple
            chips
            closable-chips
            clearable
            variant="outlined"
            density="compact"
            hide-details
            class="pms-form"
            no-data-text="팀 멤버가 없습니다."
          />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn size="small" variant="outlined" @click="todoDialog = false">취소</v-btn><v-btn size="small" color="primary" @click="saveTodo">저장</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </MainLayout>
</template>

<style scoped>
.folder-item {
  display: flex; align-items: center; padding: 4px 8px; border-radius: var(--pms-radius);
  cursor: pointer; transition: background 0.15s; gap: 2px;
}
.folder-item:hover { background: var(--pms-hover, #f5f5f5); }
.folder-item.active { background: rgba(var(--v-theme-primary), 0.08); }
.drag-over { outline: 2px dashed var(--pms-primary); outline-offset: -2px; background: rgba(var(--v-theme-primary), 0.03); }
.post-header {
  display: flex; align-items: center; padding: 10px 12px; cursor: pointer; gap: 4px;
}
.post-header:hover { background: var(--pms-hover, #f5f5f5); }
.stat-card {
  background: var(--pms-surface); border: 1px solid var(--pms-border);
  border-radius: var(--pms-radius); padding: 8px 12px; border-left: 3px solid var(--pms-border);
  text-align: center;
}
.sc-pct { font-size: 22px; font-weight: 700; line-height: 1.2; }
.sc-label { font-size: var(--pms-font-caption); color: var(--pms-text-hint); margin-top: 2px; }
.memo-item {
  padding: 6px 8px; border-radius: var(--pms-radius); cursor: pointer;
  transition: background 0.15s; border-bottom: 1px solid var(--pms-border-light, #eee);
}
.memo-item:hover { background: var(--pms-hover, #f5f5f5); }
.memo-item.active { background: rgba(var(--v-theme-primary), 0.08); }
.memo-content {
  font-size: var(--pms-font-body); line-height: 1.7; white-space: pre-wrap; word-break: break-word;
}
.memo-content :deep(code) {
  background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; font-family: 'Consolas', monospace;
}
.memo-content :deep(pre) {
  background: #f8f8f8; padding: 8px 12px; border-radius: 4px; overflow-x: auto; font-size: 0.9em; border: 1px solid #e0e0e0;
}
.memo-content :deep(ul), .memo-content :deep(ol) { padding-left: 20px; }
.memo-content :deep(h1), .memo-content :deep(h2), .memo-content :deep(h3) { margin-top: 12px; margin-bottom: 4px; }
</style>
