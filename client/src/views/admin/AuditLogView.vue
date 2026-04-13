<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MainLayout from '@/components/common/MainLayout.vue'
import { auditLogService } from '@/services/auditLogs'

const logs = ref<any[]>([])
const loading = ref(false)
const totalCount = ref(0)
const page = ref(1)

const filters = ref({ userId: '', action: '', startDate: '', endDate: '' })

const headers = [
  { title: '일시', key: 'createdAt', width: '160px' },
  { title: '사용자', key: 'userId', width: '100px' },
  { title: 'IP', key: 'ipAddress', width: '120px' },
  { title: '액션', key: 'action', width: '100px' },
  { title: '대상', key: 'targetType', width: '120px' },
  { title: '대상ID', key: 'targetId', width: '80px' },
  { title: '상세', key: 'changeDetail' },
]

const actionOptions = [
  { title: '전체', value: '' },
  { title: '생성', value: 'CREATE' },
  { title: '수정', value: 'UPDATE' },
  { title: '삭제', value: 'DELETE' },
  { title: '로그인', value: 'LOGIN' },
  { title: '로그아웃', value: 'LOGOUT' },
]

const ACTION_LABELS: Record<string, string> = {
  CREATE: '생성', UPDATE: '수정', DELETE: '삭제', LOGIN: '로그인', LOGOUT: '로그아웃',
}

const TARGET_LABELS: Record<string, string> = {
  project: '프로젝트', wbs_task: 'WBS 태스크', deliverable: '산출물', deliverable_approval: '산출물 승인',
  defect: '결함', issue: '이슈', risk: '리스크', meeting: '회의록', notice: '공지사항',
  user: '사용자', report: '보고서', budget_item: '예산', milestone: '마일스톤',
  library_file: '자료실', member: '투입인력', requirement: '요구사항', calendar_event: '캘린더',
}

const DETAIL_KEYS: Record<string, string> = {
  businessNo: '사업관리번호', projectName: '프로젝트명', fields: '변경항목',
  action: '처리', depth: '승인단계', role: '역할', approverId: '승인자',
  taskId: '태스크ID', label: '라벨', comment: '의견',
}

// 사용자 이름 캐시
const userNameCache = ref<Record<string, string>>({})

async function fetchLogs() {
  loading.value = true
  try {
    const params: any = { page: page.value, size: 20 }
    if (filters.value.userId) params.userId = filters.value.userId
    if (filters.value.action) params.action = filters.value.action
    if (filters.value.startDate) params.startDate = filters.value.startDate
    if (filters.value.endDate) params.endDate = filters.value.endDate

    const result = await auditLogService.getList(params)
    if (result.success) {
      logs.value = result.data
      totalCount.value = result.pagination.totalCount
      // 사용자 이름 표시를 위해 userName 매핑 (서버에서 제공 시)
      for (const log of result.data) {
        if (log.userName) userNameCache.value[log.userId] = log.userName
      }
    }
  } catch (err) {
    console.error('Failed to fetch audit logs:', err)
  } finally {
    loading.value = false
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('ko-KR')
}

function formatUser(userId: string) {
  const name = userNameCache.value[userId]
  return name ? `${name} (${userId})` : userId
}

function formatAction(action: string) {
  return ACTION_LABELS[action] || action
}

function formatTarget(targetType: string) {
  return TARGET_LABELS[targetType] || targetType
}

function formatDetail(detail: any) {
  if (!detail) return '-'
  if (typeof detail === 'string') return detail
  const parts: string[] = []
  for (const [key, val] of Object.entries(detail)) {
    if (val === undefined || val === null) continue
    const label = DETAIL_KEYS[key] || key
    let value = val
    if (Array.isArray(val)) value = (val as any[]).join(', ')
    else if (typeof val === 'object') value = JSON.stringify(val)
    parts.push(`${label}: ${value}`)
  }
  return parts.join(' · ') || '-'
}

function getActionColor(action: string) {
  const colors: Record<string, string> = { CREATE: 'success', UPDATE: 'info', DELETE: 'error', LOGIN: 'primary', LOGOUT: 'grey' }
  return colors[action] || 'grey'
}

onMounted(fetchLogs)
</script>

<template>
  <MainLayout>
    <div class="pms-page-title mb-3">감사 로그</div>

    <v-row dense class="mb-2" align="center">
      <v-col cols="6" md="2">
        <v-text-field v-model="filters.userId" label="사용자" variant="outlined" density="compact" hide-details clearable class="pms-filter" />
      </v-col>
      <v-col cols="6" md="2">
        <v-select v-model="filters.action" :items="actionOptions" label="액션" variant="outlined" density="compact" hide-details class="pms-filter" />
      </v-col>
      <v-col cols="6" md="2">
        <v-text-field v-model="filters.startDate" label="시작일" type="date" variant="outlined" density="compact" hide-details class="pms-filter" />
      </v-col>
      <v-col cols="6" md="2">
        <v-text-field v-model="filters.endDate" label="종료일" type="date" variant="outlined" density="compact" hide-details class="pms-filter" />
      </v-col>
      <v-col cols="auto">
        <v-btn color="primary" size="small" @click="fetchLogs">검색</v-btn>
      </v-col>
    </v-row>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-1" />

    <div class="pms-card">
      <div style="overflow-x:auto">
        <table class="pms-table" style="width:100%">
          <thead>
            <tr>
              <th style="width:140px">일시</th>
              <th style="width:120px">사용자</th>
              <th style="width:110px">IP</th>
              <th style="width:80px">액션</th>
              <th style="width:100px">대상</th>
              <th style="width:60px">ID</th>
              <th>상세 내용</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!logs.length">
              <td colspan="7" class="text-center" style="padding:24px; color:var(--pms-text-hint)">로그가 없습니다.</td>
            </tr>
            <tr v-for="log in logs" :key="log.logId">
              <td style="font-size:var(--pms-font-caption); white-space:nowrap">{{ formatDate(log.createdAt) }}</td>
              <td style="font-size:var(--pms-font-body)">{{ formatUser(log.userId) }}</td>
              <td style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">{{ log.ipAddress || '-' }}</td>
              <td><v-chip :color="getActionColor(log.action)" size="x-small" variant="tonal">{{ formatAction(log.action) }}</v-chip></td>
              <td style="font-size:var(--pms-font-body)">{{ formatTarget(log.targetType) }}</td>
              <td class="text-center" style="font-size:var(--pms-font-caption)">{{ log.targetId || '-' }}</td>
              <td style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary); max-width:400px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" :title="formatDetail(log.changeDetail)">
                {{ formatDetail(log.changeDetail) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="d-flex align-center justify-center pa-2" style="gap:8px">
        <v-btn size="x-small" variant="outlined" :disabled="page <= 1" @click="page--; fetchLogs()">이전</v-btn>
        <span style="font-size:var(--pms-font-caption)">{{ page }} / {{ Math.ceil(totalCount / 20) || 1 }} (총 {{ totalCount }}건)</span>
        <v-btn size="x-small" variant="outlined" :disabled="page >= Math.ceil(totalCount / 20)" @click="page++; fetchLogs()">다음</v-btn>
      </div>
    </div>
  </MainLayout>
</template>
