<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MainLayout from '@/components/common/MainLayout.vue'
import UserTreePicker from '@/components/common/UserTreePicker.vue'
import { issueService } from '@/services/issues'
import { userService } from '@/services/users'
import { projectService } from '@/services/projects'
import { useDialog } from '@/composables/useDialog'
import type { Issue, User, Project } from '@/types'

const { showAlert, showConfirm } = useDialog()

const route = useRoute()
const router = useRouter()
const projectId = Number(route.params.projectId)

const project = ref<Project | null>(null)
const issues = ref<Issue[]>([])
const users = ref<User[]>([])
const members = ref<any[]>([])
const loading = ref(false)
const totalCount = ref(0)

const dialog = ref(false)
const editMode = ref(false)
const editId = ref<number | null>(null)
const form = ref({ issueTitle: '', description: '', priority: '보통', status: '등록', assigneeId: '' })

const priorities = ['긴급', '높음', '보통', '낮음']
const statuses = ['등록', '진행중', '해결', '종료']

const headers = [
  { title: '제목', key: 'issueTitle' },
  { title: '우선순위', key: 'priority', width: '90px' },
  { title: '상태', key: 'status', width: '90px' },
  { title: '등록자', key: 'reporterName', width: '90px' },
  { title: '담당자', key: 'assigneeName', width: '90px' },
  { title: '등록일', key: 'createdAt', width: '110px' },
  { title: '관리', key: 'actions', width: '100px', sortable: false },
]

async function fetchAll() {
  loading.value = true
  try {
    const [projRes, issueRes] = await Promise.all([
      projectService.getDetail(projectId),
      issueService.getList(projectId, { size: 50 }),
    ])
    if (projRes.success) project.value = projRes.data
    if (issueRes.success) { issues.value = issueRes.data; totalCount.value = issueRes.pagination.totalCount }
  } catch (err) {
    console.error('Fetch issues error:', err)
  } finally {
    loading.value = false
  }
}

async function fetchMembers() {
  if (members.value.length) return
  try {
    const r = await projectService.getMembers(projectId)
    if (r.success) members.value = r.data
  } catch {}
}

function openCreate() {
  fetchMembers()
  editMode.value = false; editId.value = null
  form.value = { issueTitle: '', description: '', priority: '보통', status: '등록', assigneeId: '' }
  dialog.value = true
}

function openEdit(issue: Issue) {
  fetchMembers()
  editMode.value = true; editId.value = issue.issueId
  form.value = {
    issueTitle: issue.issueTitle,
    description: issue.description || '',
    priority: issue.priority,
    status: issue.status,
    assigneeId: issue.assigneeId || '',
  }
  dialog.value = true
}

async function save() {
  try {
    if (editMode.value && editId.value) {
      await issueService.update(projectId, editId.value, form.value)
    } else {
      await issueService.create(projectId, form.value)
    }
    dialog.value = false
    fetchAll()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '저장 실패', { color: 'error' })
  }
}

async function changeStatus(issueId: number, status: string) {
  try {
    await issueService.update(projectId, issueId, { status })
    fetchAll()
  } catch {}
}

async function removeIssue(issueId: number) {
  if (!(await showConfirm('이슈를 삭제하시겠습니까?'))) return
  try {
    await issueService.remove(projectId, issueId)
    fetchAll()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' })
  }
}

function formatDate(d: string) { return d ? new Date(d).toLocaleDateString('ko-KR') : '-' }
function getPriorityColor(p: string) {
  const c: Record<string, string> = { '긴급': 'error', '높음': 'warning', '보통': 'info', '낮음': 'grey' }
  return c[p] || 'grey'
}
function getStatusColor(s: string) {
  const c: Record<string, string> = { '등록': 'blue-grey', '진행중': 'info', '해결': 'success', '종료': 'grey' }
  return c[s] || 'grey'
}

onMounted(fetchAll)
</script>

<template>
  <MainLayout>
    <v-row class="mb-4" align="center">
      <v-col cols="auto">
        <v-btn icon variant="text" @click="router.push(`/projects/${projectId}`)"><v-icon>mdi-arrow-left</v-icon></v-btn>
      </v-col>
      <v-col>
        <h2 class="text-h5 font-weight-bold">이슈 관리</h2>
        <span class="text-body-2 text-grey">{{ project?.projectName }}</span>
      </v-col>
      <v-col cols="auto">
        <v-btn color="primary" size="small" prepend-icon="mdi-plus" @click="openCreate">이슈 등록</v-btn>
      </v-col>
    </v-row>

    <v-data-table :items="issues" :headers="headers" :loading="loading" :items-per-page="20" density="comfortable" class="elevation-1">
      <template #item.priority="{ item }">
        <v-chip :color="getPriorityColor(item.priority)" size="small" variant="tonal">{{ item.priority }}</v-chip>
      </template>
      <template #item.status="{ item }">
        <v-menu>
          <template #activator="{ props }">
            <v-chip v-bind="props" :color="getStatusColor(item.status)" size="small" variant="tonal" style="cursor:pointer">{{ item.status }}</v-chip>
          </template>
          <v-list density="compact">
            <v-list-item v-for="s in statuses" :key="s" @click="changeStatus(item.issueId, s)">{{ s }}</v-list-item>
          </v-list>
        </v-menu>
      </template>
      <template #item.createdAt="{ item }">{{ formatDate(item.createdAt) }}</template>
      <template #item.actions="{ item }">
        <v-btn icon size="x-small" variant="text" @click="openEdit(item)"><v-icon size="small">mdi-pencil</v-icon></v-btn>
        <v-btn icon size="x-small" variant="text" color="error" @click="removeIssue(item.issueId)"><v-icon size="small">mdi-delete</v-icon></v-btn>
      </template>
    </v-data-table>

    <v-dialog v-model="dialog" max-width="550">
      <v-card>
        <v-card-title>{{ editMode ? '이슈 수정' : '이슈 등록' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="form.issueTitle" label="제목 *" variant="outlined" density="compact" class="mb-2" />
          <v-textarea v-model="form.description" label="내용" variant="outlined" density="compact" rows="3" class="mb-2" />
          <v-row>
            <v-col cols="6">
              <v-select v-model="form.priority" :items="priorities" label="우선순위" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="6" v-if="editMode">
              <v-select v-model="form.status" :items="statuses" label="상태" variant="outlined" density="compact" />
            </v-col>
          </v-row>
          <UserTreePicker
            v-model="form.assigneeId"
            :members="members"
            label="담당자"
            clearable
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="dialog = false">취소</v-btn>
          <v-btn color="primary" @click="save">저장</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </MainLayout>
</template>
