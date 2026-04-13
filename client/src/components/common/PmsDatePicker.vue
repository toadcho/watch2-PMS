<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { isNonWorkingDay, isHoliday, getHolidayName } from '@/utils/holidays'

const props = withDefaults(defineProps<{
  modelValue: string
  label?: string
  disabled?: boolean
  required?: boolean
  allowNonWorking?: boolean
  hideDetails?: boolean
}>(), {
  label: '',
  disabled: false,
  required: false,
  allowNonWorking: false,
  hideDetails: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const dialog = ref(false)
const pickerRef = ref<HTMLElement | null>(null)
const pickerYear = ref(new Date().getFullYear())
const pickerMonth = ref(new Date().getMonth() + 1) // 1-based
let observer: MutationObserver | null = null

function fmtLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function onInput(val: string) {
  if (!val) { emit('update:modelValue', ''); return }
  if (!props.allowNonWorking && isNonWorkingDay(val)) return
  emit('update:modelValue', val)
}

defineExpose({ openPicker })

function openPicker() {
  if (props.disabled) return
  // 현재 값 기준 년/월 초기화
  if (props.modelValue) {
    const d = new Date(props.modelValue + 'T00:00:00')
    pickerYear.value = d.getFullYear()
    pickerMonth.value = d.getMonth() + 1
  } else {
    pickerYear.value = new Date().getFullYear()
    pickerMonth.value = new Date().getMonth() + 1
  }
  dialog.value = true
  nextTick(() => {
    startObserver()
    setTimeout(colorize, 120)
  })
}

function onPickerSelect(val: any) {
  if (!val) return
  const dateStr = val instanceof Date ? fmtLocal(val) : String(val).substring(0, 10)
  // 공휴일 차단
  if (!props.allowNonWorking && isNonWorkingDay(dateStr)) return
  emit('update:modelValue', dateStr)
  dialog.value = false
}

function allowedDates(val: unknown): boolean {
  if (props.allowNonWorking) return true
  let dateStr: string
  if (val instanceof Date) { dateStr = fmtLocal(val) } else { dateStr = String(val) }
  return !isNonWorkingDay(dateStr)
}

const pickerModel = computed(() => {
  return props.modelValue ? new Date(props.modelValue + 'T00:00:00') : undefined
})

const displayLabel = computed(() => {
  if (!props.modelValue) return ''
  const d = new Date(props.modelValue + 'T00:00:00')
  const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  const hName = getHolidayName(props.modelValue)
  return hName ? `${props.modelValue} (${dow}) ${hName}` : `${props.modelValue} (${dow})`
})

/** 달력의 모든 날짜 셀에 색상 적용 */
function colorize() {
  const el = pickerRef.value
  if (!el) return

  const y = pickerYear.value
  const m = pickerMonth.value - 1 // 0-based
  const firstDow = new Date(y, m, 1).getDay() // 이번달 1일의 요일 (0=일)

  // .v-date-picker-month__days 내의 날짜 셀 (weekday 헤더 제외)
  const allDays = el.querySelectorAll('.v-date-picker-month__day:not(.v-date-picker-month__weekday)')

  allDays.forEach((cell: Element) => {
    const btn = cell.querySelector('.v-btn')
    if (!btn) return
    const contentEl = btn.querySelector('.v-btn__content')
    if (!contentEl) return
    const dayText = contentEl.textContent?.trim()
    if (!dayText) return
    const dayNum = parseInt(dayText)
    if (isNaN(dayNum)) return

    const btnEl = btn as HTMLElement

    // data-v-date 가 있으면 직접 사용
    const isoDate = cell.getAttribute('data-v-date')
    if (isoDate) {
      const dateStr = isoDate.substring(0, 10)
      const d = new Date(dateStr + 'T00:00:00')
      const dow = d.getDay()
      if (isHoliday(dateStr) || dow === 0) {
        btnEl.style.color = '#E53935'
        btnEl.style.fontWeight = isHoliday(dateStr) ? '700' : ''
      } else if (dow === 6) {
        btnEl.style.color = '#1565C0'
      }
      return
    }

    // disabled 셀 — data-v-date 없음 → 위치 기반 추정
    // adjacent(이전/다음달) 여부 확인
    const isAdj = cell.classList.contains('v-date-picker-month__day--adjacent')

    let dateStr: string
    if (!isAdj) {
      // 이번달 날짜
      dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
    } else {
      // 인접 월 날짜 — dayNum이 20 이상이면 이전달, 아니면 다음달
      if (dayNum > 15) {
        // 이전달
        const pm = m === 0 ? 11 : m - 1
        const py = m === 0 ? y - 1 : y
        dateStr = `${py}-${String(pm + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
      } else {
        // 다음달
        const nm = m === 11 ? 0 : m + 1
        const ny = m === 11 ? y + 1 : y
        dateStr = `${ny}-${String(nm + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
      }
    }

    const d = new Date(dateStr + 'T00:00:00')
    const dow = d.getDay()
    if (isHoliday(dateStr) || dow === 0) {
      btnEl.style.color = '#E53935'
      if (isHoliday(dateStr)) btnEl.style.fontWeight = '700'
    } else if (dow === 6) {
      btnEl.style.color = '#1565C0'
    }
  })
}

function onMonthChange(val: any) {
  if (typeof val === 'number') pickerMonth.value = val + 1 // Vuetify passes 0-based
  nextTick(() => setTimeout(colorize, 80))
}

function onYearChange(val: any) {
  if (typeof val === 'number') pickerYear.value = val
  nextTick(() => setTimeout(colorize, 80))
}

/** MutationObserver로 달력 DOM 변경 감지 → 자동 색상 재적용 */
function startObserver() {
  stopObserver()
  const el = pickerRef.value
  if (!el) return
  observer = new MutationObserver(() => {
    setTimeout(colorize, 50)
  })
  observer.observe(el, { childList: true, subtree: true })
}

function stopObserver() {
  if (observer) { observer.disconnect(); observer = null }
}

watch(dialog, (v) => { if (!v) stopObserver() })
onBeforeUnmount(stopObserver)
</script>

<template>
  <v-text-field
    :model-value="modelValue"
    @update:model-value="onInput"
    :label="label"
    type="date"
    variant="outlined"
    density="compact"
    :hide-details="hideDetails"
    :disabled="disabled"
    class="pms-form"
    append-inner-icon="mdi-calendar"
    @click:append-inner="openPicker"
  >
    <template v-if="required" #label>{{ label }}<span class="pms-required">*</span></template>
  </v-text-field>

  <v-dialog v-model="dialog" max-width="320">
    <v-card class="pms-datepicker-card">
      <div class="pms-dp-header">
        <div class="pms-dp-header-label">{{ label || '날짜 선택' }}</div>
        <div v-if="modelValue" class="pms-dp-header-date">{{ displayLabel }}</div>
        <div v-else class="pms-dp-header-date" style="opacity:0.5">선택하세요</div>
      </div>
      <div ref="pickerRef">
        <v-date-picker
          :model-value="pickerModel"
          @update:model-value="onPickerSelect"
          @update:month="onMonthChange"
          @update:year="onYearChange"
          :allowed-dates="allowedDates"
          show-adjacent-months
          color="primary"
          hide-header
          class="pms-dp-picker"
        />
      </div>
      <div class="pms-dp-legend">
        <span class="dp-legend-item"><span class="dp-dot" style="background:#E53935" />일요일·공휴일</span>
        <span class="dp-legend-item"><span class="dp-dot" style="background:#1565C0" />토요일</span>
      </div>
      <v-card-actions class="pa-2 pt-0">
        <v-spacer />
        <v-btn size="small" variant="text" @click="dialog = false">닫기</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.pms-datepicker-card { overflow: hidden; }
.pms-dp-header {
  padding: 12px 16px 8px;
  background: rgb(var(--v-theme-primary));
  color: #fff;
}
.pms-dp-header-label { font-size: 11px; opacity: 0.85; margin-bottom: 2px; }
.pms-dp-header-date { font-size: 15px; font-weight: 600; }
.pms-dp-picker { border-radius: 0 !important; box-shadow: none !important; }
.pms-dp-legend {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding: 4px 8px 2px;
  font-size: 10px;
  color: #666;
}
.dp-legend-item { display: flex; align-items: center; gap: 3px; }
.dp-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
</style>

<style>
/* 요일 헤더 */
.pms-dp-picker .v-date-picker-month__weekday:nth-child(1) { color: #E53935 !important; font-weight: 700; }
.pms-dp-picker .v-date-picker-month__weekday:nth-child(7) { color: #1565C0 !important; font-weight: 700; }

/* CSS 기반 토/일 (week-start=일요일, week-end=토요일) */
.pms-dp-picker .v-date-picker-month__day--week-start .v-btn { color: #E53935 !important; }
.pms-dp-picker .v-date-picker-month__day--week-start .v-btn .v-btn__content { color: #E53935 !important; }
.pms-dp-picker .v-date-picker-month__day--week-end .v-btn { color: #1565C0 !important; }
.pms-dp-picker .v-date-picker-month__day--week-end .v-btn .v-btn__content { color: #1565C0 !important; }
</style>
