<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import { libraryService } from '@/services/library'
import { projectService } from '@/services/projects'
import { useDialog } from '@/composables/useDialog'

const { showAlert, showConfirm } = useDialog()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)

const items = ref<any[]>([])
const loading = ref(false)
const myRole = ref<any>(null)
const canManage = ref(false)

// 필터
const filterCategory = ref('')
const keyword = ref('')
const CATEGORIES = ['일반', '설계자료', '회의자료', '교육자료', '기타']
const CATEGORY_COLORS: Record<string, string> = { '일반': 'grey', '설계자료': 'primary', '회의자료': 'teal', '교육자료': 'success', '기타': 'orange' }

// 업로드 다이얼로그
const uploadDialog = ref(false)
const uploadFile = ref<File | null>(null)
const uploadForm = ref({ title: '', description: '', category: '일반' })
const uploading = ref(false)
const uploadProgress = ref(0)
const dragOver = ref(false)

// 다운로드 진행
const downloadingId = ref<number | null>(null)
const downloadProgress = ref(0)

// 수정 다이얼로그
const editDialog = ref(false)
const editId = ref<number | null>(null)
const editForm = ref({ title: '', description: '', category: '일반' })

async function fetchList() {
  loading.value = true
  try {
    const params: any = {}
    if (filterCategory.value) params.category = filterCategory.value
    if (keyword.value) params.keyword = keyword.value
    const res = await libraryService.getList(projectId, params)
    if (res.success) items.value = res.data
  } catch {} finally { loading.value = false }
}

function openUpload() {
  uploadFile.value = null
  uploadForm.value = { title: '', description: '', category: '일반' }
  uploadProgress.value = 0
  uploadDialog.value = true
}

function onFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) selectFile(file)
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) selectFile(file)
}
function selectFile(file: File) {
  uploadFile.value = file
  if (!uploadForm.value.title) uploadForm.value.title = file.name.replace(/\.[^/.]+$/, '')
}

async function doUpload() {
  if (!uploadFile.value) { await showAlert('파일을 선택하세요.', { color: 'error' }); return }
  if (!uploadForm.value.title) { await showAlert('제목을 입력하세요.', { color: 'error' }); return }
  uploading.value = true; uploadProgress.value = 0
  try {
    await libraryService.upload(projectId, uploadFile.value, uploadForm.value, (pct) => { uploadProgress.value = pct })
    uploadDialog.value = false
    await fetchList()
    await showAlert('자료가 등록되었습니다.')
  } catch (err: any) {
    showAlert(err.response?.data?.message || '업로드 실패', { color: 'error' })
  } finally { uploading.value = false }
}

function openEdit(item: any) {
  editId.value = item.fileId
  editForm.value = { title: item.title, description: item.description || '', category: item.category }
  editDialog.value = true
}

async function saveEdit() {
  if (!editId.value) return
  try {
    await libraryService.update(projectId, editId.value, editForm.value)
    editDialog.value = false; await fetchList()
  } catch (err: any) { showAlert(err.response?.data?.message || '수정 실패', { color: 'error' }) }
}

