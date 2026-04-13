<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import { projectService } from '@/services/projects'
import { useDialog } from '@/composables/useDialog'
import type { Project } from '@/types'

const { showAlert, showConfirm } = useDialog()
const router = useRouter()
const authStore = useAuthStore()

const projects = ref<Project[]>([])
const loading = ref(false)

// 추가 폼
const showAdd = ref(false)
const addForm = ref({ projectName: '', startDate: '', endDate: '', clientOrg: '', contractors: '', description: '' })

// 수정 모달
const editDialog = ref(false)
const editId = ref<number | null>(null)
const editForm = ref({ projectName: '', startDate: '', endDate: '', clientOrg: '', contractors: '', description: '' })

async function fetchProjects() {
  loading.value = true
  try {
    const result = await projectService.getList({ size: 100 })
    if (result.success) projects.value = result.data
  } catch {} finally { loading.value = false }
}

async function addProject() {
  if (!addForm.value.projectName || !addForm.value.startDate || !addForm.value.endDate) {
    await showAlert('프로젝트명, 시작일, 종료일은 필수입니다.', { color: 'error' }); return
  }
  try {
    const contractors = addForm.value.contractors ? addForm.value.contractors.split('\n').filter(s => s.trim()).map(s => ({ name: s.trim(), type: '' })) : []
    await projectService.create({ ...addForm.value, contractors } as any)
    showAdd.value = false
    addForm.value = { projectName: '', startDate: '', endDate: '', clientOrg: '', contractors: '', description: '' }
    await fetchProjects()
    await showAlert('프로젝트가 등록되었습니다.')
  } catch (err: any) { showAlert(err.response?.data?.message || '등록 실패', { color: 'error' }) }
}

function openEdit(p: Project) {
  editId.value = p.projectId
  editForm.value = {
    projectName: p.projectName,
    startDate: p.startDate?.substring(0, 10) || '',
    endDate: p.endDate?.substring(0, 10) || '',
    clientOrg: (p as any).clientOrg || '',
    contractors: ((p as any).contractors || []).map((c: any) => typeof c === 'string' ? c : c.name).join('\n'),
    description: p.description || '',
  }
  editDialog.value = true
}

async function saveEdit() {
  if (!editId.value) return
  try {
    const contractors = editForm.value.contractors ? editForm.value.contractors.split('\n').filter((s: string) => s.trim()).map((s: string) => ({ name: s.trim(), type: '' })) : []
    await projectService.update(editId.value, { ...editForm.value, contractors })
    editDialog.value = false; await fetchProjects()
    await showAlert('수정되었습니다.')
  } catch (err: any) { showAlert(err.response?.data?.message || '수정 실패', { color: 'error' }) }
}

