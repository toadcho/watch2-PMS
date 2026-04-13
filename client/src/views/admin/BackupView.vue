<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MainLayout from '@/components/common/MainLayout.vue'
import api from '@/services/api'
import { useDialog } from '@/composables/useDialog'

const { showAlert, showConfirm } = useDialog()

interface BackupItem {
  name: string
  size: number
  createdAt: string
  hasDb: boolean
  hasUploads: boolean
}

const backups = ref<BackupItem[]>([])
const loading = ref(false)
const exporting = ref(false)
const restoring = ref(false)
const includeUploads = ref(true)
const progressPercent = ref(0)
const progressMessage = ref('')

async function fetchList() {
  loading.value = true
  try {
    const res = await api.get('/backup/list')
    if (res.data.success) backups.value = res.data.data
  } catch (err: any) {
    showAlert(err.response?.data?.message || '목록 조회 실패', { color: 'error' })
  } finally {
    loading.value = false
  }
}

async function runBackup() {
  if (!(await showConfirm(`전체 백업을 실행합니다.${includeUploads.value ? '\n(DB + 업로드 파일 포함)' : '\n(DB만 포함)'}\n\n진행하시겠습니까?`, { title: '백업 실행' }))) return
  exporting.value = true
  progressPercent.value = 0
  progressMessage.value = '백업 준비 중...'

  try {
    const token = localStorage.getItem('token')
    const response = await fetch(`${api.defaults.baseURL}/backup/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ includeUploads: includeUploads.value }),
    })

    if (!response.body) throw new Error('SSE 스트림을 열 수 없습니다')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let completed = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE 이벤트 파싱: "event: xxx\ndata: {...}\n\n"
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''

      for (const evt of events) {
        const lines = evt.split('\n')
        const eventLine = lines.find(l => l.startsWith('event: '))
        const dataLine = lines.find(l => l.startsWith('data: '))
        if (!eventLine || !dataLine) continue
        const eventName = eventLine.substring(7).trim()
        const data = JSON.parse(dataLine.substring(6))

        if (eventName === 'progress') {
          progressPercent.value = data.percent
          progressMessage.value = data.message
        } else if (eventName === 'complete') {
          progressPercent.value = 100
          progressMessage.value = data.message
          completed = true
        } else if (eventName === 'error') {
          throw new Error(data.message)
        }
      }
    }

    if (completed) {
      await showAlert('백업이 완료되었습니다.')
      await fetchList()
    }
  } catch (err: any) {
    showAlert(err.message || '백업 실패', { color: 'error' })
  } finally {
    exporting.value = false
    progressPercent.value = 0
    progressMessage.value = ''
  }
}

function downloadBackup(item: BackupItem, type: 'db' | 'uploads') {
  const url = `${api.defaults.baseURL}/backup/${item.name}/download/${type}`
  const token = localStorage.getItem('token')
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.blob())
    .then(blob => {
      const a = document.createElement('a')
      const blobUrl = URL.createObjectURL(blob)
      a.href = blobUrl
      a.download = `${item.name}_${type === 'db' ? 'db.dump' : 'uploads.tar.gz'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    })
    .catch(() => showAlert('다운로드 실패', { color: 'error' }))
}

async function restoreBackup(item: BackupItem) {
  if (!(await showConfirm(`"${item.name}"을(를) 복원하시겠습니까?\n\n⚠ 현재 데이터가 모두 덮어씌워집니다. 이 작업은 되돌릴 수 없습니다.`, { title: '복원 확인', color: 'error' }))) return
  if (!(await showConfirm(`정말 복원하시겠습니까? 마지막 확인입니다.`, { title: '최종 확인', color: 'error' }))) return
  const restoreUploads = item.hasUploads && await showConfirm('업로드 파일도 복원하시겠습니까?\n(취소 시 DB만 복원됩니다)')
  restoring.value = true
  try {
    const res = await api.post('/backup/import', { name: item.name, restoreUploads })
    if (res.data.success) {
      await showAlert(res.data.message)
    }
  } catch (err: any) {
    showAlert(err.response?.data?.message || '복원 실패', { color: 'error' })
  } finally {
    restoring.value = false
  }
}

async function deleteBackup(item: BackupItem) {
  if (!(await showConfirm(`"${item.name}" 백업을 삭제하시겠습니까?`))) return
  try {
    await api.delete(`/backup/${item.name}`)
    await fetchList()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' })
  }
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + 'MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + 'GB'
}

function fmtDT(d: string): string {
  const dt = new Date(d)
  return dt.toLocaleString('ko-KR')
}

onMounted(fetchList)
</script>

<template>
  <MainLayout>
    <div class="d-flex align-center mb-3">
      <span class="pms-page-title">백업 관리</span>
      <v-chip size="small" variant="tonal" class="ml-2">{{ backups.length }}건</v-chip>
      <v-spacer />
    </div>

    <div class="settings-guide mb-3" style="display:flex; align-items:flex-start; gap:2px; padding:8px 12px; background:var(--pms-info-light, #E1F5FE); border-radius:var(--pms-radius); font-size:var(--pms-font-caption); color:var(--pms-text-secondary); line-height:1.6">
      <v-icon size="14" color="info" style="flex-shrink:0; margin-top:1px">mdi-information-outline</v-icon>
      <span>
        <b>수동 백업</b>을 실행하면 PostgreSQL DB와 업로드 파일(산출물, 이미지 등)이 <code>server/backups/</code> 디렉토리에 저장됩니다.
        백업 파일은 서버에 보관되므로 별도로 다운로드하여 안전한 장소에 보관하세요.
      </span>
    </div>

    <!-- 백업 실행 영역 -->
    <div class="pms-card mb-3">
      <div class="pms-section-header"><v-icon size="14">mdi-backup-restore</v-icon> 백업 실행</div>
      <div class="pa-3">
        <div class="d-flex align-center" style="gap:12px">
          <v-checkbox v-model="includeUploads" density="compact" hide-details label="업로드 파일 포함 (산출물, 이미지 등)" :disabled="exporting" />
          <v-spacer />
          <v-btn color="primary" size="small" :loading="exporting" :disabled="exporting" prepend-icon="mdi-database-export" @click="runBackup">
            전체 백업 실행
          </v-btn>
        </div>
        <div class="mt-2" style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">
          ※ 업로드 파일 포함 시 크기에 따라 수 분이 소요될 수 있습니다.
        </div>

        <!-- 진행 상황 표시 -->
        <div v-if="exporting" class="mt-3 pa-2" style="background:var(--pms-info-light,#E1F5FE); border-radius:var(--pms-radius)">
          <div class="d-flex align-center mb-1" style="gap:8px">
            <v-icon size="14" color="primary">mdi-progress-clock</v-icon>
            <span style="font-size:var(--pms-font-body); font-weight:600">{{ progressMessage }}</span>
            <v-spacer />
            <span style="font-size:var(--pms-font-label); color:var(--pms-primary); font-weight:600">{{ progressPercent }}%</span>
          </div>
          <v-progress-linear :model-value="progressPercent" color="primary" height="8" rounded />
        </div>
      </div>
    </div>

    <!-- 복원 안내 -->
    <v-alert type="warning" variant="tonal" density="compact" class="mb-3" style="font-size:var(--pms-font-caption); line-height:1.7">
      <div style="font-weight:700; margin-bottom:6px; font-size:var(--pms-font-body)">
        <v-icon size="14" class="mr-1">mdi-backup-restore</v-icon>복원 방법 안내
      </div>
      <div style="margin-bottom:4px"><b>① 백업 이력 내 복원</b>: 아래 테이블에서 복원할 백업의 <v-icon size="12" color="warning">mdi-backup-restore</v-icon> 아이콘을 클릭하여 복원합니다.</div>
      <div style="margin-bottom:4px"><b>② 외부 파일 복원</b>: 다른 환경에서 받은 백업은 서버의 <code>server/backups/</code> 디렉토리에 <b>백업 폴더 전체</b>(예: <code>pms_2026-04-12T08-30-00/</code>)를 복사하고 페이지를 새로고침하면 목록에 표시됩니다.</div>
      <div style="margin-bottom:4px"><b>③ 복원 절차</b>: 복원 버튼 클릭 → 2중 확인 → 업로드 파일 포함 여부 선택 → 복원 실행</div>
      <div style="margin-top:6px; padding-top:6px; border-top:1px solid rgba(0,0,0,0.1)">
        <b style="color:var(--pms-error)">⚠ 주의사항</b>
        <ul style="margin:2px 0 0 18px; padding:0">
          <li>복원은 <b>현재 DB를 모두 초기화</b>한 후 백업 데이터로 대체합니다. 되돌릴 수 없습니다.</li>
          <li>복원 중에는 다른 사용자 접속을 차단하는 것을 권장합니다.</li>
          <li>복원 완료 후 서버 재시작을 권장합니다. (캐시 정합성 확보)</li>
          <li>복원 전 <b>현재 상태의 백업을 먼저 생성</b>해두면 안전합니다.</li>
        </ul>
      </div>
    </v-alert>

    <!-- 백업 목록 -->
    <div class="pms-card">
      <div class="pms-section-header"><v-icon size="14">mdi-folder-multiple</v-icon> 백업 이력</div>
      <v-progress-linear v-if="loading || restoring" indeterminate color="primary" />
      <div v-if="!backups.length && !loading" class="text-center pa-6" style="color:#999; font-size:13px">
        백업 이력이 없습니다.
      </div>
      <table v-else class="pms-table" style="width:100%">
        <thead>
          <tr>
            <th>백업명</th>
            <th style="width:80px">DB</th>
            <th style="width:80px">업로드</th>
            <th style="width:100px">크기</th>
            <th style="width:160px">생성일시</th>
            <th style="width:200px">작업</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in backups" :key="b.name">
            <td><code style="font-size:11px">{{ b.name }}</code></td>
            <td class="text-center">
              <v-chip v-if="b.hasDb" size="x-small" color="success" variant="tonal">포함</v-chip>
              <v-chip v-else size="x-small" color="grey" variant="tonal">없음</v-chip>
            </td>
            <td class="text-center">
              <v-chip v-if="b.hasUploads" size="x-small" color="primary" variant="tonal">포함</v-chip>
              <v-chip v-else size="x-small" color="grey" variant="tonal">없음</v-chip>
            </td>
            <td>{{ fmtSize(b.size) }}</td>
            <td style="font-size:11px">{{ fmtDT(b.createdAt) }}</td>
            <td>
              <v-btn v-if="b.hasDb" size="x-small" variant="text" color="primary" @click="downloadBackup(b, 'db')" title="DB 다운로드"><v-icon size="14">mdi-database-arrow-down</v-icon></v-btn>
              <v-btn v-if="b.hasUploads" size="x-small" variant="text" color="primary" @click="downloadBackup(b, 'uploads')" title="업로드 다운로드"><v-icon size="14">mdi-folder-arrow-down</v-icon></v-btn>
              <v-btn size="x-small" variant="text" color="warning" @click="restoreBackup(b)" title="복원"><v-icon size="14">mdi-backup-restore</v-icon></v-btn>
              <v-btn size="x-small" variant="text" color="error" @click="deleteBackup(b)" title="삭제"><v-icon size="14">mdi-delete</v-icon></v-btn>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </MainLayout>
</template>
