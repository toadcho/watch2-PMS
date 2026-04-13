<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'

const router = useRouter()

const projects = ref<any[]>([])
const form = ref({
  projectId: null as number | null,
  userId: '',
  password: '',
  passwordConfirm: '',
  userName: '',
  department: '',
  phone: '',
})
const teams = ref<any[]>([])

async function fetchTeams() {
  if (!form.value.projectId) { teams.value = []; return }
  try {
    const res = await api.get(`/auth/projects/${form.value.projectId}/teams`)
    if (res.data.success) teams.value = res.data.data
  } catch { teams.value = [] }
}

const errorMsg = ref('')
const successMsg = ref('')
const idChecked = ref(false)
const idAvailable = ref(false)
const submitting = ref(false)

// 비밀번호 강도
const pwStrength = computed(() => {
  const p = form.value.password
  if (!p) return { level: 0, text: '', color: '' }
  let score = 0
  if (p.length >= 8) score++
  if (/[a-zA-Z]/.test(p)) score++
  if (/[0-9]/.test(p)) score++
  if (/[!@#$%^&*()_+\-=]/.test(p)) score++
  if (score <= 2) return { level: score, text: '약함', color: 'error' }
  if (score === 3) return { level: score, text: '보통', color: 'warning' }
  return { level: score, text: '강함', color: 'success' }
})
const pwMatch = computed(() => form.value.password && form.value.passwordConfirm && form.value.password === form.value.passwordConfirm)
const pwMismatch = computed(() => form.value.passwordConfirm && form.value.password !== form.value.passwordConfirm)

async function fetchProjects() {
  try {
    const res = await api.get('/auth/projects')
    if (res.data.success) projects.value = res.data.data
  } catch {}
}

async function checkId() {
  if (!form.value.userId) return
  if (!/^[a-zA-Z0-9]{4,20}$/.test(form.value.userId)) {
    errorMsg.value = '아이디는 영문+숫자 4~20자로 입력해주세요.'
    idChecked.value = false
    return
  }
  try {
    const res = await api.post('/auth/check-id', { userId: form.value.userId })
    idChecked.value = true
    idAvailable.value = res.data.data.available
    errorMsg.value = idAvailable.value ? '' : '이미 사용 중인 아이디입니다.'
  } catch { errorMsg.value = '중복 확인 실패' }
}

function onIdChange() {
  idChecked.value = false
  idAvailable.value = false
  errorMsg.value = ''
}

async function handleRegister() {
  errorMsg.value = ''
  successMsg.value = ''

  if (!form.value.projectId) { errorMsg.value = '프로젝트를 선택해주세요.'; return }
  if (!form.value.userId) { errorMsg.value = '아이디를 입력해주세요.'; return }
  if (!idChecked.value || !idAvailable.value) { errorMsg.value = '아이디 중복 확인을 해주세요.'; return }
  if (!form.value.password || form.value.password.length < 8) { errorMsg.value = '비밀번호는 8자 이상이어야 합니다.'; return }
  if (pwStrength.value.level < 4) { errorMsg.value = '비밀번호는 영문+숫자+특수문자를 모두 포함해야 합니다.'; return }
  if (form.value.password !== form.value.passwordConfirm) { errorMsg.value = '비밀번호가 일치하지 않습니다.'; return }
  if (!form.value.userName) { errorMsg.value = '이름을 입력해주세요.'; return }
  if (!form.value.department) { errorMsg.value = '소속팀을 입력해주세요.'; return }
  if (!form.value.phone) { errorMsg.value = '연락처를 입력해주세요.'; return }

  submitting.value = true
  try {
    const res = await api.post('/auth/register', {
      projectId: form.value.projectId,
      userId: form.value.userId,
      password: form.value.password,
      userName: form.value.userName,
      department: form.value.department,
      phone: form.value.phone,
    })
    if (res.data.success) {
      successMsg.value = res.data.message
      setTimeout(() => router.push('/login'), 3000)
    } else {
      errorMsg.value = res.data.message
    }
  } catch (err: any) {
    errorMsg.value = err.response?.data?.message || '회원가입 처리 중 오류가 발생했습니다.'
  } finally { submitting.value = false }
}

onMounted(fetchProjects)
</script>

<template>
  <div class="register-container">
    <div class="register-card">
      <h1>WATCH2Project</h1>
      <p class="subtitle">회원가입</p>

      <!-- 성공 메시지 -->
      <div v-if="successMsg" class="success-box">
        <v-icon size="32" color="success" class="mb-2">mdi-check-circle</v-icon>
        <div style="font-size:14px; font-weight:600; margin-bottom:4px">{{ successMsg }}</div>
        <div style="font-size:12px; color:#888">3초 후 로그인 화면으로 이동합니다...</div>
      </div>

      <form v-else @submit.prevent="handleRegister">
        <!-- 프로젝트 + 소속팀 선택 -->
        <div class="section-title">프로젝트</div>
        <div class="field">
          <label>프로젝트 선택 <span class="req">*</span></label>
          <select v-model="form.projectId" required @change="fetchTeams">
            <option :value="null" disabled>프로젝트를 선택하세요</option>
            <option v-for="p in projects" :key="p.projectId" :value="p.projectId">{{ p.projectName }} ({{ p.businessNo }})</option>
          </select>
        </div>
        <div class="field">
          <label>소속팀 <span class="req">*</span></label>
          <select v-model="form.department" required :disabled="!form.projectId">
            <option value="" disabled>소속팀을 선택하세요</option>
            <option v-for="t in teams" :key="t.teamId" :value="t.teamName">{{ t.teamName }}</option>
          </select>
          <span v-if="form.projectId && !teams.length" class="hint-err">등록된 팀이 없습니다. 관리자에게 문의하세요.</span>
        </div>

        <!-- 계정 정보 -->
        <div class="section-title">계정 정보</div>
        <div class="field">
          <label>아이디 <span class="req">*</span></label>
          <div class="field-row">
            <input v-model="form.userId" type="text" placeholder="영문+숫자 4~20자" maxlength="20" @input="onIdChange" />
            <button type="button" class="btn-check" @click="checkId" :disabled="!form.userId">중복확인</button>
          </div>
          <span v-if="idChecked && idAvailable" class="hint-ok">사용 가능한 아이디입니다.</span>
          <span v-if="idChecked && !idAvailable" class="hint-err">이미 사용 중인 아이디입니다.</span>
        </div>
        <div class="field">
          <label>비밀번호 <span class="req">*</span></label>
          <input v-model="form.password" type="password" placeholder="영문+숫자+특수문자 8자 이상" />
          <div v-if="form.password" class="pw-bar">
            <div class="pw-bar-fill" :style="{ width: (pwStrength.level / 4 * 100) + '%', background: pwStrength.color === 'error' ? '#E53935' : pwStrength.color === 'warning' ? '#FB8C00' : '#43A047' }"></div>
          </div>
          <span v-if="form.password" :class="'hint-' + pwStrength.color">{{ pwStrength.text }}</span>
        </div>
        <div class="field">
          <label>비밀번호 확인 <span class="req">*</span></label>
          <input v-model="form.passwordConfirm" type="password" placeholder="비밀번호 재입력" />
          <span v-if="pwMatch" class="hint-ok">비밀번호가 일치합니다.</span>
          <span v-if="pwMismatch" class="hint-err">비밀번호가 일치하지 않습니다.</span>
        </div>

        <!-- 인적사항 -->
        <div class="section-title">인적사항</div>
        <div class="field">
          <label>이름 <span class="req">*</span></label>
          <input v-model="form.userName" type="text" placeholder="한글 또는 영문" />
        </div>
        <div class="field">
          <label>연락처 <span class="req">*</span></label>
          <input v-model="form.phone" type="tel" placeholder="010-0000-0000" />
        </div>

        <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
        <button type="submit" class="btn-primary" :disabled="submitting">
          {{ submitting ? '처리 중...' : '회원가입' }}
        </button>
      </form>

      <p class="link">이미 계정이 있으신가요? <router-link to="/login">로그인</router-link></p>
    </div>
  </div>
</template>

<style scoped>
.register-container {
  display: flex; justify-content: center; align-items: center;
  min-height: 100vh; background: #f5f7fa; padding: 20px;
}
.register-card {
  background: #fff; padding: 36px; border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.08); border: 1px solid #e0e0e0;
  width: 440px; text-align: center;
}
h1 { margin: 0 0 4px; font-size: 24px; color: #1976D2; font-weight: 700; }
.subtitle { color: #888; margin-bottom: 20px; font-size: 14px; }
.section-title {
  text-align: left; font-size: 12px; font-weight: 700; color: #1976D2;
  text-transform: uppercase; letter-spacing: 1px; margin: 16px 0 8px;
  padding-bottom: 4px; border-bottom: 1px solid #e0e0e0;
}
.field { margin-bottom: 12px; text-align: left; }
.field label { display: block; margin-bottom: 3px; font-weight: 600; font-size: 12px; color: #666; }
.req { color: #E53935; }
.field input, .field select {
  width: 100%; padding: 9px 12px; border: 1px solid #ddd; border-radius: 6px;
  font-size: 13px; box-sizing: border-box; background: #fff; color: #333;
}
.field input:focus, .field select:focus { outline: none; border-color: #1976D2; box-shadow: 0 0 0 2px rgba(25,118,210,0.1); }
.field-row { display: flex; gap: 6px; }
.field-row input { flex: 1; }
.btn-check {
  padding: 8px 14px; border: 1px solid #1976D2; border-radius: 6px;
  background: #fff; color: #1976D2; font-size: 12px; font-weight: 600;
  cursor: pointer; white-space: nowrap; transition: all 0.15s;
}
.btn-check:hover { background: #1976D2; color: #fff; }
.btn-check:disabled { opacity: 0.5; cursor: default; }
.hint-ok { font-size: 11px; color: #43A047; display: block; margin-top: 2px; }
.hint-err, .hint-error { font-size: 11px; color: #E53935; display: block; margin-top: 2px; }
.hint-warning { font-size: 11px; color: #FB8C00; display: block; margin-top: 2px; }
.hint-success { font-size: 11px; color: #43A047; display: block; margin-top: 2px; }
.pw-bar { height: 4px; background: #eee; border-radius: 2px; margin-top: 4px; overflow: hidden; }
.pw-bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s, background 0.3s; }
.error { color: #E53935; font-size: 13px; margin: 8px 0; text-align: left; }
.btn-primary {
  width: 100%; padding: 11px; background: #1976D2; color: #fff;
  border: none; border-radius: 8px; font-size: 15px; font-weight: 600;
  cursor: pointer; margin-top: 8px; transition: background 0.2s;
}
.btn-primary:hover { background: #1565C0; }
.btn-primary:disabled { opacity: 0.6; cursor: default; }
.link { margin-top: 14px; font-size: 13px; color: #888; }
.link a { color: #1976D2; text-decoration: none; }
.success-box { padding: 24px; text-align: center; }
</style>
