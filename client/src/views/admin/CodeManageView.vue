<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import MainLayout from '@/components/common/MainLayout.vue'
import { codeService } from '@/services/codes'
import { useDialog } from '@/composables/useDialog'
import type { CommonCode } from '@/types'

const { showAlert } = useDialog()

const groups = ref<string[]>([])
const selectedGroup = ref('')
const codes = ref<CommonCode[]>([])
const loading = ref(false)

// 다이얼로그
const dialog = ref(false)
const editMode = ref(false)
const formData = ref({ codeGroup: '', code: '', codeName: '', sortOrder: 0, description: '' })

const headers = [
  { title: '코드그룹', key: 'codeGroup', width: '160px' },
  { title: '코드', key: 'code', width: '140px' },
  { title: '코드명', key: 'codeName' },
  { title: '정렬순서', key: 'sortOrder', width: '100px' },
  { title: '설명', key: 'description' },
  { title: '상태', key: 'isActive', width: '80px' },
  { title: '관리', key: 'actions', width: '80px', sortable: false },
]

async function fetchGroups() {
  try {
    const result = await codeService.getGroups()
    if (result.success) groups.value = result.data
  } catch (err) {
    console.error('Failed to fetch groups:', err)
  }
}

async function fetchCodes() {
  loading.value = true
  try {
    const result = await codeService.getAll(selectedGroup.value || undefined)
    if (result.success) {
      if (selectedGroup.value) {
        codes.value = Array.isArray(result.data) ? result.data : []
      } else {
        // 전체 그룹핑된 데이터 → 플랫 배열로
        const flat: CommonCode[] = []
        for (const group of Object.values(result.data) as CommonCode[][]) {
          flat.push(...group)
        }
        codes.value = flat
      }
    }
  } catch (err) {
    console.error('Failed to fetch codes:', err)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editMode.value = false
  formData.value = { codeGroup: selectedGroup.value, code: '', codeName: '', sortOrder: 0, description: '' }
  dialog.value = true
}

function openEdit(item: CommonCode) {
  editMode.value = true
  formData.value = { ...item, description: item.description || '' }
  dialog.value = true
}

async function saveCode() {
  try {
    if (editMode.value) {
      await codeService.update(formData.value.codeGroup, formData.value.code, {
        codeName: formData.value.codeName,
        sortOrder: formData.value.sortOrder,
        description: formData.value.description,
      })
    } else {
      await codeService.create(formData.value)
    }
    dialog.value = false
    fetchCodes()
    fetchGroups()
  } catch (err: any) {
    showAlert(err.response?.data?.message || '저장 중 오류가 발생했습니다.', { color: 'error' })
  }
}

watch(selectedGroup, fetchCodes)
onMounted(() => { fetchGroups(); fetchCodes() })
</script>

<template>
  <MainLayout>
    <v-row class="mb-4" align="center">
      <v-col>
        <h2 class="text-h5 font-weight-bold">공통코드 관리</h2>
      </v-col>
      <v-col cols="auto">
        <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">코드 등록</v-btn>
      </v-col>
    </v-row>

    <v-row class="mb-2">
      <v-col cols="12" md="3">
        <v-select
          v-model="selectedGroup"
          :items="[{ title: '전체', value: '' }, ...groups.map(g => ({ title: g, value: g }))]"
          label="코드그룹 필터"
          variant="outlined"
          density="compact"
          hide-details
        />
      </v-col>
    </v-row>

    <v-data-table
      :items="codes"
      :headers="headers"
      :loading="loading"
      :items-per-page="50"
      density="comfortable"
      class="elevation-1"
    >
      <template #item.isActive="{ item }">
        <v-chip :color="item.isActive ? 'success' : 'grey'" size="small" variant="tonal">
          {{ item.isActive ? '활성' : '비활성' }}
        </v-chip>
      </template>
      <template #item.actions="{ item }">
        <v-btn icon size="x-small" variant="text" @click="openEdit(item)">
          <v-icon size="small">mdi-pencil</v-icon>
        </v-btn>
      </template>
    </v-data-table>

    <!-- 등록/수정 다이얼로그 -->
    <v-dialog v-model="dialog" max-width="450">
      <v-card>
        <v-card-title>{{ editMode ? '코드 수정' : '코드 등록' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="formData.codeGroup" label="코드그룹 *" :disabled="editMode" variant="outlined" density="compact" class="mb-2" />
          <v-text-field v-model="formData.code" label="코드 *" :disabled="editMode" variant="outlined" density="compact" class="mb-2" />
          <v-text-field v-model="formData.codeName" label="코드명 *" variant="outlined" density="compact" class="mb-2" />
          <v-text-field v-model.number="formData.sortOrder" label="정렬순서" type="number" variant="outlined" density="compact" class="mb-2" />
          <v-text-field v-model="formData.description" label="설명" variant="outlined" density="compact" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="dialog = false">취소</v-btn>
          <v-btn color="primary" @click="saveCode">저장</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </MainLayout>
</template>
