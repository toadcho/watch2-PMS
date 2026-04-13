<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import UserTreePicker from '@/components/common/UserTreePicker.vue'
import { requirementService } from '@/services/requirements'
import { projectService } from '@/services/projects'
import { useDialog } from '@/composables/useDialog'

const { showAlert, showConfirm } = useDialog()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)

const project = ref<any>(null)
const items = ref<any[]>([])
const loading = ref(false)
const keyword = ref('')
const filterStatus = ref('')
const filterReqType = ref('')
const filterBusiness = ref('')
const filterAssignee = ref('')
const page = ref(1)
const pageSize = ref(50)
const totalCount = ref(0)
const totalPages = ref(0)

const myRole = ref<any>(null)
const members = ref<any[]>([])
const filterAssigneeUserId = ref('')
const isPmsAdmin = computed(() => myRole.value?.isPmsAdmin || false)

const statusFilterOptions = [
  { title: '전체', value: '' },
  { title: '미분류', value: '미분류' },
  { title: '수용', value: '수용' },
  { title: '대체', value: '대체' }, { title: '통합', value: '통합' },
  { title: '제외', value: '제외' },
]
const reqTypeFilterOptions = [
  { title: '전체', value: '' },
  { title: '기능', value: '기능' }, { title: '비기능', value: '비기능' },
]
const statusColors: Record<string, string> = {
  '미분류': 'grey',
  '수용': 'success', '확정': 'indigo',
  '대체': 'warning', '통합': 'purple', '제외': 'error',
}
// 필터 옵션 — stats API에서 전체 데이터 기준으로 제공
const businessFilterOptions = computed(() => {
  const list = stats.value?.filterOptions?.businesses || []
  return [{ title: '전체', value: '' }, ...list.map((b: string) => ({ title: b, value: b }))]
})
const assigneeFilterOptions = computed(() => {
  const list = stats.value?.filterOptions?.assignees || []
  return [{ title: '전체', value: '' }, ...list.map((n: string) => ({ title: n, value: n }))]
})

// 통계
const stats = ref<any>(null)

async function fetchStats() {
  try {
    const userName = authStore.user?.userName || ''
    const res = await requirementService.getStats(projectId, userName)
    if (res.success) stats.value = res.data
  } catch {}
}

async function fetchData() {
  loading.value = true
  try {
    const params: any = { page: page.value, size: pageSize.value }
    if (keyword.value) params.keyword = keyword.value
    if (filterStatus.value) params.progressStatus = filterStatus.value
    if (filterReqType.value) params.reqType = filterReqType.value
    if (filterBusiness.value) params.business = filterBusiness.value
    if (filterAssignee.value) params.assigneeName = filterAssignee.value
    const res = await requirementService.getList(projectId, params)
    if (res.success) {
      items.value = res.data
      if (res.pagination) {
        totalCount.value = res.pagination.totalCount
        totalPages.value = res.pagination.totalPages
      }
    }
  } catch (err) { console.error(err) }
  finally { loading.value = false }
}

function applyFilter() { page.value = 1; fetchData() }
function goPage(p: number) { page.value = p; fetchData() }
function goDetail(item: any) { router.push(`/projects/${projectId}/requirements/${item.requirementId}`) }
function goCreate() { router.push(`/projects/${projectId}/requirements/new`) }

function onAssigneeFilterChange(userId: string) {
  filterAssigneeUserId.value = userId
  if (!userId) {
    filterAssignee.value = ''
  } else {
    const m = members.value.find((m: any) => (m.user?.userId || m.userId) === userId)
    filterAssignee.value = m ? (m.user?.userName || m.userName || userId) : userId
  }
  applyFilter()
}

