<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { approvalService } from '@/services/approval'
import { useDialog } from '@/composables/useDialog'

interface PendingItem {
  approvalId: number
  docId: number
  docName: string
  docType?: string
  taskId?: number
  taskName?: string
  wbsCode?: string
  approverRole?: string
  uploaderName?: string
}

const props = defineProps<{
  modelValue: boolean
  projectId: number
  items: PendingItem[]
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  'approved': []
}>()

const { showAlert } = useDialog()

const selected = ref<Set<number>>(new Set())
const previewOpen = ref(false)
const submitting = ref(false)

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

watch(() => props.modelValue, (v) => {
  if (v) selected.value = new Set()
})

const allSelected = computed(() =>
  props.items.length > 0 && props.items.every(i => selected.value.has(i.docId))
)
const someSelected = computed(() =>
  props.items.some(i => selected.value.has(i.docId)) && !allSelected.value
)

function toggleAll() {
  if (allSelected.value) {
    selected.value = new Set()
  } else {
    selected.value = new Set(props.items.map(i => i.docId))
  }
}
function toggle(docId: number) {
  const next = new Set(selected.value)
  if (next.has(docId)) next.delete(docId)
  else next.add(docId)
  selected.value = next
}

const selectedItems = computed(() =>
  props.items.filter(i => selected.value.has(i.docId))
)

function openPreview() {
  if (!selectedItems.value.length) return
  previewOpen.value = true
}

async function confirmBulkApprove() {
  submitting.value = true
  try {
    const docIds = selectedItems.value.map(i => i.docId)
    const res = await approvalService.approveBulk(props.projectId, docIds)
    previewOpen.value = false
    visible.value = false
    window.dispatchEvent(new CustomEvent('pms:notif-refresh'))
    await showAlert(res.message || '일괄승인이 완료되었습니다.')
    emit('approved')
  } catch (err: any) {
    console.error('[BulkApproval] error:', err)
    const status = err?.response?.status
    const serverMsg = err?.response?.data?.message
    const detail = serverMsg
      ? serverMsg
      : status
        ? `일괄승인 실패 (HTTP ${status})`
        : `일괄승인 실패: ${err?.message || '알 수 없는 오류'}`
    await showAlert(detail, { color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <!-- 일괄승인 목록 선택 다이얼로그 -->
  <v-dialog v-model="visible" max-width="720" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center" style="font-size:14px; font-weight:700">
        <v-icon size="18" color="orange" class="mr-2">mdi-clipboard-check-multiple</v-icon>
        승인 대기 일괄처리
        <v-chip size="x-small" variant="tonal" color="orange" class="ml-2">{{ items.length }}건</v-chip>
        <v-spacer />
        <v-btn icon size="small" variant="text" @click="visible = false"><v-icon size="18">mdi-close</v-icon></v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-0" style="max-height:60vh">
        <v-list v-if="items.length" density="compact" class="pa-0">
          <v-list-item class="bulk-hd">
            <template #prepend>
              <v-checkbox-btn
                :model-value="allSelected"
                :indeterminate="someSelected"
                density="compact"
                hide-details
                @update:model-value="toggleAll"
              />
            </template>
            <v-list-item-title style="font-size:11px; font-weight:700">
              전체 선택 ({{ selected.size }}/{{ items.length }})
            </v-list-item-title>
          </v-list-item>
          <v-divider />
          <v-list-item
            v-for="a in items"
            :key="a.docId"
            class="bulk-row"
            @click="toggle(a.docId)"
          >
            <template #prepend>
              <v-checkbox-btn
                :model-value="selected.has(a.docId)"
                density="compact"
                hide-details
                @click.stop="toggle(a.docId)"
              />
            </template>
            <div style="flex:1; min-width:0">
              <div class="d-flex align-center">
                <span style="font-size:12px; font-weight:600">{{ a.docName }}</span>
                <v-chip v-if="a.docType" size="x-small" variant="outlined" class="ml-1">{{ a.docType }}</v-chip>
                <v-chip v-if="a.approverRole" size="x-small" variant="tonal" color="orange" class="ml-1">{{ a.approverRole }}</v-chip>
              </div>
              <div style="font-size:10px; color:#757575">
                <span v-if="a.wbsCode">[{{ a.wbsCode }}] </span>{{ a.taskName }}
                <span v-if="a.uploaderName"> · 요청자 {{ a.uploaderName }}</span>
              </div>
            </div>
          </v-list-item>
        </v-list>
        <div v-else class="text-center pa-8" style="color:#888">승인 대기 건이 없습니다.</div>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-2">
        <span style="font-size:11px; color:#666">{{ selected.size }}건 선택됨</span>
        <v-spacer />
        <v-btn size="small" variant="text" @click="visible = false">닫기</v-btn>
        <v-btn
          size="small"
          color="success"
          variant="flat"
          :disabled="!selected.size"
          prepend-icon="mdi-check-all"
          @click="openPreview"
        >
          선택 승인 ({{ selected.size }})
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- 미리보기/확정 다이얼로그 -->
  <v-dialog v-model="previewOpen" max-width="560" scrollable>
    <v-card>
      <v-card-title style="font-size:14px; font-weight:700">
        <v-icon size="18" color="success" class="mr-2">mdi-check-decagram</v-icon>
        일괄승인 확인
      </v-card-title>
      <v-divider />
      <v-card-text style="max-height:50vh; font-size:12px">
        <div class="mb-2" style="font-weight:600">다음 {{ selectedItems.length }}건을 일괄 승인하시겠습니까?</div>
        <v-list density="compact" class="pa-0">
          <v-list-item v-for="a in selectedItems" :key="a.docId" class="preview-row">
            <div style="flex:1; min-width:0">
              <div style="font-size:12px; font-weight:500">{{ a.docName }}</div>
              <div style="font-size:10px; color:#757575">
                <span v-if="a.wbsCode">[{{ a.wbsCode }}] </span>{{ a.taskName }}
              </div>
            </div>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-2">
        <v-spacer />
        <v-btn size="small" variant="text" :disabled="submitting" @click="previewOpen = false">취소</v-btn>
        <v-btn size="small" color="success" variant="flat" :loading="submitting" @click="confirmBulkApprove">
          일괄 승인
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.bulk-hd {
  background: #fafafa;
  min-height: 34px;
}
.bulk-row {
  cursor: pointer;
  min-height: 44px;
  border-bottom: 1px solid #f0f0f0;
}
.bulk-row:hover {
  background: #fff8e1;
}
.preview-row {
  min-height: 36px;
  border-bottom: 1px solid #f5f5f5;
}
</style>
