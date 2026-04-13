<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import { docStorageService } from '@/services/docStorage'
import { projectService } from '@/services/projects'
import { useDialog } from '@/composables/useDialog'
import api from '@/services/api'

const { showAlert, showConfirm } = useDialog()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)

const project = ref<any>(null)
const myRole = ref<any>(null)
const isPmsAdmin = computed(() => myRole.value?.isPmsAdmin || false)

const docTab = ref('methodology')
const folders = ref<any[]>([])
const loading = ref(false)
const selectedFolder = ref<any>(null)
const expandedPhases = ref<Set<number>>(new Set())

// 관리 산출물 폴더 (type=management인 폴더)
const mgmtFolders = computed(() => folders.value.filter((f: any) => f.folderType === 'management'))
const mgmtTotalFiles = computed(() => {
  let count = 0
  for (const cat of mgmtFolders.value) { for (const child of (cat.children || [])) { count += (child.files || []).length } }
  return count
})

// 업로드
const uploading = ref(false)
const dragOver = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

async function fetchFolders() {
  loading.value = true
  try {
    const res = await docStorageService.getFolders(projectId)
    if (res.success) {
      folders.value = res.data
      // 전체 펼침
      for (const f of res.data) expandedPhases.value.add(f.folderId)
    }
  } catch (err) { console.error(err) }
  finally { loading.value = false }
}

async function resetFolders(type?: string) {
  const typeLabel = type === 'management' ? '관리 산출물' : type === 'methodology' ? '방법론 산출물' : '전체 산출물'
  if (!(await showConfirm(`${typeLabel} 폴더를 초기화하시겠습니까?\n\n⚠️ 모든 폴더와 업로드된 파일이 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`))) return
  try {
    const res = await docStorageService.resetFolders(projectId, type)
    if (res.success) { await showAlert(res.message); selectedFolder.value = null; await fetchFolders() }
  } catch (err: any) { showAlert(err?.response?.data?.message || '초기화 실패', { color: 'error' }) }
}

async function refreshFolders(type?: string) {
  const typeLabel = type === 'management' ? '관리 산출물' : '방법론 산출물'
  if (!(await showConfirm(`${typeLabel} 폴더를 갱신하시겠습니까?\n\n• 파일이 없는 폴더는 삭제 후 재생성됩니다\n• 파일이 있는 폴더는 그대로 유지됩니다\n• 신규 산출물 폴더가 추가됩니다`))) return
  try {
    const res = await docStorageService.refreshFolders(projectId, type)
    if (res.success) { await showAlert(res.message); selectedFolder.value = null; await fetchFolders() }
  } catch (err: any) { showAlert(err?.response?.data?.message || '갱신 실패', { color: 'error' }) }
}

async function initFolders(force: boolean = false, type?: string) {
  if (force && !(await showConfirm('기존 폴더를 초기화하고 다시 생성하시겠습니까?\n업로드된 파일이 모두 삭제됩니다.'))) return
  try {
    const res = await docStorageService.initFolders(projectId, force, type)
    if (res.success) { await showAlert(res.message); await fetchFolders() }
  } catch (err: any) { showAlert(err.response?.data?.message || '초기화 실패', { color: 'error' }) }
}

function selectFolder(folder: any) {
  selectedFolder.value = folder
}

function togglePhase(folderId: number) {
  if (expandedPhases.value.has(folderId)) expandedPhases.value.delete(folderId)
  else expandedPhases.value.add(folderId)
}

// 파일 업로드
async function handleFiles(files: FileList | File[]) {
  if (!selectedFolder.value) { await showAlert('폴더를 먼저 선택하세요.', { color: 'warning' }); return }
  if (selectedFolder.value.isLocked) { await showAlert('잠금된 폴더입니다.', { color: 'error' }); return }
  if (!files.length) return

  uploading.value = true
  try {
    const res = await docStorageService.uploadFiles(projectId, selectedFolder.value.folderId, Array.from(files) as File[])
    if (res.success) { await showAlert(res.message); await fetchFolders(); selectFolderById(selectedFolder.value.folderId) }
  } catch (err: any) { showAlert(err.response?.data?.message || '업로드 실패', { color: 'error' }) }
  finally { uploading.value = false; dragOver.value = false }
}

