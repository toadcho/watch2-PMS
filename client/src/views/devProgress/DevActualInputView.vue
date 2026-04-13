<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import { devProgramService } from '@/services/devPrograms'
import { projectService } from '@/services/projects'
import { useDialog } from '@/composables/useDialog'

const { showAlert, showConfirm } = useDialog()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)

const project = ref<any>(null)
const myRole = ref<any>(null)
const isPmsAdmin = computed(() => myRole.value?.isPmsAdmin || false)

const loading = ref(false)
const saving = ref(false)
const weeks = ref<any[]>([])
const currentWeek = ref(1)
const selectedWeek = ref(1)
const items = ref<any[]>([])

// 필터
const filterTask = ref('')
const filterDev = ref('')

// 주차 선택 옵션
const weekOptions = computed(() => weeks.value.map(w => ({
  title: `${w.weekNo}주차 (${w.startDt.substring(5)}~${w.endDt.substring(5)})`,
  value: w.weekNo,
})))

const selectedWeekInfo = computed(() => weeks.value.find(w => w.weekNo === selectedWeek.value))

// 업무/담당자 옵션
const taskOptions = computed(() => {
  const set = new Set<string>()
  items.value.forEach(i => { if (i.taskCode) set.add(i.taskCode) })
  return [{ title: '전체', value: '' }, ...Array.from(set).sort().map(t => ({ title: t, value: t }))]
})
const devOptions = computed(() => {
  const map = new Map<string, string>()
  items.value.forEach(i => { if (i.devUserName) map.set(i.devUserId || i.devUserName, i.devUserName) })
  return [{ title: '전체', value: '' }, ...Array.from(map.entries()).map(([v, t]) => ({ title: t, value: v }))]
})

const filteredItems = computed(() => {
  let result = items.value
  if (filterTask.value) result = result.filter(i => i.taskCode === filterTask.value)
  if (filterDev.value) result = result.filter(i => i.devUserId === filterDev.value)
  return result
})

async function fetchWeeks() {
  try {
    const res = await devProgramService.getWeeks(projectId)
    if (res.success) {
      weeks.value = res.data.weeks
      currentWeek.value = res.data.currentWeek
      selectedWeek.value = res.data.currentWeek
    }
  } catch (err) { console.error(err) }
}

async function fetchActuals() {
  loading.value = true
  try {
    const yw = selectedWeekInfo.value?.yearWeek || ''
    const res = await devProgramService.getWeeklyActuals(projectId, { weekNo: selectedWeek.value })
    if (res.success) items.value = res.data
  } catch (err) { console.error(err) }
  finally { loading.value = false }
}

watch(selectedWeek, fetchActuals)

async function saveAll() {
  if (!(await showConfirm('주간 실적을 저장하시겠습니까?'))) return

  // Gap < 0 인데 사유 미입력 체크
  const noReason = filteredItems.value.filter(i => {
    const cum = Math.min(100, i.prevCumRate + (i.actualRate || 0))
    const gap = cum - i.planCumRate
    return gap < 0 && !i.delayReason && i.actualRate > 0
  })
  if (noReason.length) {
    await showAlert(`지연 프로그램 ${noReason.length}건의 지연사유를 입력하세요.`, { color: 'error' })
    return
  }

  saving.value = true
  try {
    const actuals = filteredItems.value
      .filter(i => i.actualRate > 0 || i.delayReason || i.effortMd > 0)
      .map(i => ({
        pgmId: i.pgmId,
        actualRate: i.actualRate || 0,
        delayReason: i.delayReason || '',
        tcExecCount: i.tcExecCount || 0,
        tcPassCount: i.tcPassCount || 0,
        tcFailCount: i.tcFailCount || 0,
        defectCount: i.defectCount || 0,
        effortMd: i.effortMd || 0,
      }))

    const yw = selectedWeekInfo.value?.yearWeek || ''
    const res = await devProgramService.saveWeeklyActuals(projectId, {
      weekNo: selectedWeek.value,
      yearWeek: yw,
      actuals,
    })
    if (res.success) {
      await showAlert(res.message || '저장되었습니다.')
      await fetchActuals()
    }
  } catch (err: any) { showAlert(err?.response?.data?.message || '저장 실패', { color: 'error' }) }
  finally { saving.value = false }
}

function getGapColor(item: any): string {
  const cum = Math.min(100, item.prevCumRate + (item.actualRate || 0))
  const gap = cum - item.planCumRate
  if (gap > 0) return 'color: #1565C0'
  if (gap < 0) return 'color: #E53935; font-weight:700'
  return ''
}

function calcGap(item: any): number {
  const cum = Math.min(100, item.prevCumRate + (item.actualRate || 0))
  return Math.round((cum - item.planCumRate) * 100) / 100
}

function calcCum(item: any): number {
  return Math.min(100, Math.round((item.prevCumRate + (item.actualRate || 0)) * 100) / 100)
}