async function deleteFile(item: any) {
  if (!(await showConfirm(`"${item.title}" 자료를 삭제하시겠습니까?\n파일이 영구 삭제됩니다.`))) return
  try {
    await libraryService.remove(projectId, item.fileId)
    await fetchList()
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

async function downloadFile(item: any) {
  downloadingId.value = item.fileId; downloadProgress.value = 0
  try {
    await libraryService.download(projectId, item.fileId, item.fileName, (pct) => { downloadProgress.value = pct })
  } catch { showAlert('다운로드 실패', { color: 'error' }) }
  finally { downloadingId.value = null; downloadProgress.value = 0 }
}

function canEdit(item: any) {
  return canManage.value || item.uploaderId === authStore.user?.userId
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + 'MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + 'GB'
}

function fmtDate(d: string) { return d ? d.substring(0, 10) : '' }

function fileIcon(mimeType: string | null, fileName: string) {
  if (!mimeType) return 'mdi-file'
  if (mimeType.startsWith('image/')) return 'mdi-file-image'
  if (mimeType.includes('pdf')) return 'mdi-file-pdf-box'
  if (mimeType.includes('word') || fileName.endsWith('.docx') || fileName.endsWith('.doc')) return 'mdi-file-word'
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || fileName.endsWith('.xlsx')) return 'mdi-file-excel'
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation') || fileName.endsWith('.pptx')) return 'mdi-file-powerpoint'
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive')) return 'mdi-folder-zip'
  if (mimeType.startsWith('video/')) return 'mdi-file-video'
  return 'mdi-file-document'
}

const filteredCount = computed(() => items.value.length)

onMounted(async () => {
  try {
    const roleRes = await projectService.getMyRole(projectId).catch(() => null)
    if (roleRes?.success) myRole.value = roleRes.data
    canManage.value = myRole.value?.isPmsAdmin || false
  } catch {}
  fetchList()
})
</script>

<template>
  <MainLayout>
    <v-row class="mb-1" align="center" dense>
      <v-col cols="auto"><v-btn icon size="small" variant="text" @click="router.push(`/projects/${projectId}`)"><v-icon>mdi-arrow-left</v-icon></v-btn></v-col>
      <v-col><span class="pms-page-title">자료실</span></v-col>
    </v-row>

    <!-- 필터 + 버튼 -->
    <v-row dense class="mb-2" align="center">
      <v-col cols="6" md="2">
        <v-select v-model="filterCategory" :items="[{ title: '전체', value: '' }, ...CATEGORIES.map(c => ({ title: c, value: c }))]" label="분류" hide-details class="pms-filter" @update:model-value="fetchList" />
      </v-col>
      <v-col cols="6" md="3">
        <v-text-field v-model="keyword" placeholder="제목, 파일명, 설명 검색" prepend-inner-icon="mdi-magnify" hide-details clearable class="pms-filter" @keyup.enter="fetchList" @click:clear="keyword='';fetchList()" />
      </v-col>
      <v-col cols="auto" class="ml-auto">
        <v-btn size="x-small" color="primary" prepend-icon="mdi-upload" @click="openUpload">자료 등록</v-btn>
      </v-col>
    </v-row>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-1" />

    <div class="pms-card" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint); padding:4px 12px; margin-bottom:4px">
      총 {{ filteredCount }}건
    </div>

    <!-- 파일 목록 -->
    <div class="pms-card">
      <div v-if="!items.length" class="text-center pa-8" style="color:var(--pms-text-hint)">등록된 자료가 없습니다.</div>
      <div v-for="item in items" :key="item.fileId" class="lib-item">
        <v-icon size="24" :color="CATEGORY_COLORS[item.category] || 'grey'" class="mr-2 flex-shrink-0">{{ fileIcon(item.mimeType, item.fileName) }}</v-icon>
        <div style="flex:1; min-width:0">
          <div class="d-flex align-center" style="gap:5px">
            <v-chip size="x-small" :color="CATEGORY_COLORS[item.category]" variant="tonal">{{ item.category }}</v-chip>
            <span style="font-size:var(--pms-font-body); font-weight:600">{{ item.title }}</span>
          </div>
          <div style="font-size:var(--pms-font-mini); color:var(--pms-text-hint); margin-top:2px">
            {{ item.fileName }} · {{ formatSize(Number(item.fileSize)) }} · {{ item.uploaderName }} · {{ fmtDate(item.createdAt) }}
            <span v-if="item.downloadCount" class="ml-1"><v-icon size="10">mdi-download</v-icon>{{ item.downloadCount }}</span>
          </div>
          <div v-if="item.description" style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary); margin-top:2px">{{ item.description }}</div>
        </div>
        <div class="d-flex align-center" style="gap:2px; flex-shrink:0">
          <v-btn icon size="x-small" variant="tonal" color="primary" @click="downloadFile(item)" :loading="downloadingId === item.fileId" title="다운로드"><v-icon size="14">mdi-download</v-icon></v-btn>
          <template v-if="canEdit(item)">
            <v-btn icon size="x-small" variant="text" @click="openEdit(item)" title="수정"><v-icon size="14">mdi-pencil</v-icon></v-btn>
            <v-btn icon size="x-small" variant="text" color="error" @click="deleteFile(item)" title="삭제"><v-icon size="14">mdi-delete</v-icon></v-btn>
          </template>
        </div>
        <!-- 다운로드 진행률 -->
        <v-progress-linear v-if="downloadingId === item.fileId" :model-value="downloadProgress" color="primary" height="3" class="lib-item-progress" />
      </div>
    </div>

    <!-- 업로드 다이얼로그 -->
    <v-dialog v-model="uploadDialog" max-width="520" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)"><v-icon size="16" class="mr-1">mdi-upload</v-icon>자료 등록</v-card-title>
        <v-card-text>
          <div class="pms-form-group">
            <div class="pms-form-group-title"><v-icon size="16">mdi-file-document-edit</v-icon>파일 정보</div>
            <v-text-field v-model="uploadForm.title" variant="outlined" density="compact" hide-details class="pms-form mb-2">
              <template #label>제목<span class="pms-required">*</span></template>
            </v-text-field>
            <v-select v-model="uploadForm.category" :items="CATEGORIES" label="분류" variant="outlined" density="compact" hide-details class="pms-form mb-2" />
            <v-textarea v-model="uploadForm.description" label="설명" variant="outlined" density="compact" hide-details class="pms-form mb-2" rows="2" auto-grow />
          </div>
          <div class="pms-form-group">
            <div class="pms-form-group-title orange"><v-icon size="16">mdi-paperclip</v-icon>파일 선택</div>
            <div class="upload-area" :class="{ 'upload-drag-over': dragOver }"
              @click="($refs.fileInput as HTMLInputElement)?.click()"
              @dragover.prevent="dragOver = true"
              @dragleave.prevent="dragOver = false"
              @drop.prevent="onDrop"
            >
              <input ref="fileInput" type="file" hidden @change="onFileSelect" />
              <div v-if="!uploadFile" class="text-center">
                <v-icon size="32" :color="dragOver ? 'primary' : 'grey'">mdi-cloud-upload</v-icon>
                <div style="font-size:var(--pms-font-body); color:var(--pms-text-hint); margin-top:4px">파일을 드래그하거나 클릭하여 선택하세요</div>
              </div>
              <div v-else class="d-flex align-center" style="gap:8px">
                <v-icon size="20" color="primary">mdi-file-check</v-icon>
                <div>
                  <div style="font-size:var(--pms-font-body); font-weight:600">{{ uploadFile.name }}</div>
                  <div style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">{{ formatSize(uploadFile.size) }}</div>
                </div>
                <v-spacer />
                <v-btn icon size="x-small" variant="text" color="grey" @click.stop="uploadFile = null"><v-icon size="14">mdi-close</v-icon></v-btn>
              </div>
            </div>
            <v-alert type="info" variant="tonal" density="compact" class="mt-2" style="font-size:var(--pms-font-caption)">
              최대 파일 크기: <b>1GB</b> · 모든 파일 형식 지원
            </v-alert>
          </div>
          <!-- 업로드 진행률 -->
          <div v-if="uploading" class="mt-2">
            <v-progress-linear :model-value="uploadProgress" color="primary" height="8" rounded>
              <template #default>
                <span style="font-size:10px; font-weight:600; color:#fff">{{ uploadProgress }}%</span>
              </template>
            </v-progress-linear>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="outlined" @click="uploadDialog = false" :disabled="uploading">취소</v-btn>
          <v-btn size="small" color="primary" @click="doUpload" :loading="uploading">업로드</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 수정 다이얼로그 -->
    <v-dialog v-model="editDialog" max-width="440" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">자료 수정</v-card-title>
        <v-card-text>
          <v-text-field v-model="editForm.title" variant="outlined" density="compact" hide-details class="pms-form mb-2">
            <template #label>제목<span class="pms-required">*</span></template>
          </v-text-field>
          <v-select v-model="editForm.category" :items="CATEGORIES" label="분류" variant="outlined" density="compact" hide-details class="pms-form mb-2" />
          <v-textarea v-model="editForm.description" label="설명" variant="outlined" density="compact" hide-details class="pms-form" rows="2" auto-grow />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn size="small" variant="outlined" @click="editDialog = false">취소</v-btn><v-btn size="small" color="primary" @click="saveEdit">저장</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </MainLayout>
</template>

<style scoped>
.lib-item {
  display: flex; align-items: center; padding: 10px 12px;
  border-bottom: 1px solid var(--pms-border-light, #eee);
  transition: background 0.15s; gap: 8px;
  position: relative; flex-wrap: wrap;
}
.lib-item-progress {
  position: absolute; left: 0; right: 0; bottom: 0;
}
.lib-item:hover { background: var(--pms-hover, #f5f5f5); }
.upload-area {
  border: 2px dashed var(--pms-border, #ccc); border-radius: var(--pms-radius);
  padding: 20px; cursor: pointer; transition: border-color 0.2s;
}
.upload-area:hover { border-color: var(--pms-primary); }
.upload-area.upload-drag-over {
  border-color: var(--pms-primary); background: rgba(var(--v-theme-primary), 0.05);
}
</style>