function onDrop(e: DragEvent) {
  e.preventDefault(); dragOver.value = false
  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files)
}
function onDragOver(e: DragEvent) { e.preventDefault(); dragOver.value = true }
function onDragLeave() { dragOver.value = false }
function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) handleFiles(input.files)
  input.value = ''
}
function openFilePicker() { fileInputRef.value?.click() }

// 파일 삭제
async function deleteFile(file: any) {
  if (!(await showConfirm(`"${file.fileName}" v${file.version}을 삭제하시겠습니까?`))) return
  try {
    await docStorageService.deleteFile(projectId, file.fileId)
    await fetchFolders(); if (selectedFolder.value) selectFolderById(selectedFolder.value.folderId)
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

// 잠금
async function toggleLock(folder: any) {
  const newState = !folder.isLocked
  if (newState && !(await showConfirm(`"${folder.folderName}" 폴더를 잠금하시겠습니까?`))) return
  try {
    await docStorageService.lockFolder(projectId, folder.folderId, newState)
    await fetchFolders(); selectFolderById(folder.folderId)
  } catch (err: any) { showAlert(err.response?.data?.message || '실패', { color: 'error' }) }
}


function selectFolderById(folderId: number) {
  for (const phase of folders.value) {
    if (phase.folderId === folderId) { selectedFolder.value = phase; return }
    for (const child of (phase.children || [])) {
      if (child.folderId === folderId) { selectedFolder.value = child; return }
    }
  }
}

function downloadFile(file: any) {
  const url = `${api.defaults.baseURL}/projects/${projectId}/doc-storage/files/${file.fileId}/download`
  const a = document.createElement('a')
  a.href = url
  a.download = file.fileName
  // JWT 토큰을 쿠키/헤더로 전달하기 위해 fetch 사용
  const token = localStorage.getItem('token')
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then(res => res.blob())
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob)
      a.href = blobUrl
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    })
    .catch(() => showAlert('다운로드 실패', { color: 'error' }))
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1048576).toFixed(1) + 'MB'
}

function fmtDT(d: string) { return d ? new Date(d).toLocaleString('ko-KR') : '-' }

// 선택된 폴더의 파일 (버전별 그룹)
const selectedFiles = computed(() => {
  if (!selectedFolder.value?.files) return []
  return selectedFolder.value.files
})

const methodFolders = computed(() => folders.value.filter((f: any) => f.folderType !== 'management'))
const totalFiles = computed(() => {
  let count = 0
  for (const phase of methodFolders.value) {
    for (const child of (phase.children || [])) { count += (child.files || []).length }
  }
  return count
})

onMounted(async () => {
  try {
    const [p, r] = await Promise.all([
      projectService.getDetail(projectId),
      projectService.getMyRole(projectId).catch(() => null),
    ])
    if (p.success) project.value = p.data
    if (r?.success) myRole.value = r.data
  } catch {}
  await fetchFolders()
})
</script>