async function deleteProject(p: Project) {
  if (!(await showConfirm(`"${p.projectName}" 프로젝트를 삭제하시겠습니까?\n\n모든 데이터가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`))) return
  if (!(await showConfirm(`정말로 삭제하시겠습니까?`))) return
  try {
    await projectService.remove(p.projectId)
    await fetchProjects()
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

function goProject(p: Project) {
  authStore.myProjectId = p.projectId
  authStore.myProjectName = p.projectName
  router.push(`/projects/${p.projectId}?tab=info`)
}

function fmtDate(d: string) { return d ? d.substring(0, 10) : '-' }

onMounted(fetchProjects)
</script>

<template>
  <MainLayout>
    <div class="d-flex align-center mb-3">
      <span class="pms-page-title">프로젝트 관리</span>
      <v-chip size="small" variant="tonal" class="ml-2">{{ projects.length }}개</v-chip>
      <v-spacer />
      <v-btn v-if="authStore.isAdmin" size="small" color="primary" prepend-icon="mdi-plus" @click="showAdd = !showAdd">
        {{ showAdd ? '닫기' : '프로젝트 추가' }}
      </v-btn>
    </div>

    <!-- 추가 폼 -->
    <div v-if="showAdd" class="add-card mb-3">
      <div class="add-title">새 프로젝트 등록</div>
      <div class="add-body">
        <div class="add-row">
          <div class="add-field" style="flex:2">
            <label>프로젝트명 <span class="req">*</span></label>
            <input v-model="addForm.projectName" type="text" placeholder="프로젝트 공식 명칭" />
          </div>
        </div>
        <div class="add-row">
          <div class="add-field">
            <label>시작일 <span class="req">*</span></label>
            <input v-model="addForm.startDate" type="date" />
          </div>
          <div class="add-field">
            <label>종료일 <span class="req">*</span></label>
            <input v-model="addForm.endDate" type="date" />
          </div>
        </div>
        <div class="add-row">
          <div class="add-field">
            <label>발주기관</label>
            <input v-model="addForm.clientOrg" placeholder="발주처 기관명" />
          </div>
          <div class="add-field">
            <label>수행사</label>
            <textarea v-model="addForm.contractors" rows="2" placeholder="업체명 (줄바꿈으로 구분, 최대 5개사)"></textarea>
          </div>
        </div>
        <div class="add-row">
          <div class="add-field" style="flex:2">
            <label>설명</label>
            <textarea v-model="addForm.description" rows="2" placeholder="사업 목적, 범위 등"></textarea>
          </div>
        </div>
        <div class="add-row" style="justify-content:flex-end">
          <v-alert type="info" variant="tonal" density="compact" style="font-size:12px; flex:1; margin-right:12px">
            프로젝트 생성 후 사용자 관리에서 PMSAdmin 계정을 등록하세요.
          </v-alert>
          <button class="btn-add" @click="addProject">등록</button>
        </div>
      </div>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

    <!-- 프로젝트 카드 목록 -->
    <div v-if="!projects.length && !loading" class="text-center pa-8" style="color:#999">등록된 프로젝트가 없습니다.</div>
    <div v-for="p in projects" :key="p.projectId" class="proj-card" @click="goProject(p)">
      <div class="proj-header">
        <span class="proj-name">{{ p.projectName }}</span>
        <v-chip :color="p.status === '진행' ? 'success' : p.status === '완료' ? 'primary' : 'grey'" size="x-small" variant="tonal">{{ p.status }}</v-chip>
        <span class="proj-biz">{{ p.businessNo }}</span>
        <v-spacer />
        <div v-if="authStore.isAdmin" class="proj-actions" @click.stop>
          <button class="btn-edit" @click="openEdit(p)">수정</button>
          <button class="btn-del" @click="deleteProject(p)">삭제</button>
        </div>
      </div>
      <div class="proj-body">
        <div class="proj-info"><span class="pi-label">사업기간</span><span class="pi-value">{{ fmtDate(p.startDate) }} ~ {{ fmtDate(p.endDate) }}</span></div>
        <div v-if="p.clientOrg" class="proj-info"><span class="pi-label">발주기관</span><span class="pi-value">{{ p.clientOrg }}</span></div>
        <div v-if="(p as any).contractors?.length" class="proj-info"><span class="pi-label">수행사</span><span class="pi-value">{{ (p as any).contractors.map((c: any) => typeof c === 'string' ? c : c.name).join(', ') }}</span></div>
        <div v-if="p.description" class="proj-info"><span class="pi-label">설명</span><span class="pi-value">{{ p.description }}</span></div>
      </div>
    </div>

    <!-- 수정 오버레이 -->
    <div v-if="editDialog" class="edit-overlay" @click.self="editDialog = false">
      <div class="edit-panel">
        <div class="edit-header">
          <span>프로젝트 수정</span>
          <button class="edit-close" @click="editDialog = false">&times;</button>
        </div>
        <div class="edit-body">
          <div class="add-row">
            <div class="add-field" style="flex:2"><label>프로젝트명 <span class="req">*</span></label><input v-model="editForm.projectName" /></div>
          </div>
          <div class="add-row">
            <div class="add-field"><label>시작일 <span class="req">*</span></label><input v-model="editForm.startDate" type="date" /></div>
            <div class="add-field"><label>종료일 <span class="req">*</span></label><input v-model="editForm.endDate" type="date" /></div>
          </div>
          <div class="add-row">
            <div class="add-field"><label>발주기관</label><input v-model="editForm.clientOrg" /></div>
            <div class="add-field"><label>수행사 (줄바꿈 구분)</label><textarea v-model="editForm.contractors" rows="2"></textarea></div>
          </div>
          <div class="add-row">
            <div class="add-field" style="flex:2"><label>설명</label><textarea v-model="editForm.description" rows="3"></textarea></div>
          </div>
          <div class="add-row" style="justify-content:flex-end; gap:8px">
            <button class="btn-cancel" @click="editDialog = false">취소</button>
            <button class="btn-add" @click="saveEdit">저장</button>
          </div>
        </div>
      </div>
    </div>
  </MainLayout>
</template>

<style scoped>
/* TMS 스타일 프로젝트 카드 */
.add-card { border: 2px dashed #1976D2; border-radius: 12px; background: #fafbff; overflow: hidden; }
.add-title { padding: 12px 20px; font-size: 14px; font-weight: 700; color: #1976D2; border-bottom: 1px solid #e0e0e0; }
.add-body { padding: 16px 20px; }
.add-row { display: flex; gap: 12px; margin-bottom: 12px; }
.add-field { flex: 1; }
.add-field label { display: block; font-size: 12px; font-weight: 600; color: #555; margin-bottom: 4px; }
.req { color: #E53935; }
.add-field input, .add-field textarea {
  width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px;
  font-size: 13px; box-sizing: border-box; background: #fff;
}
.add-field input:focus, .add-field textarea:focus { outline: none; border-color: #1976D2; box-shadow: 0 0 0 2px rgba(25,118,210,0.1); }
.btn-add {
  padding: 8px 24px; background: #1976D2; color: #fff; border: none; border-radius: 8px;
  font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s;
}
.btn-add:hover { background: #1565C0; }

.proj-card {
  background: #fff; border: 1px solid #e0e0e0; border-radius: 12px;
  margin-bottom: 10px; cursor: pointer; transition: all 0.15s; overflow: hidden;
}
.proj-card:hover { border-color: #1976D2; box-shadow: 0 2px 8px rgba(25,118,210,0.08); transform: translateY(-1px); }
.proj-header {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px; border-bottom: 1px solid #f0f0f0;
}
.proj-name { font-size: 15px; font-weight: 700; color: #333; }
.proj-biz { font-size: 11px; color: #999; font-family: monospace; }
.proj-actions { display: flex; gap: 4px; }
.btn-edit, .btn-del {
  padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid; transition: all 0.15s;
}
.btn-edit { border-color: #1976D2; color: #1976D2; background: #fff; }
.btn-edit:hover { background: #1976D2; color: #fff; }
.btn-del { border-color: #E53935; color: #E53935; background: #fff; }
.btn-del:hover { background: #E53935; color: #fff; }
.proj-body { padding: 10px 16px; }
.proj-info { display: flex; gap: 8px; margin-bottom: 4px; font-size: 12px; }
.pi-label { color: #888; min-width: 60px; flex-shrink: 0; }
.pi-value { color: #333; }

/* 수정 오버레이 */
.edit-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; justify-content: center; align-items: center; z-index: 1000; }
.edit-panel { background: #fff; border-radius: 16px; width: 520px; max-height: 90vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.15); }
.edit-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #eee; font-size: 16px; font-weight: 700; }
.edit-close { background: none; border: none; font-size: 22px; cursor: pointer; color: #999; }
.edit-close:hover { color: #333; }
.edit-body { padding: 20px; }
.btn-cancel { padding: 8px 20px; border: 1px solid #ddd; border-radius: 8px; background: #fff; font-size: 13px; cursor: pointer; }
.btn-cancel:hover { background: #f5f5f5; }
</style>
