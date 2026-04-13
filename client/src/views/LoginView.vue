<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { authService } from '@/services/auth'
import { useDialog } from '@/composables/useDialog'

const { showAlert } = useDialog()

const router = useRouter()
const authStore = useAuthStore()

const userId = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const showPassword = ref(false)

// 비밀번호 변경 다이얼로그
const pwChangeDialog = ref(false)
const pwChangeUserId = ref('')
const pwChangeCurrent = ref('')
const pwChangeNew = ref('')
const pwChangeConfirm = ref('')
const pwChangeError = ref('')
const pwChangeSaving = ref(false)

// 퀵로그인
const quickUsers = ref<any[]>([])
const quickLoading = ref(false)

// 프로젝트별 그룹핑 (시스템관리자는 최상단)
const groupedUsers = computed(() => {
  const map = new Map<string, any[]>()
  for (const u of quickUsers.value) {
    const key = u.projectName || (u.systemRole === 'ADMIN' ? '시스템관리자' : '(프로젝트 미지정)')
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(u)
  }
  // 시스템관리자 그룹을 맨 위로
  return Array.from(map.entries()).sort((a, b) => {
    if (a[0] === '시스템관리자') return -1
    if (b[0] === '시스템관리자') return 1
    if (a[0] === '(프로젝트 미지정)') return 1
    if (b[0] === '(프로젝트 미지정)') return -1
    return a[0].localeCompare(b[0])
  })
})

function getRoleColor(role: string) {
  const c: Record<string, string> = {
    ADMIN: 'red', PMSAdmin: 'red', PL: 'indigo', TM: 'green',
    PM: 'blue', PMO: 'purple', Customer: 'brown', Inspector: 'teal',
  }
  return c[role] || 'grey'
}

async function handleLogin() {
  if (!userId.value || !password.value) { error.value = '아이디와 비밀번호를 입력해주세요.'; return }
  loading.value = true; error.value = ''
  try {
    const result = await authService.login(userId.value, password.value)
    if (result.success) {
      if (result.data.user.mustChangePassword) {
        // 비밀번호 변경 강제
        pwChangeUserId.value = userId.value
        pwChangeCurrent.value = password.value
        pwChangeNew.value = ''; pwChangeConfirm.value = ''; pwChangeError.value = ''
        pwChangeDialog.value = true
        return
      }
      authStore.setAuth(result.data.token, result.data.user)
      localStorage.setItem('refreshToken', result.data.refreshToken)
      router.push('/')
    } else { error.value = result.message || '로그인에 실패했습니다.' }
  } catch (err: any) { error.value = err.response?.data?.message || '로그인 중 오류가 발생했습니다.' }
  finally { loading.value = false }
}

async function quickLogin(uid: string) {
  quickLoading.value = true; error.value = ''
  try {
    const result = await authService.quickLogin(uid)
    if (result.success) {
      authStore.setAuth(result.data.token, result.data.user)
      localStorage.setItem('refreshToken', result.data.refreshToken)
      router.push('/')
    } else { error.value = result.message }
  } catch (err: any) { error.value = err.response?.data?.message || '퀵로그인 실패' }
  finally { quickLoading.value = false }
}

