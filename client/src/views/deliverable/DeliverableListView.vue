<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MainLayout from '@/components/common/MainLayout.vue'
import { deliverableService } from '@/services/deliverables'
import { wbsService } from '@/services/wbs'
import { projectService } from '@/services/projects'
import { useDialog } from '@/composables/useDialog'
import type { Deliverable, WbsTask, Project } from '@/types'

const { showAlert, showConfirm } = useDialog()

const route = useRoute()
const router = useRouter()
const projectId = Number(route.params.projectId)

const project = ref<Project | null>(null)
const docs = ref<Deliverable[]>([])
const tasks = ref<WbsTask[]>([])
const loading = ref(false)
const totalCount = ref(0)
const page = ref(1)
const docTypeFilter = ref('')
const statusFilter = ref('')

// 등록 다이얼로그
const dialog = ref(false)
const editMode = ref(false)
const editId = ref<number | null>(null)
const form = ref({ taskId: null as number | null, docType: '', docName: '', file: null as File | null })

// 상세/검토 다이얼로그
const detailDialog = ref(false)
const detailDoc = ref<any>(null)
const reviewForm = ref({ result: '', comment: '' })

const docTypes = [
  '요구사항정의서', '화면설계서', 'DB설계서', '인터페이스설계서', '아키텍처설계서',
  '소스코드', '단위테스트결과서', '통합테스트결과서', '성능테스트결과서', '사용자매뉴얼', '운영자매뉴얼',
]
const statusOptions = ['등록', '검토요청', '검토중', '승인', '반려']
const auditOptions = ['미점검', '적합', '부적합', '조건부적합']
const reviewResults = ['승인', '반려', '조건부승인']

const headers = [
  { title: '산출물명', key: 'docName' },
  { title: '유형', key: 'docType', width: '130px' },
  { title: '태스크', key: 'taskName', width: '150px' },
  { title: '상태', key: 'status', width: '90px' },
  { title: '감리', key: 'auditorCheck', width: '90px' },
  { title: '등록자', key: 'uploaderName', width: '90px' },
  { title: '등록일', key: 'uploadedAt', width: '110px' },
  { title: '관리', key: 'actions', width: '120px', sortable: false },
]

async function fetchAll() {
  loading.value = true
  try {
    const [projRes, docRes, taskRes] = await Promise.all([
      projectService.getDetail(projectId),
      deliverableService.getList(projectId, {
        page: page.value, size: 20,
        docType: docTypeFilter.value || undefined,
        status: statusFilter.value || undefined,
      }),
      wbsService.getFlat(projectId),
    ])
    if (projRes.success) project.value = projRes.data
    if (docRes.success) { docs.value = docRes.data; totalCount.value = docRes.pagination.totalCount }
    if (taskRes.success) tasks.value = taskRes.data
  } catch (err) {
    console.error('Fetch deliverables error:', err)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editMode.value = false; editId.value = null
  form.value = { taskId: null, docType: '', docName: '', file: null }
  dialog.value = true
}

async function save() {
  try {
    const fd = new FormData()
    fd.append('taskId', String(form.value.taskId))
    fd.append('docType', form.value.docType)
    fd.append('docName', form.value.docName)
    if (form.value.file) fd.append('file', form.value.file)

    if (editMode.value && editId.value) {
      await deliverableService.update(projectId, editId.value, fd)
    } else {
      await deliverableService.create(projectId, fd)
    }
    dialog.value = false
    fetchAll()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '저장 실패', { color: 'error' })
  }
}

async function openDetail(doc: Deliverable) {
  try {
    const res = await deliverableService.getDetail(projectId, doc.docId)
    if (res.success) { detailDoc.value = res.data; detailDialog.value = true }
  } catch (err) {
    console.error('Detail error:', err)
  }
}

async function changeStatus(docId: number, status: string) {
  try {
    await deliverableService.updateStatus(projectId, docId, { status })
    fetchAll()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '상태 변경 실패', { color: 'error' })
  }
}

async function changeAudit(docId: number, auditorCheck: string) {
  try {
    await deliverableService.updateStatus(projectId, docId, { auditorCheck })
    fetchAll()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '감리 상태 변경 실패', { color: 'error' })
  }
}