onMounted(async () => {
  try {
    const [p, r] = await Promise.all([
      projectService.getDetail(projectId),
      projectService.getMyRole(projectId).catch(() => null),
    ])
    if (p.success) project.value = p.data
    if (r?.success) myRole.value = r.data
  } catch {}
  await fetchWeeks()
  await fetchActuals()
})
</script>

<template>
  <MainLayout>
    <v-row class="mb-1" align="center" dense>
      <v-col cols="auto"><v-btn icon size="small" variant="text" @click="router.push(`/projects/${projectId}/dev-progress`)"><v-icon>mdi-arrow-left</v-icon></v-btn></v-col>
      <v-col>
        <span class="pms-page-title">주간 실적 입력</span>
        <span class="pms-page-subtitle">{{ project?.projectName }}</span>
      </v-col>
    </v-row>

    <!-- 주차 선택 + 필터 -->
    <v-row dense class="mb-2" align="center">
      <v-col cols="6" md="3">
        <v-select v-model="selectedWeek" :items="weekOptions" label="보고 주차" hide-details class="pms-filter" />
      </v-col>
      <v-col cols="6" md="2">
        <v-select v-model="filterTask" :items="taskOptions" label="업무" hide-details class="pms-filter" />
      </v-col>
      <v-col cols="6" md="2">
        <v-select v-model="filterDev" :items="devOptions" label="담당자" hide-details class="pms-filter" />
      </v-col>
      <v-col cols="auto" class="ml-auto">
        <v-btn color="primary" size="small" prepend-icon="mdi-content-save" :loading="saving" @click="saveAll">일괄 저장</v-btn>
      </v-col>
    </v-row>

    <div v-if="selectedWeekInfo" class="mb-2" style="font-size:var(--pms-font-caption); color:var(--pms-text-secondary)">
      {{ selectedWeekInfo.yearWeek }} ({{ selectedWeekInfo.startDt }} ~ {{ selectedWeekInfo.endDt }})
      <v-chip v-if="selectedWeek === currentWeek" size="x-small" color="primary" variant="tonal" class="ml-1">현재 주차</v-chip>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-1" />

    <!-- 실적 입력 테이블 -->
    <div class="pms-card" style="overflow-x:auto">
      <table class="pms-table" style="width:100%; min-width:1400px">
        <thead>
          <tr>
            <th style="width:40px">No</th>
            <th style="width:100px">프로그램ID</th>
            <th style="min-width:140px">프로그램명</th>
            <th style="width:70px">업무</th>
            <th style="width:40px">유형</th>
            <th style="width:60px">담당자</th>
            <th style="width:65px">누적계획%</th>
            <th style="width:75px" class="bg-amber-lighten-5">금주실적%</th>
            <th style="width:65px">누적실적%</th>
            <th style="width:55px">Gap%</th>
            <th style="width:150px" class="bg-amber-lighten-5">지연사유</th>
            <th style="width:55px" class="bg-amber-lighten-5">공수(MD)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!filteredItems.length">
            <td colspan="12" class="text-center" style="padding:24px; color:var(--pms-text-hint)">데이터가 없습니다. 프로그램을 등록하고 계획을 생성하세요.</td>
          </tr>
          <tr v-for="(item, idx) in filteredItems" :key="item.pgmId">
            <td class="text-center">{{ idx + 1 }}</td>
            <td>{{ item.pgmCode }}</td>
            <td>{{ item.pgmName }}</td>
            <td>{{ item.taskCode }}</td>
            <td class="text-center">{{ item.pgmType }}</td>
            <td>{{ item.devUserName || '' }}</td>
            <td class="text-center">{{ item.planCumRate }}</td>
            <td class="text-center bg-amber-lighten-5">
              <input v-model.number="item.actualRate" type="number" min="0" max="100" step="0.1" class="actual-input" />
            </td>
            <td class="text-center" style="font-weight:600">{{ calcCum(item) }}</td>
            <td class="text-center" :style="getGapColor(item)">{{ calcGap(item) }}</td>
            <td class="bg-amber-lighten-5">
              <input v-model="item.delayReason" type="text" class="actual-input-text" :class="{ 'delay-required': calcGap(item) < 0 }" :placeholder="calcGap(item) < 0 ? '필수 입력' : ''" />
            </td>
            <td class="text-center bg-amber-lighten-5">
              <input v-model.number="item.effortMd" type="number" min="0" step="0.1" class="actual-input" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </MainLayout>
</template>

<style scoped>
.actual-input {
  width: 60px; text-align: center; border: 1px solid var(--pms-border, #ddd);
  border-radius: 3px; padding: 3px 4px; font-size: var(--pms-font-body, 11px);
}
.actual-input:focus { border-color: var(--pms-primary); outline: none; }
.actual-input-text {
  width: 100%; border: 1px solid var(--pms-border, #ddd);
  border-radius: 3px; padding: 3px 6px; font-size: var(--pms-font-body, 11px);
}
.actual-input-text:focus { border-color: var(--pms-primary); outline: none; }
.delay-required { border-color: #E53935 !important; background: #FFF3F0; }
</style>