async function baselineAll() {
  const unconfirmed = items.value.filter(i => !i.isBaselined)
  if (!unconfirmed.length) { await showAlert('확정 대상이 없습니다.'); return }
  const confirmed = await showConfirm(`미확정 ${unconfirmed.length}건의 요구사항을 확정합니다.\n\n확정 후에는 요구사항ID, 요구사항명, 요구사항 내용,\n도출유형, 도출단계, 출처구분, 출처상세를 수정할 수 없으며,\n변경 시 변경관리를 통해서만 가능합니다.\n\n계속하시겠습니까?`, { title: '전체 확정', color: 'warning' })
  if (!confirmed) return
  try {
    const res = await requirementService.baselineAll(projectId)
    if (res.success) { await showAlert(res.message); fetchData(); fetchStats() }
  } catch (err: any) { showAlert(err.response?.data?.message || '확정 실패', { color: 'error' }) }
}

// 컬럼 리사이즈
const colWidths = ref([36, 120, 200, 260, 85, 95, 80, 110])

function startResize(colIdx: number, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const startW = colWidths.value[colIdx]
  function onMove(ev: MouseEvent) {
    ev.preventDefault()
    colWidths.value[colIdx] = Math.max(30, startW + (ev.clientX - startX))
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// 엑셀
const importDialog = ref(false)
const importFile = ref<File | null>(null)
const importMode = ref<'append' | 'clear'>('append')
const importResult = ref<any>(null)
const importLoading = ref(false)
const importProgress = ref(0)

function downloadTemplate() {
  const token = localStorage.getItem('token')
  window.open(`/api/v1/projects/${projectId}/requirements/import-template?token=${token}`, '_blank')
}

function doExport() {
  const token = localStorage.getItem('token')
  window.open(`/api/v1/projects/${projectId}/requirements/export?token=${token}`, '_blank')
}

function onImportFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files?.length) importFile.value = files[0]
}

async function doImport() {
  if (!importFile.value) { await showAlert('파일을 선택해주세요.', { color: 'error' }); return }
  if (importMode.value === 'clear') {
    const ok = await showConfirm('기존 요구사항을 모두 삭제하고 새로 임포트합니다.\n(확정 건 포함 전체 삭제)\n\n계속하시겠습니까?', { title: '전체 초기화 후 임포트', color: 'warning' })
    if (!ok) return
  }
  importLoading.value = true
  importProgress.value = 10
  try {
    // 진행률 시뮬레이션
    const timer = setInterval(() => {
      if (importProgress.value < 85) importProgress.value += Math.random() * 15
    }, 300)

    const res = await requirementService.importExcel(projectId, importFile.value, importMode.value)
    clearInterval(timer)
    importProgress.value = 100

    importResult.value = res.data
    importDialog.value = false
    importFile.value = null
    importMode.value = 'append'
    await showAlert(res.message)
    fetchData(); fetchStats()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '임포트 실패', { color: 'error' })
  } finally {
    importLoading.value = false
    importProgress.value = 0
  }
}

onMounted(async () => {
  // 역할 먼저 조회
  try {
    const [projRes, roleRes] = await Promise.all([
      projectService.getDetail(projectId),
      projectService.getMyRole(projectId).catch(() => null),
    ])
    if (projRes.success) project.value = projRes.data
    if (roleRes?.success) myRole.value = roleRes.data
  } catch {}

  // 투입인력 로드
  try {
    const mRes = await projectService.getMembers(projectId)
    if (mRes.success) members.value = mRes.data
  } catch {}

  // PMS관리자가 아닌 경우만 담당자 필터를 본인으로 설정
  if (!isPmsAdmin.value) {
    filterAssigneeUserId.value = authStore.user?.userId || ''
    filterAssignee.value = authStore.user?.userName || ''
  }
  fetchData()
  fetchStats()
})
</script>