<template>
  <MainLayout>
    <v-row class="mb-1" align="center" dense>
      <v-col cols="auto"><v-btn icon size="small" variant="text" @click="router.push(`/projects/${projectId}`)"><v-icon>mdi-arrow-left</v-icon></v-btn></v-col>
      <v-col>
        <span class="pms-page-title">산출물 관리</span>
        <span class="pms-page-subtitle">{{ project?.projectName }}</span>
      </v-col>
      <v-col cols="auto" class="d-flex" style="gap:4px">
        <v-btn v-if="isPmsAdmin" size="x-small" variant="outlined" prepend-icon="mdi-folder-plus" @click="initFolders(false, docTab)">폴더 생성</v-btn>
        <v-btn v-if="isPmsAdmin" size="x-small" variant="outlined" color="warning" prepend-icon="mdi-folder-sync" @click="refreshFolders(docTab)">폴더 갱신</v-btn>
        <v-btn v-if="isPmsAdmin" size="x-small" variant="outlined" color="error" prepend-icon="mdi-delete-sweep" @click="resetFolders(docTab)">초기화</v-btn>
      </v-col>
    </v-row>

    <div class="settings-guide mb-2" style="display:flex; align-items:flex-start; gap:2px; padding:8px 12px; background:var(--pms-info-light, #E1F5FE); border-radius:var(--pms-radius); font-size:var(--pms-font-caption); color:var(--pms-text-secondary); line-height:1.6">
      <v-icon size="14" color="info" style="flex-shrink:0; margin-top:1px">mdi-information-outline</v-icon>
      <span>방법론 산출물과 관리 산출물 폴더는 <b>방법론/산출물 정의</b>에서 확정된 산출물 목록을 기반으로 생성·갱신됩니다. 폴더 잠금/해제는 PMSAdmin이 수동으로 관리합니다.</span>
    </div>

    <v-tabs v-model="docTab" density="compact" class="mb-2">
      <v-tab value="methodology" size="small"><v-icon size="14" start>mdi-bookshelf</v-icon>방법론 산출물</v-tab>
      <v-tab value="management" size="small"><v-icon size="14" start>mdi-clipboard-list</v-icon>관리 산출물</v-tab>
    </v-tabs>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

    <!-- ═══ 방법론 산출물 탭 ═══ -->
    <template v-if="docTab === 'methodology'">
    <div v-if="!methodFolders.length" class="pms-card pa-8 text-center" style="color:var(--pms-text-hint)">
      <v-icon size="48" color="grey-lighten-1" class="mb-2">mdi-folder-off</v-icon>
      <div style="font-size:var(--pms-font-body)">방법론 산출물 폴더가 없습니다.</div>
      <div style="font-size:var(--pms-font-caption); margin-top:4px">"폴더 생성" 버튼으로 방법론/산출물 정의에서 적용 산출물 기반 폴더를 생성하세요.</div>
    </div>

    <div v-else class="d-flex" style="gap:0; min-height:500px; border:1px solid var(--pms-border); border-radius:var(--pms-radius); overflow:hidden">
      <!-- 좌: 폴더 트리 -->
      <div style="width:300px; min-width:300px; border-right:1px solid var(--pms-border-light); overflow-y:auto; background:var(--pms-surface)">
        <div class="pa-2" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint); border-bottom:1px solid var(--pms-border-light)">
          폴더 ({{ totalFiles }}개 파일)
        </div>
        <div v-for="phase in methodFolders" :key="phase.folderId">
          <!-- 단계 폴더 -->
          <div class="folder-item folder-phase" @click="togglePhase(phase.folderId)">
            <v-icon size="14" class="mr-1">{{ expandedPhases.has(phase.folderId) ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
            <v-icon size="14" color="amber-darken-2" class="mr-1">mdi-folder</v-icon>
            <span style="font-weight:700">{{ phase.folderName }}</span>
            <span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint); margin-left:4px">({{ (phase.children || []).length }})</span>
          </div>
          <!-- 산출물 폴더 -->
          <template v-if="expandedPhases.has(phase.folderId)">
            <div v-for="child in (phase.children || [])" :key="child.folderId"
                 class="folder-item folder-child" :class="{ 'folder-selected': selectedFolder?.folderId === child.folderId }"
                 @click="selectFolder(child)">
              <v-icon size="14" :color="child.isLocked ? 'error' : 'primary'" class="mr-1">
                {{ child.isLocked ? 'mdi-folder-lock' : 'mdi-folder-open' }}
              </v-icon>
              <span :style="{ textDecoration: child.isLocked ? 'none' : '', color: child.isLocked ? 'var(--pms-text-hint)' : '' }">{{ child.folderName }}</span>
              <v-chip v-if="(child.files || []).length" size="x-small" variant="tonal" color="primary" class="ml-auto">{{ (child.files || []).length }}</v-chip>
              <v-icon v-if="child.isLocked" size="10" color="error" class="ml-1">mdi-lock</v-icon>
            </div>
          </template>
        </div>
      </div>

      <!-- 우: 파일 목록 + 업로드 -->
      <div style="flex:1; overflow-y:auto; background:var(--pms-bg)">
        <!-- 미선택 -->
        <div v-if="!selectedFolder" class="d-flex align-center justify-center" style="height:100%">
          <div class="text-center" style="color:var(--pms-text-hint)">
            <v-icon size="48" color="grey-lighten-1">mdi-folder-open-outline</v-icon>
            <div class="mt-2" style="font-size:var(--pms-font-body)">좌측에서 산출물 폴더를 선택하세요</div>
          </div>
        </div>

        <template v-else>
          <!-- 폴더 헤더 -->
          <div class="d-flex align-center pa-3" style="border-bottom:1px solid var(--pms-border-light); gap:8px">
            <v-icon size="16" :color="selectedFolder.isLocked ? 'error' : 'primary'">
              {{ selectedFolder.isLocked ? 'mdi-folder-lock' : 'mdi-folder-open' }}
            </v-icon>
            <span style="font-size:var(--pms-font-subtitle); font-weight:700">{{ selectedFolder.folderName }}</span>
            <v-chip v-if="selectedFolder.isLocked" size="x-small" color="error" variant="tonal"><v-icon start size="10">mdi-lock</v-icon>잠금</v-chip>
            <v-spacer />
            <v-btn v-if="isPmsAdmin" size="x-small" :variant="selectedFolder.isLocked ? 'tonal' : 'outlined'"
                   :color="selectedFolder.isLocked ? 'error' : 'grey'" @click="toggleLock(selectedFolder)">
              {{ selectedFolder.isLocked ? '잠금 해제' : '잠금' }}
            </v-btn>
          </div>

          <!-- 드래그&드롭 업로드 영역 -->
          <div v-if="!selectedFolder.isLocked" class="upload-area" :class="{ 'upload-hover': dragOver }"
               @drop="onDrop" @dragover="onDragOver" @dragleave="onDragLeave" @click="openFilePicker">
            <v-icon size="32" :color="dragOver ? 'primary' : 'grey-lighten-1'">mdi-cloud-upload</v-icon>
            <div style="font-size:var(--pms-font-body); margin-top:4px">파일을 드래그하거나 클릭하여 선택</div>
            <div style="font-size:var(--pms-font-mini); color:var(--pms-text-hint)">동일 파일명 업로드 시 버전이 자동 증가합니다</div>
            <v-progress-linear v-if="uploading" indeterminate color="primary" class="mt-2" />
            <input ref="fileInputRef" type="file" multiple hidden @change="onFileInput" />
          </div>

          <!-- 파일 목록 -->
          <div v-if="selectedFiles.length" class="pa-2">
            <table class="pms-table" style="width:100%">
              <thead>
                <tr>
                  <th>파일명</th>
                  <th style="width:40px">버전</th>
                  <th style="width:60px">크기</th>
                  <th style="width:70px">등록자</th>
                  <th style="width:120px">등록일시</th>
                  <th style="width:60px"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in selectedFiles" :key="f.fileId">
                  <td><a href="#" @click.prevent="downloadFile(f)" style="color:var(--pms-primary); text-decoration:none; cursor:pointer">{{ f.fileName }}</a></td>
                  <td class="text-center"><v-chip size="x-small" variant="tonal">v{{ f.version }}</v-chip></td>
                  <td class="text-center" style="font-size:var(--pms-font-caption)">{{ formatSize(f.fileSize) }}</td>
                  <td>{{ f.uploaderName || f.uploaderId }}</td>
                  <td style="font-size:var(--pms-font-caption)">{{ fmtDT(f.createdAt) }}</td>
                  <td class="text-center">
                    <v-btn v-if="!selectedFolder.isLocked" icon size="x-small" variant="text" color="error" @click="deleteFile(f)"><v-icon size="14">mdi-delete</v-icon></v-btn>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="text-center pa-6" style="color:var(--pms-text-hint); font-size:var(--pms-font-body)">등록된 파일이 없습니다.</div>
        </template>
      </div>
    </div>
    </template>

    <!-- ═══ 관리 산출물 탭 ═══ -->
    <template v-if="docTab === 'management'">
      <div v-if="!mgmtFolders.length" class="pms-card pa-8 text-center" style="color:var(--pms-text-hint)">
        <v-icon size="48" color="grey-lighten-1" class="mb-2">mdi-clipboard-list-outline</v-icon>
        <div style="font-size:var(--pms-font-body)">관리 산출물 폴더가 없습니다.</div>
        <div style="font-size:var(--pms-font-caption); margin-top:4px">"폴더 생성" 버튼으로 관리 산출물 기반 폴더를 생성하세요.</div>
      </div>

      <div v-else class="d-flex" style="gap:0; min-height:500px; border:1px solid var(--pms-border); border-radius:var(--pms-radius); overflow:hidden">
        <!-- 좌: 폴더 트리 -->
        <div style="width:300px; min-width:300px; border-right:1px solid var(--pms-border-light); overflow-y:auto; background:var(--pms-surface)">
          <div class="pa-2" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint); border-bottom:1px solid var(--pms-border-light)">
            관리 산출물 폴더 ({{ mgmtTotalFiles }}개 파일)
          </div>
          <div v-for="cat in mgmtFolders" :key="cat.folderId">
            <div class="folder-item folder-phase" @click="togglePhase(cat.folderId)">
              <v-icon size="14" class="mr-1">{{ expandedPhases.has(cat.folderId) ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
              <v-icon size="14" color="amber-darken-2" class="mr-1">mdi-folder</v-icon>
              <span style="font-weight:700">{{ cat.folderName }}</span>
              <span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint); margin-left:4px">({{ (cat.children || []).length }})</span>
            </div>
            <template v-if="expandedPhases.has(cat.folderId)">
              <div v-for="child in (cat.children || [])" :key="child.folderId"
                   class="folder-item folder-child" :class="{ 'folder-selected': selectedFolder?.folderId === child.folderId }"
                   @click="selectFolder(child)">
                <v-icon size="14" :color="child.isLocked ? 'error' : 'primary'" class="mr-1">
                  {{ child.isLocked ? 'mdi-folder-lock' : 'mdi-folder-open' }}
                </v-icon>
                <span>{{ child.folderName }}</span>
                <v-chip v-if="(child.files || []).length" size="x-small" variant="tonal" color="primary" class="ml-auto">{{ (child.files || []).length }}</v-chip>
                <v-icon v-if="child.isLocked" size="10" color="error" class="ml-1">mdi-lock</v-icon>
              </div>
            </template>
          </div>
        </div>

        <!-- 우: 파일 목록 (방법론 산출물과 동일한 UI 재사용) -->
        <div style="flex:1; overflow-y:auto; background:var(--pms-bg)">
          <div v-if="!selectedFolder" class="d-flex align-center justify-center" style="height:100%">
            <div class="text-center" style="color:var(--pms-text-hint)">
              <v-icon size="48" color="grey-lighten-1">mdi-folder-open-outline</v-icon>
              <div class="mt-2" style="font-size:var(--pms-font-body)">좌측에서 산출물 폴더를 선택하세요</div>
            </div>
          </div>
          <template v-else>
            <div class="d-flex align-center pa-3" style="border-bottom:1px solid var(--pms-border-light); gap:8px">
              <v-icon size="16" :color="selectedFolder.isLocked ? 'error' : 'primary'">{{ selectedFolder.isLocked ? 'mdi-folder-lock' : 'mdi-folder-open' }}</v-icon>
              <span style="font-size:var(--pms-font-subtitle); font-weight:700">{{ selectedFolder.folderName }}</span>
              <v-chip v-if="selectedFolder.isLocked" size="x-small" color="error" variant="tonal"><v-icon start size="10">mdi-lock</v-icon>잠금</v-chip>
              <v-spacer />
              <v-btn v-if="isPmsAdmin" size="x-small" :variant="selectedFolder.isLocked ? 'tonal' : 'outlined'" :color="selectedFolder.isLocked ? 'error' : 'grey'" @click="toggleLock(selectedFolder)">{{ selectedFolder.isLocked ? '잠금 해제' : '잠금' }}</v-btn>
            </div>
            <div v-if="!selectedFolder.isLocked" class="upload-area" :class="{ 'upload-hover': dragOver }" @drop="onDrop" @dragover="onDragOver" @dragleave="onDragLeave" @click="openFilePicker">
              <v-icon size="32" :color="dragOver ? 'primary' : 'grey-lighten-1'">mdi-cloud-upload</v-icon>
              <div style="font-size:var(--pms-font-body); margin-top:4px">파일을 드래그하거나 클릭하여 선택</div>
              <v-progress-linear v-if="uploading" indeterminate color="primary" class="mt-2" />
              <input ref="fileInputRef" type="file" multiple hidden @change="onFileInput" />
            </div>
            <div v-if="selectedFiles.length" class="pa-2">
              <table class="pms-table" style="width:100%">
                <thead><tr><th>파일명</th><th style="width:40px">버전</th><th style="width:60px">크기</th><th style="width:70px">등록자</th><th style="width:120px">등록일시</th><th style="width:60px"></th></tr></thead>
                <tbody>
                  <tr v-for="f in selectedFiles" :key="f.fileId">
                    <td><a href="#" @click.prevent="downloadFile(f)" style="color:var(--pms-primary); text-decoration:none; cursor:pointer">{{ f.fileName }}</a></td>
                    <td class="text-center"><v-chip size="x-small" variant="tonal">v{{ f.version }}</v-chip></td>
                    <td class="text-center" style="font-size:var(--pms-font-caption)">{{ formatSize(f.fileSize) }}</td>
                    <td>{{ f.uploaderName || f.uploaderId }}</td>
                    <td style="font-size:var(--pms-font-caption)">{{ fmtDT(f.createdAt) }}</td>
                    <td class="text-center"><v-btn v-if="!selectedFolder.isLocked" icon size="x-small" variant="text" color="error" @click="deleteFile(f)"><v-icon size="14">mdi-delete</v-icon></v-btn></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="text-center pa-6" style="color:var(--pms-text-hint); font-size:var(--pms-font-body)">등록된 파일이 없습니다.</div>
          </template>
        </div>
      </div>
    </template>
  </MainLayout>
</template>

<style scoped>
.folder-item {
  display: flex; align-items: center; padding: 6px 12px;
  cursor: pointer; font-size: var(--pms-font-body); transition: background 0.15s;
}
.folder-item:hover { background: var(--pms-hover, #f5f5f5); }
.folder-phase { font-size: var(--pms-font-body); }
.folder-child { padding-left: 32px; }
.folder-selected { background: #E3F2FD !important; }

.upload-area {
  margin: 12px; padding: 24px; text-align: center;
  border: 2px dashed var(--pms-border, #ccc); border-radius: var(--pms-radius);
  cursor: pointer; transition: border-color 0.2s, background 0.2s;
}
.upload-area:hover { border-color: var(--pms-primary); background: #f8f9ff; }
.upload-hover { border-color: var(--pms-primary) !important; background: #E3F2FD !important; }
</style>
