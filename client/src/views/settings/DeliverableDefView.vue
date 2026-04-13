<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import { methodologyService } from '@/services/methodology'
import { projectService } from '@/services/projects'
import { docStorageService } from '@/services/docStorage'
import { mgmtDeliverableService } from '@/services/mgmtDeliverables'
import { useDialog } from '@/composables/useDialog'
import api from '@/services/api'

const { showAlert, showConfirm } = useDialog()

const route = useRoute()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)
const tab = ref<'methodology' | 'tailoring'>('tailoring')

// ═══ 방법론 관리 ═══
const methodologies = ref<any[]>([])
const selectedMethodology = ref<number | null>(null)
const methodologyDeliverables = ref<any[]>([])

const mDialog = ref(false)
const mEditMode = ref(false)
const mEditId = ref<number | null>(null)
const mForm = ref({ name: '', description: '' })

const dDialog = ref(false)
const dEditMode = ref(false)
const dEditId = ref<number | null>(null)
const dForm = ref({ phase: '분석', docCode: '', docName: '', mandatory: '선택', description: '' })
const phases = ['분석', '설계', '구현', '시험', '이행']

async function fetchMethodologies() {
  const res = await methodologyService.getList()
  if (res.success) {
    methodologies.value = res.data
    if (!selectedMethodology.value && res.data.length) selectedMethodology.value = res.data[0].methodologyId
  }
}

async function fetchDeliverables() {
  if (!selectedMethodology.value) { methodologyDeliverables.value = []; return }
  const res = await methodologyService.getDeliverables(selectedMethodology.value)
  if (res.success) methodologyDeliverables.value = res.data
}