async function submitReview() {
  if (!reviewForm.value.result || !detailDoc.value) return
  try {
    await deliverableService.addReview(projectId, detailDoc.value.docId, reviewForm.value)
    reviewForm.value = { result: '', comment: '' }
    // 상세 새로고침
    const res = await deliverableService.getDetail(projectId, detailDoc.value.docId)
    if (res.success) detailDoc.value = res.data
    fetchAll()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '검토 등록 실패', { color: 'error' })
  }
}

async function removeDoc(docId: number) {
  if (!(await showConfirm('산출물을 삭제하시겠습니까?'))) return
  try {
    await deliverableService.remove(projectId, docId)
    fetchAll()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' })
  }
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  form.value.file = input.files?.[0] || null
}

function formatDate(d?: string) { return d ? new Date(d).toLocaleDateString('ko-KR') : '-' }
function formatSize(bytes: number) {
  if (!bytes) return '-'
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1024 / 1024).toFixed(1) + 'MB'
}

function getStatusColor(s: string) {
  const c: Record<string, string> = { '등록': 'grey', '검토요청': 'info', '검토중': 'warning', '승인': 'success', '반려': 'error' }
  return c[s] || 'grey'
}
function getAuditColor(s: string) {
  const c: Record<string, string> = { '미점검': 'grey', '적합': 'success', '부적합': 'error', '조건부적합': 'warning' }
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
        <h2 class="text-h5 font-weight-bold">산출물 관리</h2>
        <span class="text-body-2 text-grey">{{ project?.projectName }}</span>
      </v-col>
      <v-col cols="auto">
        <v-btn color="primary" size="small" prepend-icon="mdi-plus" @click="openCreate">산출물 등록</v-btn>
      </v-col>
    </v-row>

    <!-- 필터 -->
    <v-row class="mb-2">
      <v-col cols="12" md="2">
        <v-select v-model="docTypeFilter" :items="['', ...docTypes]" label="유형" variant="outlined" density="compact" hide-details clearable @update:model-value="fetchAll" />
      </v-col>
      <v-col cols="12" md="2">
        <v-select v-model="statusFilter" :items="['', ...statusOptions]" label="상태" variant="outlined" density="compact" hide-details clearable @update:model-value="fetchAll" />
      </v-col>
    </v-row>

    <!-- 테이블 -->
    <v-data-table :items="docs" :headers="headers" :loading="loading" :items-per-page="20" density="comfortable" class="elevation-1">
      <template #item.docName="{ item }">
        <span class="text-primary font-weight-medium" style="cursor:pointer" @click="openDetail(item)">{{ item.docName }}</span>
      </template>
      <template #item.status="{ item }">
        <v-menu>
          <template #activator="{ props }">
            <v-chip v-bind="props" :color="getStatusColor(item.status)" size="small" variant="tonal" style="cursor:pointer">{{ item.status }}</v-chip>
          </template>
          <v-list density="compact">
            <v-list-item v-for="s in statusOptions" :key="s" @click="changeStatus(item.docId, s)">{{ s }}</v-list-item>
          </v-list>
        </v-menu>
      </template>
      <template #item.auditorCheck="{ item }">
        <v-menu>
          <template #activator="{ props }">
            <v-chip v-bind="props" :color="getAuditColor(item.auditorCheck)" size="small" variant="tonal" style="cursor:pointer">{{ item.auditorCheck }}</v-chip>
          </template>
          <v-list density="compact">
            <v-list-item v-for="a in auditOptions" :key="a" @click="changeAudit(item.docId, a)">{{ a }}</v-list-item>
          </v-list>
        </v-menu>
      </template>
      <template #item.uploadedAt="{ item }">{{ formatDate(item.uploadedAt) }}</template>
      <template #item.actions="{ item }">
        <v-btn icon size="x-small" variant="text" @click="openDetail(item)"><v-icon size="small">mdi-eye</v-icon></v-btn>
        <v-btn icon size="x-small" variant="text" color="error" @click="removeDoc(item.docId)"><v-icon size="small">mdi-delete</v-icon></v-btn>
      </template>
    </v-data-table>

    <!-- 등록 다이얼로그 -->
    <v-dialog v-model="dialog" max-width="500">
      <v-card>
        <v-card-title>산출물 등록</v-card-title>
        <v-card-text>
          <v-select
            v-model="form.taskId"
            :items="tasks.map(t => ({ title: `${'─'.repeat(t.depth-1)} ${t.taskName}`, value: t.taskId }))"
            label="태스크 *" variant="outlined" density="compact" class="mb-2"
          />
          <v-select v-model="form.docType" :items="docTypes" label="산출물 유형 *" variant="outlined" density="compact" class="mb-2" />
          <v-text-field v-model="form.docName" label="산출물명 *" variant="outlined" density="compact" class="mb-2" />
          <v-file-input label="파일" variant="outlined" density="compact" @change="onFileChange" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="dialog = false">취소</v-btn>
          <v-btn color="primary" @click="save">등록</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 상세/검토 다이얼로그 -->
    <v-dialog v-model="detailDialog" max-width="650">
      <v-card v-if="detailDoc">
        <v-card-title>{{ detailDoc.docName }}</v-card-title>
        <v-card-text>
          <v-table density="compact" class="mb-4">
            <tbody>
              <tr><td class="font-weight-bold" width="120">유형</td><td>{{ detailDoc.docType }}</td></tr>
              <tr><td class="font-weight-bold">태스크</td><td>{{ detailDoc.taskName }}</td></tr>
              <tr><td class="font-weight-bold">상태</td><td><v-chip :color="getStatusColor(detailDoc.status)" size="small" variant="tonal">{{ detailDoc.status }}</v-chip></td></tr>
              <tr><td class="font-weight-bold">감리</td><td><v-chip :color="getAuditColor(detailDoc.auditorCheck)" size="small" variant="tonal">{{ detailDoc.auditorCheck }}</v-chip></td></tr>
              <tr><td class="font-weight-bold">등록자</td><td>{{ detailDoc.uploaderName }}</td></tr>
              <tr><td class="font-weight-bold">파일크기</td><td>{{ formatSize(detailDoc.fileSize) }}</td></tr>
            </tbody>
          </v-table>

          <!-- 버전 이력 -->
          <div class="text-subtitle-2 mb-2">버전 이력</div>
          <v-table density="compact" class="mb-4" v-if="detailDoc.versions?.length">
            <thead><tr><th>버전</th><th>설명</th><th>크기</th><th>등록자</th><th>일시</th></tr></thead>
            <tbody>
              <tr v-for="v in detailDoc.versions" :key="v.versionId">
                <td>v{{ v.versionNo }}</td>
                <td>{{ v.changeDesc || '-' }}</td>
                <td>{{ formatSize(v.fileSize) }}</td>
                <td>{{ v.creator?.userName || '-' }}</td>
                <td>{{ formatDate(v.createdAt) }}</td>
              </tr>
            </tbody>
          </v-table>
          <div v-else class="text-caption text-grey mb-4">버전 이력이 없습니다.</div>

          <!-- 검토 이력 -->
          <div class="text-subtitle-2 mb-2">검토 이력</div>
          <v-table density="compact" class="mb-4" v-if="detailDoc.reviews?.length">
            <thead><tr><th>결과</th><th>의견</th><th>검토자</th><th>일시</th></tr></thead>
            <tbody>
              <tr v-for="r in detailDoc.reviews" :key="r.reviewId">
                <td><v-chip :color="r.result === '승인' ? 'success' : r.result === '반려' ? 'error' : 'warning'" size="x-small" variant="tonal">{{ r.result }}</v-chip></td>
                <td>{{ r.comment || '-' }}</td>
                <td>{{ r.reviewerName || '-' }}</td>
                <td>{{ formatDate(r.reviewedAt) }}</td>
              </tr>
            </tbody>
          </v-table>
          <div v-else class="text-caption text-grey mb-4">검토 이력이 없습니다.</div>

          <!-- 검토 등록 -->
          <v-divider class="mb-4" />
          <div class="text-subtitle-2 mb-2">검토 등록</div>
          <v-row>
            <v-col cols="4">
              <v-select v-model="reviewForm.result" :items="reviewResults" label="결과" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="reviewForm.comment" label="의견" variant="outlined" density="compact" />
            </v-col>
            <v-col cols="2">
              <v-btn color="primary" block @click="submitReview" :disabled="!reviewForm.result">등록</v-btn>
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="detailDialog = false">닫기</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </MainLayout>
</template>
