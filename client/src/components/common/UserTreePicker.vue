<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { userService } from '@/services/users'
import type { User } from '@/types'

defineOptions({ inheritAttrs: false })

interface Props {
  modelValue: string
  label?: string
  disabled?: boolean
  clearable?: boolean
  density?: string
  variant?: string
  /** 외부에서 users 를 넘기면 API 호출 안 함 */
  users?: User[]
  /** 프로젝트 멤버 모드: members 배열을 받으면 해당 멤버만 표시 */
  members?: any[]
}

const props = withDefaults(defineProps<Props>(), {
  label: '사용자',
  disabled: false,
  clearable: false,
  density: 'compact',
  variant: 'outlined',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const dialog = ref(false)
const search = ref('')
const allUsers = ref<User[]>([])
const loading = ref(false)

// 부서 펼침/접힘 상태
const expandedDepts = ref<Set<string>>(new Set())

// 사용자 데이터 로드
async function loadUsers() {
  if (props.users && props.users.length) {
    allUsers.value = props.users
    return
  }
  if (props.members && props.members.length) {
    allUsers.value = props.members.map((m: any) => ({
      userId: m.user?.userId || m.userId,
      userName: m.user?.userName || m.userName || '',
      department: m.user?.department || m.department || '',
      position: m.user?.position || m.position || '',
      email: m.user?.email || '',
      phone: m.user?.phone || '',
      systemRole: m.user?.systemRole || m.systemRole || '',
      isActive: true,
      createdAt: '',
    }))
    return
  }
  if (allUsers.value.length) return
  loading.value = true
  try {
    const result = await userService.getList({ size: 200, isActive: 'true' })
    if (result.success) allUsers.value = result.data
  } catch (err) {
    console.error('Failed to load users:', err)
  } finally {
    loading.value = false
  }
}

// 검색 필터된 사용자
const filteredUsers = computed(() => {
  if (!search.value) return allUsers.value
  const kw = search.value.toLowerCase()
  return allUsers.value.filter(u =>
    u.userName.toLowerCase().includes(kw) ||
    u.userId.toLowerCase().includes(kw) ||
    (u.department || '').toLowerCase().includes(kw) ||
    (u.position || '').toLowerCase().includes(kw)
  )
})

// 부서별 그룹핑
interface DeptGroup {
  department: string
  users: User[]
}

const deptGroups = computed<DeptGroup[]>(() => {
  const map = new Map<string, User[]>()
  for (const u of filteredUsers.value) {
    const dept = u.department || '(부서 미지정)'
    if (!map.has(dept)) map.set(dept, [])
    map.get(dept)!.push(u)
  }
  // 부서명 정렬
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([department, users]) => ({ department, users }))
})

// 검색 시 모든 부서 펼침
watch(search, (val) => {
  if (val) {
    expandedDepts.value = new Set(deptGroups.value.map(g => g.department))
  }
})

function toggleDept(dept: string) {
  if (expandedDepts.value.has(dept)) {
    expandedDepts.value.delete(dept)
  } else {
    expandedDepts.value.add(dept)
  }
}

function expandAll() {
  expandedDepts.value = new Set(deptGroups.value.map(g => g.department))
}

function collapseAll() {
  expandedDepts.value.clear()
}

// 선택
function selectUser(user: User) {
  emit('update:modelValue', user.userId)
  dialog.value = false
  search.value = ''
}

function clearSelection() {
  emit('update:modelValue', '')
}

// 표시 텍스트: 선택된 사용자 정보
const displayText = computed(() => {
  if (!props.modelValue) return ''
  const u = allUsers.value.find(u => u.userId === props.modelValue)
  if (u) return `${u.userName} (${u.department || u.userId})`
  return props.modelValue
})

// 역할 색상
function getRoleColor(role: string) {
  return role === 'ADMIN' ? 'red' : 'blue'
}

function getRoleLabel(role: string) {
  return role === 'ADMIN' ? '관리자' : '사용자'
}

function openDialog() {
  if (props.disabled) return
  loadUsers()
  // 초기 전체 펼침
  setTimeout(() => expandAll(), 50)
  dialog.value = true
}

// props.users 변경 감시
watch(() => props.users, (val) => {
  if (val && val.length) allUsers.value = val
}, { immediate: true })

watch(() => props.members, (val) => {
  if (val && val.length) {
    allUsers.value = val.map((m: any) => ({
      userId: m.user?.userId || m.userId,
      userName: m.user?.userName || m.userName || '',
      department: m.user?.department || m.department || '',
      position: m.user?.position || m.position || '',
      email: m.user?.email || '',
      phone: m.user?.phone || '',
      systemRole: m.user?.systemRole || m.systemRole || '',
      isActive: true,
      createdAt: '',
    }))
  }
}, { immediate: true })
</script>

<template>
  <!-- 표시용 텍스트필드 (클릭하면 다이얼로그 열기) -->
  <v-text-field
    v-bind="$attrs"
    :model-value="displayText"
    :label="label"
    :variant="(variant as any)"
    :density="(density as any)"
    :disabled="disabled"
    readonly
    append-inner-icon="mdi-account-search"
    :clearable="clearable && !!modelValue"
    @click:control="openDialog"
    @click:append-inner="openDialog"
    @click:clear="clearSelection"
    class="user-tree-picker-field"
  />

  <!-- 트리 선택 다이얼로그 -->
  <v-dialog v-model="dialog" max-width="480" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center py-2 px-4" style="font-size:14px">
        <v-icon size="18" class="mr-2">mdi-account-group</v-icon>
        조직도 — 사용자 선택
        <v-spacer />
        <v-btn icon size="x-small" variant="text" @click="dialog = false">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-divider />

      <!-- 검색 -->
      <div class="px-4 pt-3 pb-1">
        <v-text-field
          v-model="search"
          placeholder="이름, 아이디, 부서, 직위 검색"
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          autofocus
          style="font-size:12px"
        />
      </div>

      <!-- 펼침/접힘 버튼 -->
      <div class="d-flex px-4 pt-1 pb-0" style="gap:4px">
        <v-btn size="x-small" variant="text" @click="expandAll" prepend-icon="mdi-unfold-more-horizontal">전체 펼침</v-btn>
        <v-btn size="x-small" variant="text" @click="collapseAll" prepend-icon="mdi-unfold-less-horizontal">전체 접기</v-btn>
        <v-spacer />
        <span class="text-caption text-grey mt-1">{{ filteredUsers.length }}명</span>
      </div>

      <v-divider class="mt-1" />

      <!-- 트리 본체 -->
      <v-card-text class="pa-0" style="max-height:420px; overflow-y:auto">
        <v-progress-linear v-if="loading" indeterminate color="primary" />

        <div v-if="!loading && deptGroups.length === 0" class="text-center text-grey py-8">
          <v-icon size="40" color="grey-lighten-1">mdi-account-off</v-icon>
          <div class="mt-2" style="font-size:13px">검색 결과가 없습니다</div>
        </div>

        <div v-for="group in deptGroups" :key="group.department" class="dept-group">
          <!-- 부서 노드 -->
          <div
            class="dept-header d-flex align-center px-4 py-2"
            style="cursor:pointer; user-select:none"
            @click="toggleDept(group.department)"
          >
            <v-icon size="16" class="mr-1">
              {{ expandedDepts.has(group.department) ? 'mdi-chevron-down' : 'mdi-chevron-right' }}
            </v-icon>
            <v-icon size="16" class="mr-2" color="amber-darken-2">mdi-folder-account</v-icon>
            <span class="dept-name">{{ group.department }}</span>
            <v-chip size="x-small" variant="text" class="ml-1" style="font-size:10px">{{ group.users.length }}</v-chip>
          </div>

          <!-- 사용자 노드들 -->
          <div v-if="expandedDepts.has(group.department)">
            <div
              v-for="user in group.users"
              :key="user.userId"
              class="user-item d-flex align-center px-4 py-1"
              :class="{ 'user-selected': user.userId === modelValue }"
              style="cursor:pointer; padding-left:48px !important"
              @click="selectUser(user)"
            >
              <v-icon size="14" class="mr-2" :color="user.userId === modelValue ? 'primary' : 'grey'">
                {{ user.userId === modelValue ? 'mdi-radiobox-marked' : 'mdi-account' }}
              </v-icon>
              <div class="flex-grow-1" style="min-width:0">
                <span class="user-name">{{ user.userName }}</span>
                <span class="user-meta ml-1">({{ user.userId }})</span>
                <span v-if="user.position" class="user-meta ml-1">· {{ user.position }}</span>
              </div>
              <v-chip
                v-if="user.systemRole"
                :color="getRoleColor(user.systemRole)"
                size="x-small"
                variant="tonal"
                class="ml-1"
                style="font-size:10px"
              >
                {{ getRoleLabel(user.systemRole) }}
              </v-chip>
            </div>
          </div>
        </div>
      </v-card-text>

      <v-divider />
      <v-card-actions class="px-4 py-2">
        <span v-if="modelValue" class="text-caption text-primary">
          선택: {{ displayText }}
        </span>
        <v-spacer />
        <v-btn v-if="clearable && modelValue" size="small" variant="text" color="error" @click="clearSelection(); dialog = false">
          선택 해제
        </v-btn>
        <v-btn size="small" variant="text" @click="dialog = false">닫기</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.user-tree-picker-field {
  cursor: pointer;
}
.user-tree-picker-field :deep(input) {
  cursor: pointer;
  font-size: inherit;
}

.dept-header:hover {
  background: rgba(var(--v-theme-primary), 0.04);
}
.dept-name {
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.user-item {
  transition: background-color 0.15s;
}
.user-item:hover {
  background: rgba(var(--v-theme-primary), 0.06);
}
.user-item.user-selected {
  background: rgba(var(--v-theme-primary), 0.1);
}

.user-name {
  font-size: 12px;
  font-weight: 500;
}
.user-meta {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
</style>