async function submitPwChange() {
  pwChangeError.value = ''
  if (!pwChangeNew.value || pwChangeNew.value.length < 8) { pwChangeError.value = '비밀번호는 8자 이상이어야 합니다.'; return }
  if (!/[a-zA-Z]/.test(pwChangeNew.value) || !/[0-9]/.test(pwChangeNew.value) || !/[!@#$%^&*()_+\-=]/.test(pwChangeNew.value)) {
    pwChangeError.value = '영문+숫자+특수문자를 모두 포함해야 합니다.'; return
  }
  if (pwChangeNew.value !== pwChangeConfirm.value) { pwChangeError.value = '비밀번호가 일치하지 않습니다.'; return }
  if (pwChangeNew.value === pwChangeCurrent.value) { pwChangeError.value = '기존 비밀번호와 다른 비밀번호를 입력해주세요.'; return }
  pwChangeSaving.value = true
  try {
    const res = await import('@/services/api').then(m => m.default.post('/auth/change-password', {
      userId: pwChangeUserId.value, currentPassword: pwChangeCurrent.value, newPassword: pwChangeNew.value,
    }))
    if (res.data.success) {
      pwChangeDialog.value = false
      password.value = ''
      error.value = ''
      await showAlert('비밀번호가 변경되었습니다.\n새 비밀번호로 로그인해주세요.')
    } else { pwChangeError.value = res.data.message }
  } catch (err: any) { pwChangeError.value = err.response?.data?.message || '변경 실패' }
  finally { pwChangeSaving.value = false }
}

onMounted(async () => {
  try {
    const res = await authService.getQuickLoginUsers()
    if (res.success) quickUsers.value = res.data
  } catch {}
})
</script>

<template>
  <v-container class="fill-height" fluid>
    <v-row align="center" justify="center">
      <!-- 일반 로그인 -->
      <v-col cols="12" sm="6" md="4" lg="3">
        <v-card class="elevation-8">
          <v-toolbar color="primary" dark flat>
            <v-toolbar-title class="text-subtitle-1">PMS 프로젝트관리시스템</v-toolbar-title>
          </v-toolbar>

          <v-card-text class="pt-6">
            <v-alert v-if="error" type="error" density="compact" class="mb-4" style="font-size:12px">{{ error }}</v-alert>

            <v-form @submit.prevent="handleLogin">
              <v-text-field v-model="userId" label="아이디" prepend-inner-icon="mdi-account" variant="outlined" density="comfortable" autofocus />
              <v-text-field v-model="password" :type="showPassword ? 'text' : 'password'" label="비밀번호" prepend-inner-icon="mdi-lock" :append-inner-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'" variant="outlined" density="comfortable" @click:append-inner="showPassword = !showPassword" />
              <v-btn type="submit" color="primary" block size="large" :loading="loading" class="mt-2">로그인</v-btn>
            </v-form>
          </v-card-text>

          <v-card-text class="text-center">
            <span style="font-size:13px; color:#888">계정이 없으신가요? </span>
            <router-link to="/register" style="font-size:13px; color:#1976D2; text-decoration:none; font-weight:600">회원가입</router-link>
          </v-card-text>
          <v-card-text class="text-center text-caption text-grey" style="padding-top:0">
            공공 SI 프로젝트관리시스템 v1.0
          </v-card-text>
        </v-card>
      </v-col>

      <!-- 퀵로그인 -->
      <v-col v-if="quickUsers.length" cols="12" sm="6" md="5" lg="4">
        <v-card class="elevation-4" style="max-height:520px; display:flex; flex-direction:column">
          <v-toolbar color="grey-lighten-4" flat density="compact">
            <v-icon class="ml-2 mr-2" size="small">mdi-account-switch</v-icon>
            <v-toolbar-title class="text-subtitle-2">퀵 로그인</v-toolbar-title>
          </v-toolbar>

          <v-progress-linear v-if="quickLoading" indeterminate color="primary" />

          <div style="flex:1; overflow-y:auto">
            <template v-for="[projName, users] in groupedUsers" :key="projName">
              <div class="px-3 pt-2 pb-1 d-flex align-center" style="font-size:11px; font-weight:600; color:#555; background:#f0f4f9; border-top:1px solid #e0e0e0">
                <v-icon size="12" class="mr-1" :color="projName === '시스템관리자' ? 'error' : 'primary'">
                  {{ projName === '시스템관리자' ? 'mdi-shield-crown' : 'mdi-folder-open' }}
                </v-icon>
                {{ projName }}
                <v-chip size="x-small" variant="tonal" class="ml-1" style="font-size:9px; height:16px">{{ users.length }}</v-chip>
              </div>
              <v-list density="compact" class="py-0">
                <v-list-item
                  v-for="u in users" :key="u.userId"
                  @click="quickLogin(u.userId)"
                  class="quick-user-item"
                >
                  <template #prepend>
                    <v-avatar size="28" color="primary" variant="tonal">
                      <span style="font-size:11px; font-weight:600">{{ u.userName.charAt(0) }}</span>
                    </v-avatar>
                  </template>
                  <v-list-item-title style="font-size:12px">
                    {{ u.userName }}
                    <span class="text-grey" style="font-size:10px; margin-left:4px">{{ u.userId }}</span>
                  </v-list-item-title>
                  <v-list-item-subtitle style="font-size:10px">
                    {{ u.position || '' }}
                  </v-list-item-subtitle>
                  <template #append>
                    <v-chip :color="getRoleColor(u.role)" size="x-small" variant="tonal" style="font-size:9px">{{ u.role }}</v-chip>
                  </template>
                </v-list-item>
              </v-list>
            </template>
          </div>
        </v-card>
      </v-col>
    </v-row>
    <!-- 비밀번호 변경 다이얼로그 -->
    <v-dialog v-model="pwChangeDialog" max-width="420" persistent>
      <v-card>
        <v-card-title style="font-size:16px; font-weight:700; color:#1976D2">비밀번호 변경</v-card-title>
        <v-card-text>
          <p style="font-size:13px; color:#666; margin-bottom:16px">
            관리자가 설정한 임시 비밀번호입니다.<br/>새 비밀번호를 입력해주세요.
          </p>
          <v-text-field
            v-model="pwChangeNew" type="password" label="새 비밀번호"
            variant="outlined" density="compact" class="mb-2"
            placeholder="영문+숫자+특수문자 8자 이상"
          />
          <v-text-field
            v-model="pwChangeConfirm" type="password" label="새 비밀번호 확인"
            variant="outlined" density="compact" class="mb-1"
            placeholder="비밀번호 재입력"
          />
          <div v-if="pwChangeConfirm && pwChangeNew === pwChangeConfirm" style="font-size:12px; color:#43A047; margin-bottom:8px">비밀번호가 일치합니다.</div>
          <div v-if="pwChangeConfirm && pwChangeNew !== pwChangeConfirm" style="font-size:12px; color:#E53935; margin-bottom:8px">비밀번호가 일치하지 않습니다.</div>
          <div v-if="pwChangeError" style="font-size:12px; color:#E53935; margin-bottom:8px">{{ pwChangeError }}</div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="outlined" size="small" @click="pwChangeDialog = false">취소</v-btn>
          <v-btn color="primary" size="small" :loading="pwChangeSaving" :disabled="!pwChangeNew || pwChangeNew !== pwChangeConfirm" @click="submitPwChange">비밀번호 변경</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.quick-user-item {
  cursor: pointer;
  min-height: 36px !important;
  transition: background-color 0.15s;
}
.quick-user-item:hover {
  background: rgba(25, 118, 210, 0.06);
}
</style>