<template>
  <MainLayout>
    <!-- 헤더 -->
    <v-row class="mb-1" align="center" dense>
      <v-col cols="auto">
        <v-btn icon size="small" variant="text" @click="router.push(`/projects/${projectId}`)"><v-icon>mdi-arrow-left</v-icon></v-btn>
      </v-col>
      <v-col>
        <span class="pms-page-title">요구사항 관리</span>
        <span class="pms-page-subtitle">{{ project?.projectName }}</span>
      </v-col>
    </v-row>

    <!-- 통계 대시보드 -->
    <div v-if="stats" class="mb-3">
      <v-row dense>
        <!-- 전체 현황 카드 -->
        <v-col cols="12" md="4">
          <div class="stat-card">
            <div class="stat-card-header"><v-icon size="14" color="primary" class="mr-1">mdi-chart-box</v-icon>전체 현황</div>
            <div class="stat-card-body">
              <div class="stat-big-number">{{ stats.total.count }}<span class="stat-unit">건</span></div>
              <div class="stat-bars">
                <div class="stat-bar-row">
                  <span class="stat-bar-label">확정</span>
                  <div class="stat-bar-track"><div class="stat-bar-fill" :style="{ width: stats.total.count ? (stats.total.baselined / stats.total.count * 100) + '%' : '0%', background: 'var(--pms-primary)' }"></div></div>
                  <span class="stat-bar-value">{{ stats.total.baselined }}</span>
                </div>
                <div class="stat-bar-row">
                  <span class="stat-bar-label">미확정</span>
                  <div class="stat-bar-track"><div class="stat-bar-fill" :style="{ width: stats.total.count ? (stats.total.unbaselined / stats.total.count * 100) + '%' : '0%', background: '#BDBDBD' }"></div></div>
                  <span class="stat-bar-value">{{ stats.total.unbaselined }}</span>
                </div>
              </div>
            </div>
          </div>
        </v-col>
        <!-- 진행상태 카드 -->
        <v-col cols="12" md="4">
          <div class="stat-card">
            <div class="stat-card-header"><v-icon size="14" color="success" class="mr-1">mdi-progress-check</v-icon>진행상태</div>
            <div class="stat-card-body">
              <div class="stat-chips">
                <div class="stat-chip-item"><v-chip color="grey" variant="tonal" size="x-small">미분류</v-chip><span class="stat-chip-num">{{ stats.total.byStatus['미분류'] || 0 }}</span></div>
                <div class="stat-chip-item"><v-chip color="success" variant="tonal" size="x-small">수용</v-chip><span class="stat-chip-num">{{ stats.total.byStatus['수용'] || 0 }}</span></div>
                <div class="stat-chip-item"><v-chip color="warning" variant="tonal" size="x-small">대체</v-chip><span class="stat-chip-num">{{ stats.total.byStatus['대체'] || 0 }}</span></div>
                <div class="stat-chip-item"><v-chip color="error" variant="tonal" size="x-small">제외</v-chip><span class="stat-chip-num">{{ stats.total.byStatus['제외'] || 0 }}</span></div>
                <div class="stat-chip-item"><v-chip color="purple" variant="tonal" size="x-small">통합</v-chip><span class="stat-chip-num">{{ stats.total.byStatus['통합'] || 0 }}</span></div>
              </div>
              <div v-if="stats.personal" class="stat-personal">
                <v-icon size="12" class="mr-1">mdi-account</v-icon>{{ stats.personal.userName }}:
                <span class="ml-1">미분류 <strong>{{ stats.personal.byStatus['미분류'] || 0 }}</strong></span>
                <span class="ml-1">수용 <strong>{{ stats.personal.byStatus['수용'] || 0 }}</strong></span>
                <span class="ml-1">대체 <strong>{{ stats.personal.byStatus['대체'] || 0 }}</strong></span>
                <span class="ml-1">제외 <strong>{{ stats.personal.byStatus['제외'] || 0 }}</strong></span>
                <span class="ml-1">통합 <strong>{{ stats.personal.byStatus['통합'] || 0 }}</strong></span>
              </div>
            </div>
          </div>
        </v-col>
        <!-- 유형 카드 -->
        <v-col cols="12" md="4">
          <div class="stat-card">
            <div class="stat-card-header"><v-icon size="14" color="info" class="mr-1">mdi-tag-multiple</v-icon>요구사항 유형</div>
            <div class="stat-card-body">
              <div class="stat-chips">
                <div class="stat-chip-item"><v-chip color="teal" variant="tonal" size="x-small">기능</v-chip><span class="stat-chip-num">{{ stats.total.byType['기능'] || 0 }}</span></div>
                <div class="stat-chip-item"><v-chip color="orange" variant="tonal" size="x-small">비기능</v-chip><span class="stat-chip-num">{{ stats.total.byType['비기능'] || 0 }}</span></div>
              </div>
              <div v-if="stats.personal" class="stat-personal">
                <v-icon size="12" class="mr-1">mdi-account</v-icon>{{ stats.personal.userName }}:
                <span class="ml-1">기능 <strong>{{ stats.personal.byType['기능'] || 0 }}</strong></span>
                <span class="ml-1">비기능 <strong>{{ stats.personal.byType['비기능'] || 0 }}</strong></span>
              </div>
            </div>
          </div>
        </v-col>
      </v-row>
    </div>

    <!-- 필터 + 액션 (한 줄) -->
    <v-row class="mb-2" dense align="center">
      <v-col cols="12" md="3">
        <v-text-field v-model="keyword" placeholder="ID, 요구사항명, 내용 검색" prepend-inner-icon="mdi-magnify" hide-details clearable class="pms-filter" @keyup.enter="applyFilter" @click:clear="keyword = ''; applyFilter()" />
      </v-col>
      <v-col cols="6" md="1">
        <v-select v-model="filterStatus" :items="statusFilterOptions" label="진행상태" hide-details class="pms-filter" @update:model-value="applyFilter" />
      </v-col>
      <v-col cols="6" md="1">
        <v-select v-model="filterReqType" :items="reqTypeFilterOptions" label="유형" hide-details class="pms-filter" @update:model-value="applyFilter" />
      </v-col>
      <v-col cols="6" md="2">
        <v-select v-model="filterBusiness" :items="businessFilterOptions" label="업무명" hide-details class="pms-filter" @update:model-value="applyFilter" />
      </v-col>
      <v-col cols="6" md="2">
        <UserTreePicker v-model="filterAssigneeUserId" :members="members" label="담당자" clearable density="compact" variant="outlined" hide-details class="pms-filter-picker" @update:model-value="onAssigneeFilterChange" />
      </v-col>
      <v-col cols="auto" class="d-flex align-center ga-1 ml-auto" v-if="isPmsAdmin">
        <v-btn color="indigo" variant="outlined" size="x-small" prepend-icon="mdi-check-all" @click="baselineAll">확정</v-btn>
        <v-btn variant="outlined" size="x-small" prepend-icon="mdi-file-upload-outline" @click="importDialog = true">엑셀 업로드</v-btn>
        <v-btn variant="outlined" size="x-small" prepend-icon="mdi-file-download-outline" @click="doExport">엑셀 다운로드</v-btn>
        <v-btn color="primary" size="x-small" prepend-icon="mdi-plus" @click="goCreate">등록</v-btn>
      </v-col>
    </v-row>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

    <!-- 테이블 -->
    <div class="pms-card" style="overflow-x:auto">
      <table class="pms-table" style="table-layout:fixed">
        <colgroup>
          <col v-for="(w, i) in colWidths" :key="i" :style="{ width: w + 'px' }" />
        </colgroup>
        <thead>
          <tr>
            <th>No<span class="col-resize" @mousedown="startResize(0, $event)"></span></th>
            <th>요구사항ID<span class="col-resize" @mousedown="startResize(1, $event)"></span></th>
            <th>요구사항명<span class="col-resize" @mousedown="startResize(2, $event)"></span></th>
            <th>요구사항 내용<span class="col-resize" @mousedown="startResize(3, $event)"></span></th>
            <th>도출유형<span class="col-resize" @mousedown="startResize(4, $event)"></span></th>
            <th>요구사항유형<span class="col-resize" @mousedown="startResize(5, $event)"></span></th>
            <th>진행상태<span class="col-resize" @mousedown="startResize(6, $event)"></span></th>
            <th>업무명<span class="col-resize" @mousedown="startResize(7, $event)"></span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!loading && !items.length" style="cursor:default">
            <td :colspan="8" class="text-center" style="padding:40px; color:var(--pms-text-disabled)">등록된 요구사항이 없습니다.</td>
          </tr>
          <tr
            v-for="(item, idx) in items" :key="item.requirementId"
            :class="{ 'row-baselined': item.isBaselined, 'row-excluded': ['대체','통합','제외'].includes(item.progressStatus) }"
            @click="goDetail(item)"
          >
            <td class="text-center">{{ (page - 1) * pageSize + idx + 1 }}</td>
            <td>
              <span class="pms-code">{{ item.reqCode }}</span>
              <v-icon v-if="item.isBaselined" size="11" color="indigo" class="ml-1" title="확정">mdi-lock</v-icon>
            </td>
            <td class="td-ellipsis">{{ item.reqName }}</td>
            <td class="td-ellipsis td-secondary">{{ item.reqDetail ? (item.reqDetail.length > 60 ? item.reqDetail.substring(0, 60) + '...' : item.reqDetail) : '' }}</td>
            <td class="text-center">{{ item.sourceType || '' }}</td>
            <td class="text-center">
              <v-chip v-if="item.reqType" :color="item.reqType === '기능' ? 'teal' : 'orange'" size="x-small" variant="tonal">{{ item.reqType }}</v-chip>
            </td>
            <td class="text-center">
              <v-chip :color="statusColors[item.progressStatus] || 'grey'" size="x-small" variant="tonal">{{ item.progressStatus }}</v-chip>
            </td>
            <td class="td-ellipsis">{{ item.business || '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 페이지네이션 -->
    <v-row v-if="totalPages > 1" class="mt-2" dense align="center" justify="center">
      <v-col cols="auto">
        <v-pagination v-model="page" :length="totalPages" :total-visible="7" density="compact" size="small" @update:model-value="goPage" />
      </v-col>
      <v-col cols="auto">
        <span style="font-size:11px; color:var(--pms-text-secondary)">총 {{ totalCount }}건</span>
      </v-col>
    </v-row>

    <!-- 임포트 결과 -->
    <v-alert v-if="importResult" :type="importResult.errors?.length ? 'warning' : 'success'" density="compact" closable class="mt-3" @click:close="importResult = null">
      <div class="font-weight-bold">임포트 완료 — {{ importResult.imported }}건 등록{{ importResult.skipped ? `, ${importResult.skipped}건 건너뜀` : '' }}</div>
      <div v-if="importResult.errors?.length" class="mt-1">
        <div v-for="(e, i) in importResult.errors.slice(0, 10)" :key="i" style="font-size:11px">{{ e }}</div>
        <div v-if="importResult.errors.length > 10" style="font-size:11px; color:#999">외 {{ importResult.errors.length - 10 }}건...</div>
      </div>
    </v-alert>

    <!-- 임포트 다이얼로그 -->
    <v-dialog v-model="importDialog" max-width="520" persistent>
      <v-card class="pms-form">
        <v-card-title class="d-flex align-center py-3" style="font-size:14px; font-weight:600">
          <v-icon size="18" class="mr-2">mdi-file-upload-outline</v-icon>요구사항 엑셀 임포트
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-4" style="font-size:var(--pms-font-body)">
          <!-- 임포트 모드 선택 -->
          <div class="mb-3">
            <div style="font-size:var(--pms-font-body); font-weight:600; margin-bottom:6px">임포트 방식</div>
            <v-radio-group v-model="importMode" inline hide-details density="compact" class="mt-0">
              <v-radio label="기존 데이터에 추가" value="append" density="compact" />
              <v-radio label="전체 초기화 후 임포트" value="clear" density="compact" color="error" />
            </v-radio-group>
            <div v-if="importMode === 'clear'" class="mt-1" style="font-size:11px; color:var(--pms-error)">
              기존 요구사항을 모두 삭제 후 임포트합니다. (확정 건 포함)
            </div>
          </div>

          <v-divider class="mb-3" />

          <!-- 템플릿 다운로드 -->
          <v-btn variant="tonal" size="small" color="primary" prepend-icon="mdi-file-download-outline" class="mb-3" @click="downloadTemplate">템플릿 다운로드</v-btn>

          <!-- 파일 선택 -->
          <div class="pms-card pa-3 mb-2">
            <input type="file" accept=".xlsx,.xls" @change="onImportFileChange" style="font-size:12px" :disabled="importLoading" />
          </div>
          <div style="font-size:11px; color:var(--pms-text-hint)">
            * 표시 항목은 필수 입력입니다. 중복된 요구사항ID는 건너뜁니다.
          </div>

          <!-- Progress -->
          <div v-if="importLoading" class="mt-3">
            <v-progress-linear :model-value="importProgress" color="primary" height="8" rounded />
            <div class="text-center mt-1" style="font-size:11px; color:var(--pms-text-secondary)">
              임포트 진행 중... {{ Math.round(importProgress) }}%
            </div>
          </div>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-4 py-2">
          <v-spacer />
          <v-btn variant="outlined" size="small" @click="importDialog = false" :disabled="importLoading">취소</v-btn>
          <v-btn color="primary" size="small" @click="doImport" :disabled="!importFile || importLoading" :loading="importLoading">임포트</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </MainLayout>
</template>

<style scoped>
.td-ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.td-secondary { color: var(--pms-text-secondary); }
.row-baselined { background: rgba(63, 81, 181, 0.03); }
.row-excluded td { color: var(--pms-text-disabled) !important; text-decoration: line-through; }
/* 통계 카드 */
.stat-card {
  border: 1px solid var(--pms-border);
  border-radius: var(--pms-radius);
  overflow: hidden;
  background: var(--pms-surface);
  height: 100%;
}
.stat-card-header {
  display: flex;
  align-items: center;
  padding: 5px 10px;
  font-size: var(--pms-font-label);
  font-weight: 600;
  background: var(--pms-surface-variant);
  border-bottom: 1px solid var(--pms-border);
  color: var(--pms-text-label);
}
.stat-card-body {
  padding: 8px 10px;
}
.stat-big-number {
  font-size: 22px;
  font-weight: 700;
  color: var(--pms-primary);
  line-height: 1;
  margin-bottom: 6px;
}
.stat-unit {
  font-size: var(--pms-font-label);
  font-weight: 400;
  color: var(--pms-text-secondary);
  margin-left: 2px;
}
.stat-bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.stat-bar-label {
  font-size: var(--pms-font-mini);
  color: var(--pms-text-secondary);
  width: 30px;
  text-align: right;
}
.stat-bar-track {
  flex: 1;
  height: 6px;
  background: var(--pms-border-light);
  border-radius: 3px;
  overflow: hidden;
}
.stat-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}
.stat-bar-value {
  font-size: var(--pms-font-mini);
  font-weight: 600;
  color: var(--pms-text-primary);
  width: 32px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.stat-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}
.stat-chip-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.stat-chip-num {
  font-size: var(--pms-font-body);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.stat-personal {
  font-size: var(--pms-font-mini);
  color: var(--pms-text-secondary);
  border-top: 1px solid var(--pms-border-light);
  padding-top: 4px;
  margin-top: 2px;
}
.stat-personal strong {
  color: var(--pms-text-primary);
}
.col-resize {
  position: absolute;
  right: 0;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
}
.col-resize:hover {
  background: rgba(25, 118, 210, 0.5);
}
</style>