function openMCreate() { mEditMode.value = false; mForm.value = { name: '', description: '' }; mDialog.value = true }
function openMEdit(m: any) { mEditMode.value = true; mEditId.value = m.methodologyId; mForm.value = { name: m.name, description: m.description || '' }; mDialog.value = true }
async function saveM() {
  try {
    if (mEditMode.value && mEditId.value) await methodologyService.update(mEditId.value, mForm.value)
    else await methodologyService.create(mForm.value)
    mDialog.value = false; await fetchMethodologies()
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
}
async function deleteM(m: any) {
  if (!(await showConfirm(`"${m.name}" 방법론과 산출물을 모두 삭제하시겠습니까?`))) return
  try { await methodologyService.remove(m.methodologyId); selectedMethodology.value = null; await fetchMethodologies() } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

function openDCreate() { dEditMode.value = false; dForm.value = { phase: '분석', docCode: '', docName: '', mandatory: '선택', description: '' }; dDialog.value = true }
function openDEdit(d: any) { dEditMode.value = true; dEditId.value = d.masterId; dForm.value = { phase: d.phase, docCode: d.docCode, docName: d.docName, mandatory: d.mandatory, description: d.description || '' }; dDialog.value = true }
async function saveD() {
  if (!selectedMethodology.value) return
  try {
    if (dEditMode.value && dEditId.value) await methodologyService.updateDeliverable(selectedMethodology.value, dEditId.value, dForm.value)
    else await methodologyService.createDeliverable(selectedMethodology.value, dForm.value)
    dDialog.value = false; await fetchDeliverables()
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
}
async function deleteD(d: any) {
  if (!selectedMethodology.value) return
  if (!(await showConfirm(`"${d.docName}"을(를) 삭제하시겠습니까?`))) return
  try { await methodologyService.removeDeliverable(selectedMethodology.value, d.masterId); await fetchDeliverables() } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

// ═══ 테일러링 ═══
const projectMethodologyId = ref<number | null>(null)
const tailored = ref<any[]>([])
const tailoringSearch = ref('')

// 단계별 그룹핑 + 검색 필터
const filteredTailored = computed(() => {
  let list = tailored.value
  if (tailoringSearch.value) {
    const kw = tailoringSearch.value.toLowerCase()
    list = list.filter((t: any) =>
      (t.master?.docName || '').toLowerCase().includes(kw) ||
      (t.master?.docCode || '').toLowerCase().includes(kw) ||
      (t.projectDocName || '').toLowerCase().includes(kw) ||
      (t.master?.phase || '').includes(kw)
    )
  }
  return list
})

// 통계
const appliedCount = computed(() => tailored.value.filter((t: any) => t.applied).length)
const notAppliedCount = computed(() => tailored.value.filter((t: any) => !t.applied).length)

// 원본 데이터 (서버 상태)
const savedTailored = ref<any[]>([])
const isDirty = ref(false)
const saving = ref(false)
const validationErrors = ref<string[]>([])

async function fetchTailoring() {
  const res = await methodologyService.getTailoring(projectId)
  if (res.success) {
    projectMethodologyId.value = res.data.methodologyId
    // 깊은 복사로 편집용/원본용 분리
    savedTailored.value = JSON.parse(JSON.stringify(res.data.tailored))
    tailored.value = JSON.parse(JSON.stringify(res.data.tailored))
    isDirty.value = false
    validationErrors.value = []
  }
}

async function setProjectMethodology(mId: number) {
  try {
    await projectService.update(projectId, { methodologyId: mId })
    await methodologyService.initTailoring(projectId)
    await fetchTailoring()
  } catch (err: any) { showAlert(err.response?.data?.message || '설정 실패', { color: 'error' }) }
}

async function initTailoring() {
  if (!(await showConfirm('방법론 산출물을 기준으로 테일러링을 초기화합니다.\n기존 테일러링 데이터가 삭제됩니다. 계속하시겠습니까?'))) return
  try {
    const res = await methodologyService.initTailoring(projectId)
    await showAlert(res.message)
    await fetchTailoring()
  } catch (err: any) { showAlert(err.response?.data?.message || '초기화 실패', { color: 'error' }) }
}

// 로컬 편집 (서버 호출 없이 즉시 반영)
function localUpdate(item: any, field: string, value: any) {
  const idx = tailored.value.findIndex((t: any) => t.projDelId === item.projDelId)
  if (idx >= 0) tailored.value[idx][field] = value
  isDirty.value = true
  validationErrors.value = []
}

function localToggleApplied(item: any) {
  const newVal = !item.applied
  localUpdate(item, 'applied', newVal)
  if (!newVal) {
    localUpdate(item, 'interim', false)
    localUpdate(item, 'official', false)
    localUpdate(item, 'projectDocName', '')
  } else {
    localUpdate(item, 'projectDocName', item.master?.docName || '')
    localUpdate(item, 'notAppliedReason', '')
  }
}

// validation: 미적용 → 사유 필수, 중간과정 → 비고 필수
function validate(): boolean {
  const errors: string[] = []
  for (const t of tailored.value) {
    if (!t.applied && !(t.notAppliedReason || '').trim()) {
      errors.push(`[${t.master?.phase}] ${t.master?.docName} — 미적용 사유를 입력해주세요.`)
    }
    if (t.applied && t.interim && !(t.remark || '').trim()) {
      errors.push(`[${t.master?.phase}] ${t.master?.docName} — 중간과정 산출물의 비고를 입력해주세요.`)
    }
  }
  validationErrors.value = errors
  return errors.length === 0
}

async function saveTailoring() {
  if (!validate()) return
  saving.value = true
  try {
    for (const t of tailored.value) {
      await methodologyService.updateItem(projectId, t.projDelId, {
        applied: t.applied,
        projectDocName: t.projectDocName,
        interim: t.interim,
        official: t.official,
        notAppliedReason: t.notAppliedReason,
        remark: t.remark,
      })
    }
    await fetchTailoring()
    await showAlert('저장이 완료되었습니다.')
  } catch (err: any) {
    showAlert(err.response?.data?.message || '저장 실패', { color: 'error' })
    return
  } finally {
    saving.value = false
  }

  // 산출물 폴더 생성 제안 (저장 성공 후, 폴더 없을 때만)
  try {
    const folderRes = await docStorageService.getFolders(projectId)
    const hasFolders = folderRes.success && folderRes.data?.length > 0
    if (!hasFolders) {
      if (await showConfirm('산출물 폴더를 생성하시겠습니까?\n적용 산출물 기준으로 단계별 폴더가 생성됩니다.\n\n나중에 산출물 관리 화면에서도 생성할 수 있습니다.')) {
        const initRes = await docStorageService.initFolders(projectId, false)
        if (initRes.success) await showAlert(initRes.message)
      }
    }
  } catch {}
}

async function cancelTailoring() {
  if (isDirty.value && !(await showConfirm('변경 내용이 있습니다. 취소하시겠습니까?'))) return
  tailored.value = JSON.parse(JSON.stringify(savedTailored.value))
  isDirty.value = false
  validationErrors.value = []
}

async function doExport() {
  if (isDirty.value) { await showAlert('저장하지 않은 변경 사항이 있습니다. 먼저 저장해주세요.'); return }
  const token = localStorage.getItem('token')
  window.open(`${methodologyService.exportUrl(projectId)}?token=${token}`, '_blank')
}

// ═══ 관리 산출물 ═══
const mgmtItems = ref<any[]>([])
const mgmtDirty = ref(false)
const mgmtSaving = ref(false)
const mgmtDialog = ref(false)
const mgmtEditMode = ref(false)
const mgmtEditId = ref<number | null>(null)
const mgmtForm = ref({ category: '계획서', docName: '', isCustomer: false, isInternal: false, remark: '' })
const mgmtCategories = ['기본정보', '프로젝트 목표 및 관리정책', '프로젝트 표준', '프로젝트 계획', '프로젝트 실행 및 통제', '프로젝트 종료']

async function fetchMgmt() {
  const res = await mgmtDeliverableService.getList(projectId)
  if (res.success) { mgmtItems.value = res.data; mgmtDirty.value = false }
}

function openMgmtCreate() {
  mgmtEditMode.value = false; mgmtEditId.value = null
  mgmtForm.value = { category: '프로젝트 계획', docName: '', isCustomer: false, isInternal: false, remark: '' }
  mgmtDialog.value = true
}
function openMgmtEdit(item: any) {
  mgmtEditMode.value = true; mgmtEditId.value = item.mgmtDelId
  mgmtForm.value = { category: item.category, docName: item.docName, isCustomer: item.isCustomer, isInternal: item.isInternal, remark: item.remark || '' }
  mgmtDialog.value = true
}
async function saveMgmt() {
  if (!mgmtForm.value.docName) { await showAlert('문서명은 필수입니다.', { color: 'error' }); return }
  try {
    if (mgmtEditMode.value && mgmtEditId.value) await mgmtDeliverableService.update(projectId, mgmtEditId.value, mgmtForm.value)
    else await mgmtDeliverableService.create(projectId, mgmtForm.value)
    mgmtDialog.value = false; await fetchMgmt()
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
}
async function deleteMgmt(item: any) {
  if (!(await showConfirm(`"${item.docName}"을 삭제하시겠습니까?`))) return
  try { await mgmtDeliverableService.remove(projectId, item.mgmtDelId); await fetchMgmt() } catch {}
}
function mgmtLocalToggle(item: any, field: string) {
  (item as any)[field] = !(item as any)[field]
  // 내부관리 선택 시 공식제출 해제
  if (field === 'isInternal' && item.isInternal) item.isCustomer = false
  // 미적용 시 모두 해제
  if (field === 'applied' && !item.applied) { item.isInternal = false; item.isCustomer = false }
  mgmtDirty.value = true
}
async function saveMgmtBatch() {
  mgmtSaving.value = true
  try {
    await mgmtDeliverableService.batchUpdate(projectId, mgmtItems.value.map(i => ({
      mgmtDelId: i.mgmtDelId, applied: i.applied, isCustomer: i.isCustomer, isInternal: i.isInternal, remark: i.remark,
    })))
    await fetchMgmt(); await showAlert('저장되었습니다.')
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
  finally { mgmtSaving.value = false }
}

onMounted(async () => {
  await fetchMethodologies()
  await fetchTailoring()
  await fetchDeliverables()
  await fetchMgmt()
})
</script>

<template>
  <MainLayout>
    <div class="del-def-page">
    <v-row class="mb-1" align="center" dense>
      <v-col cols="auto"><v-btn icon size="small" variant="text" @click="$router.push(`/projects/${projectId}`)"><v-icon>mdi-arrow-left</v-icon></v-btn></v-col>
      <v-col><span class="pms-page-title">방법론 / 산출물 정의</span></v-col>
    </v-row>

    <v-tabs v-model="tab" color="primary" density="compact" class="mb-2">
      <v-tab value="tailoring" size="small"><v-icon size="14" start>mdi-file-cog</v-icon>산출물 테일러링</v-tab>
      <v-tab value="management" size="small"><v-icon size="14" start>mdi-clipboard-list</v-icon>관리 산출물</v-tab>
      <v-tab value="methodology" size="small"><v-icon size="14" start>mdi-bookshelf</v-icon>방법론 관리</v-tab>
    </v-tabs>

    <!-- ═══ 테일러링 탭 ═══ -->
    <div v-if="tab === 'tailoring'">
      <!-- 방법론 선택 + 도구 -->
      <div class="pms-card pa-2 mb-2">
        <v-row align="center" dense>
          <v-col cols="auto" style="font-size:var(--pms-font-body); font-weight:600">적용 방법론:</v-col>
          <v-col cols="3">
            <v-select
              :model-value="projectMethodologyId"
              :items="methodologies.map(m => ({ title: m.name, value: m.methodologyId }))"
              variant="outlined" density="compact" hide-details
              placeholder="방법론 선택"
              @update:model-value="setProjectMethodology($event)"
              class="pms-filter"
            />
          </v-col>
          <v-col cols="3">
            <v-text-field v-model="tailoringSearch" placeholder="검색 (산출물명, 코드, 단계)" prepend-inner-icon="mdi-magnify" variant="outlined" density="compact" hide-details clearable class="pms-filter" />
          </v-col>
          <v-spacer />
          <v-col cols="auto" class="d-flex" style="gap:4px">
            <v-btn size="x-small" variant="outlined" prepend-icon="mdi-refresh" @click="initTailoring" :disabled="!projectMethodologyId">초기화</v-btn>
            <v-btn size="x-small" variant="outlined" prepend-icon="mdi-file-download-outline" @click="doExport" :disabled="!tailored.length">엑셀 다운로드</v-btn>
            <v-btn size="x-small" variant="outlined" @click="cancelTailoring" :disabled="!isDirty">취소</v-btn>
            <v-btn size="x-small" color="primary" prepend-icon="mdi-content-save" @click="saveTailoring" :disabled="!isDirty" :loading="saving">저장</v-btn>
          </v-col>
        </v-row>
      </div>

      <!-- 통계 -->
      <v-row v-if="tailored.length" class="mb-2" dense>
        <v-col cols="auto">
          <v-chip size="small" variant="tonal" color="success" class="mr-1">적용 {{ appliedCount }}건</v-chip>
          <v-chip size="small" variant="tonal" color="grey" class="mr-1">미적용 {{ notAppliedCount }}건</v-chip>
          <v-chip size="small" variant="outlined">전체 {{ tailored.length }}건</v-chip>
        </v-col>
      </v-row>

      <!-- validation 에러 -->
      <v-alert v-if="validationErrors.length" type="error" variant="tonal" density="compact" class="mb-2" closable @click:close="validationErrors = []">
        <div class="font-weight-bold mb-1" style="font-size:12px">미적용 산출물에 사유를 입력해주세요 ({{ validationErrors.length }}건)</div>
        <div v-for="(e, i) in validationErrors.slice(0, 5)" :key="i" style="font-size:11px">{{ e }}</div>
        <div v-if="validationErrors.length > 5" style="font-size:11px">... 외 {{ validationErrors.length - 5 }}건</div>
      </v-alert>

      <!-- 변경 표시 -->
      <v-alert v-if="isDirty" type="warning" variant="tonal" density="compact" class="mb-2">
        <span style="font-size:12px">변경 사항이 있습니다. 저장 버튼을 눌러 확정하세요.</span>
      </v-alert>

      <!-- 단일 테이블 -->
      <div v-if="tailored.length" class="pms-card">
        <div style="overflow-x:auto">
          <table class="tailoring-table">
            <thead>
              <tr>
                <th style="width:30px; text-align:center">No</th>
                <th style="width:200px">방법론 경로 산출물</th>
                <th style="width:200px">프로젝트 적용 산출물</th>
                <th style="width:50px">적용<br>여부</th>
                <th style="width:50px">중간<br>과정</th>
                <th style="width:50px">공식<br>제출</th>
                <th style="width:180px">미적용 사유</th>
                <th style="width:180px">비고</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="phase in phases" :key="phase">
                <template v-if="filteredTailored.filter((t: any) => t.master?.phase === phase).length">
                  <tr class="phase-row"><td colspan="8">{{ phase }} ({{ filteredTailored.filter((t: any) => t.master?.phase === phase).length }})</td></tr>
                  <tr
                    v-for="(t, idx) in filteredTailored.filter((a: any) => a.master?.phase === phase)"
                    :key="t.projDelId"
                    :class="{ 'row-applied': t.applied, 'row-not-applied': !t.applied }"
                  >
                    <td class="td-center" style="color:var(--pms-text-hint)">{{ idx + 1 }}</td>
                    <td class="td-left">{{ t.master?.docName }}</td>
                    <td class="td-left">
                      <input v-if="t.applied" class="inline-input" :value="t.projectDocName || ''" @input="localUpdate(t, 'projectDocName', ($event.target as HTMLInputElement).value)" />
                      <span v-else class="text-grey-dim">—</span>
                    </td>
                    <td class="td-center"><v-checkbox-btn :model-value="t.applied" @update:model-value="localToggleApplied(t)" density="compact" /></td>
                    <td class="td-center"><v-checkbox-btn v-if="t.applied" :model-value="t.interim" @update:model-value="localUpdate(t, 'interim', $event)" density="compact" /></td>
                    <td class="td-center"><v-checkbox-btn v-if="t.applied" :model-value="t.official" @update:model-value="localUpdate(t, 'official', $event)" density="compact" /></td>
                    <td class="td-left">
                      <input v-if="!t.applied" class="inline-input" :class="{ 'input-error': !t.applied && !(t.notAppliedReason || '').trim() && validationErrors.length }" :value="t.notAppliedReason || ''" placeholder="미적용 사유 입력" @input="localUpdate(t, 'notAppliedReason', ($event.target as HTMLInputElement).value)" />
                    </td>
                    <td class="td-left">
                      <textarea
                        class="inline-textarea"
                        :class="{ 'input-error': t.applied && t.interim && !(t.remark || '').trim() && validationErrors.length }"
                        :value="t.remark || ''"
                        :placeholder="t.applied && t.interim ? '중간과정 사유 입력' : ''"
                        @input="localUpdate(t, 'remark', ($event.target as HTMLTextAreaElement).value)"
                        rows="1"
                      ></textarea>
                    </td>
                  </tr>
                </template>
              </template>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else-if="!projectMethodologyId" class="pms-card pa-8 text-center" style="color:var(--pms-text-hint)">
        <v-icon size="48" color="grey-lighten-1" class="mb-2">mdi-file-cog</v-icon>
        <div style="font-size:var(--pms-font-body)">방법론을 먼저 선택하세요. 방법론 관리 탭에서 방법론과 산출물을 등록할 수 있습니다.</div>
      </div>

      <div v-else class="pms-card pa-8 text-center" style="color:var(--pms-text-hint)">
        <v-icon size="48" color="grey-lighten-1" class="mb-2">mdi-refresh</v-icon>
        <div style="font-size:var(--pms-font-body)">"초기화" 버튼을 클릭하여 방법론 산출물을 불러오세요.</div>
      </div>
    </div>

    <!-- ═══ 관리 산출물 탭 ═══ -->
    <div v-if="tab === 'management'">
      <div class="pms-card pa-2 mb-2">
        <v-row align="center" dense>
          <v-col cols="auto" style="font-size:var(--pms-font-body); font-weight:600">관리 산출물 ({{ mgmtItems.length }}건)</v-col>
          <v-spacer />
          <v-col cols="auto" class="d-flex" style="gap:4px">
            <v-btn size="x-small" variant="text" @click="fetchMgmt" :disabled="!mgmtDirty">취소</v-btn>
            <v-btn size="x-small" color="primary" prepend-icon="mdi-content-save" @click="saveMgmtBatch" :disabled="!mgmtDirty" :loading="mgmtSaving">저장</v-btn>
            <v-btn size="x-small" variant="outlined" prepend-icon="mdi-plus" @click="openMgmtCreate">추가</v-btn>
          </v-col>
        </v-row>
      </div>

      <div v-if="mgmtDirty" class="mb-2">
        <v-alert type="warning" variant="tonal" density="compact"><span style="font-size:var(--pms-font-body)">변경 사항이 있습니다. 저장 버튼을 눌러 확정하세요.</span></v-alert>
      </div>

      <div class="pms-card" v-if="mgmtItems.length">
        <div style="overflow-x:auto">
          <table class="tailoring-table">
            <thead>
              <tr>
                <th style="width:30px; text-align:center">No</th>
                <th style="width:375px">문서명</th>
                <th style="width:50px">적용<br>여부</th>
                <th style="width:50px">내부<br>관리</th>
                <th style="width:50px">공식<br>제출</th>
                <th style="width:200px">비고</th>
                <th style="width:50px">관리</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="cat in mgmtCategories" :key="cat">
                <template v-if="mgmtItems.filter((i: any) => i.category === cat).length">
                  <tr class="phase-row"><td colspan="7">{{ cat }} ({{ mgmtItems.filter((i: any) => i.category === cat).length }})</td></tr>
                  <tr v-for="(item, idx) in mgmtItems.filter((i: any) => i.category === cat)" :key="item.mgmtDelId"
                      :class="{ 'row-applied': item.applied, 'row-not-applied': !item.applied }">
                    <td class="text-center td-center" style="color:var(--pms-text-hint)">{{ idx + 1 }}</td>
                    <td class="td-left" style="font-weight:500">{{ item.docName }}</td>
                    <td class="td-center"><v-checkbox-btn :model-value="item.applied" @update:model-value="mgmtLocalToggle(item, 'applied')" density="compact" /></td>
                    <td class="td-center"><v-checkbox-btn :model-value="item.isInternal" @update:model-value="mgmtLocalToggle(item, 'isInternal')" density="compact" :disabled="!item.applied" /></td>
                    <td class="td-center"><v-checkbox-btn :model-value="item.isCustomer" @update:model-value="mgmtLocalToggle(item, 'isCustomer')" density="compact" :disabled="!item.applied || item.isInternal" /></td>
                    <td class="td-left"><textarea class="inline-textarea" :value="item.remark || ''" @input="item.remark = ($event.target as HTMLTextAreaElement).value; mgmtDirty = true" rows="1"></textarea></td>
                    <td class="td-center">
                      <v-btn icon size="14" variant="text" density="compact" @click="openMgmtEdit(item)"><v-icon size="12">mdi-pencil</v-icon></v-btn>
                      <v-btn icon size="14" variant="text" density="compact" color="error" @click="deleteMgmt(item)"><v-icon size="12">mdi-delete</v-icon></v-btn>
                    </td>
                  </tr>
                </template>
              </template>
            </tbody>
          </table>
        </div>
      </div>
      <div v-else class="pms-card pa-8 text-center" style="color:var(--pms-text-hint)">
        <v-icon size="48" color="grey-lighten-1" class="mb-2">mdi-clipboard-list</v-icon>
        <div style="font-size:var(--pms-font-body)">등록된 관리 산출물이 없습니다. "추가" 버튼으로 등록하세요.</div>
      </div>

      <!-- 관리 산출물 등록/수정 다이얼로그 -->
      <v-dialog v-model="mgmtDialog" max-width="480" persistent>
        <v-card>
          <v-card-title style="font-size:var(--pms-font-subtitle)">{{ mgmtEditMode ? '관리 산출물 수정' : '관리 산출물 추가' }}</v-card-title>
          <v-card-text>
            <v-row dense class="mb-2">
              <v-col cols="4"><v-select v-model="mgmtForm.category" :items="mgmtCategories" label="구분" variant="outlined" density="compact" hide-details class="pms-form" /></v-col>
              <v-col cols="8"><v-text-field v-model="mgmtForm.docName" variant="outlined" density="compact" hide-details class="pms-form">
                <template #label>문서명<span class="pms-required">*</span></template>
              </v-text-field></v-col>
            </v-row>
            <v-row dense class="mb-2">
              <v-col cols="4"><v-checkbox v-model="mgmtForm.isInternal" label="내부 관리" density="compact" hide-details @update:model-value="(v: boolean) => { if (v) mgmtForm.isCustomer = false }" /></v-col>
              <v-col cols="4"><v-checkbox v-model="mgmtForm.isCustomer" label="공식 제출" density="compact" hide-details :disabled="mgmtForm.isInternal" /></v-col>
            </v-row>
            <v-text-field v-model="mgmtForm.remark" label="비고" variant="outlined" density="compact" hide-details class="pms-form" />
          </v-card-text>
          <v-card-actions><v-spacer /><v-btn size="small" variant="outlined" @click="mgmtDialog = false">취소</v-btn><v-btn size="small" color="primary" @click="saveMgmt">저장</v-btn></v-card-actions>
        </v-card>
      </v-dialog>
    </div>

    <!-- ═══ 방법론 관리 탭 ═══ -->
    <div v-if="tab === 'methodology'">
      <v-row>
        <!-- 좌측: 방법론 목록 -->
        <v-col cols="4">
          <div class="pms-card">
            <div class="pms-section-header d-flex align-center">
              <v-icon size="14">mdi-bookshelf</v-icon> 방법론 목록
              <v-spacer />
              <v-btn size="x-small" variant="text" color="primary" prepend-icon="mdi-plus" @click="openMCreate">추가</v-btn>
            </div>
            <v-list density="compact">
              <v-list-item
                v-for="m in methodologies" :key="m.methodologyId"
                :active="selectedMethodology === m.methodologyId"
                @click="selectedMethodology = m.methodologyId; fetchDeliverables()"
                color="primary"
              >
                <v-list-item-title style="font-size:var(--pms-font-body)">{{ m.name }}</v-list-item-title>
                <v-list-item-subtitle style="font-size:var(--pms-font-caption)">산출물 {{ m._count?.deliverables || 0 }}건</v-list-item-subtitle>
                <template #append>
                  <v-btn icon size="14" variant="text" density="compact" @click.stop="openMEdit(m)"><v-icon size="12">mdi-pencil</v-icon></v-btn>
                  <v-btn icon size="14" variant="text" density="compact" color="error" @click.stop="deleteM(m)"><v-icon size="12">mdi-delete</v-icon></v-btn>
                </template>
              </v-list-item>
            </v-list>
          </div>
        </v-col>

        <!-- 우측: 선택된 방법론의 산출물 목록 -->
        <v-col cols="8">
          <div class="pms-card">
            <div class="pms-section-header d-flex align-center" style="background:#E3F2FD">
              <v-icon size="14">mdi-file-document-multiple</v-icon> 산출물 ({{ methodologyDeliverables.length }})
              <v-spacer />
              <v-btn v-if="selectedMethodology" size="x-small" variant="text" color="primary" prepend-icon="mdi-plus" @click="openDCreate">추가</v-btn>
            </div>
            <table v-if="methodologyDeliverables.length" class="pms-table" style="width:100%">
              <thead>
                <tr>
                  <th>단계</th>
                  <th>코드</th>
                  <th>산출물명</th>
                  <th>필수</th>
                  <th style="width:60px">관리</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in methodologyDeliverables" :key="d.masterId">
                  <td><v-chip size="x-small" variant="tonal">{{ d.phase }}</v-chip></td>
                  <td style="color:var(--pms-text-hint)">{{ d.docCode }}</td>
                  <td>{{ d.docName }}</td>
                  <td><v-chip v-if="d.mandatory === '필수'" color="error" size="x-small" variant="tonal">필수</v-chip></td>
                  <td>
                    <v-btn icon size="14" variant="text" density="compact" @click="openDEdit(d)"><v-icon size="12">mdi-pencil</v-icon></v-btn>
                    <v-btn icon size="14" variant="text" density="compact" color="error" @click="deleteD(d)"><v-icon size="12">mdi-delete</v-icon></v-btn>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="text-center pa-8" style="color:var(--pms-text-hint); font-size:var(--pms-font-body)">
              {{ selectedMethodology ? '등록된 산출물이 없습니다.' : '좌측에서 방법론을 선택하세요.' }}
            </div>
          </div>
        </v-col>
      </v-row>
    </div>

    <!-- 방법론 다이얼로그 -->
    <v-dialog v-model="mDialog" max-width="450">
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">{{ mEditMode ? '방법론 수정' : '방법론 등록' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="mForm.name" variant="outlined" density="compact" hide-details class="pms-form mb-3">
            <template #label>방법론명<span class="pms-required">*</span></template>
          </v-text-field>
          <v-textarea v-model="mForm.description" label="설명" variant="outlined" density="compact" hide-details rows="3" class="pms-form" />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn size="small" variant="outlined" @click="mDialog = false">취소</v-btn><v-btn size="small" color="primary" @click="saveM">저장</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 산출물 다이얼로그 -->
    <v-dialog v-model="dDialog" max-width="500">
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">{{ dEditMode ? '산출물 수정' : '산출물 추가' }}</v-card-title>
        <v-card-text>
          <v-row dense class="mb-2">
            <v-col cols="4"><v-select v-model="dForm.phase" :items="phases" label="단계" variant="outlined" density="compact" hide-details class="pms-form" /></v-col>
            <v-col cols="4">
              <v-text-field v-model="dForm.docCode" variant="outlined" density="compact" hide-details class="pms-form" :disabled="dEditMode">
                <template #label>코드<span class="pms-required">*</span></template>
              </v-text-field>
            </v-col>
            <v-col cols="4"><v-select v-model="dForm.mandatory" :items="['필수', '선택']" label="필수여부" variant="outlined" density="compact" hide-details class="pms-form" /></v-col>
          </v-row>
          <v-text-field v-model="dForm.docName" variant="outlined" density="compact" hide-details class="pms-form mb-2">
            <template #label>산출물명<span class="pms-required">*</span></template>
          </v-text-field>
          <v-textarea v-model="dForm.description" label="설명" variant="outlined" density="compact" hide-details rows="2" class="pms-form" />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn size="small" variant="outlined" @click="dDialog = false">취소</v-btn><v-btn size="small" color="primary" @click="saveD">저장</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    </div>
  </MainLayout>
</template>

<style>
/* 산출물 정의 페이지 전역 스타일 (Vuetify deep 적용) */
.del-def-page .v-field__input,
.del-def-page .v-select__selection-text,
.del-def-page .v-field input {
  font-size: 11px !important;
}
.del-def-page .v-field {
  min-height: 30px !important;
  font-size: 11px !important;
}
.del-def-page .v-field__append-inner .v-icon {
  font-size: 16px !important;
}
.del-def-page .v-chip {
  font-size: 11px !important;
}
.del-def-page .v-tab {
  font-size: 12px !important;
}
.del-def-page .v-alert {
  font-size: 12px !important;
}
.del-def-page .td-center .v-selection-control {
  justify-content: center !important;
}
</style>

<style scoped>
.tailoring-table {
  width: 100%;
  border-collapse: collapse;
}
.tailoring-table th {
  background: var(--pms-surface-variant, #f5f5f5);
  border-bottom: 2px solid var(--pms-border, #ccc);
  padding: 4px 6px;
  font-size: var(--pms-font-caption, 10px);
  font-weight: 600;
  text-align: center;
}
.tailoring-table td {
  border-bottom: 1px solid var(--pms-border-light, #eee);
  padding: 2px 6px;
  vertical-align: middle;
  font-size: var(--pms-font-body, 11px);
}
.td-center { text-align: center; }
.td-center .v-selection-control { justify-content: center; }
.td-left { text-align: left; }
.phase-row td {
  background: var(--pms-info-light, #e3f2fd);
  font-weight: 700;
  font-size: var(--pms-font-body, 11px);
  padding: 4px 10px;
  text-align: left;
}
.inline-input {
  width: 100%;
  border: 1px solid var(--pms-border, #e0e0e0);
  border-radius: var(--pms-radius, 3px);
  font-size: var(--pms-font-body, 11px);
  padding: 2px 5px;
  outline: none;
  background: #fff;
  height: 24px;
}
.inline-input:hover { border-color: #bbb; }
.inline-textarea {
  width: 100%;
  border: 1px solid var(--pms-border, #e0e0e0);
  border-radius: var(--pms-radius, 3px);
  font-size: var(--pms-font-body, 11px);
  padding: 2px 5px;
  outline: none;
  background: #fff;
  resize: vertical;
  min-height: 24px;
  height: 24px;
  line-height: 1.5;
  font-family: inherit;
  overflow: hidden;
}
.inline-textarea:focus { border-color: var(--pms-primary, #1976d2); background: #f8f9ff; overflow: auto; height: auto; min-height: 48px; }
.inline-textarea:hover { border-color: #bbb; }
.inline-input:focus { border-color: var(--pms-primary, #1976d2); background: #f8f9ff; }
.inline-input.input-error { border-color: var(--pms-error, #f44336); background: #fff5f5; }
.row-applied { background: #fafff9; }
.row-not-applied { background: var(--pms-surface, #fafafa); }
.row-not-applied td { color: var(--pms-text-hint, #999); }
.text-grey-dim { font-size: var(--pms-font-body, 11px); color: #ccc; }
</style>
