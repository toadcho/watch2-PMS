<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import MainLayout from '@/components/common/MainLayout.vue'
import { userService } from '@/services/users'
import { useDialog } from '@/composables/useDialog'
import api from '@/services/api'

const { showAlert, showConfirm } = useDialog()

const users = ref<any[]>([])
const projects = ref<any[]>([])
const loading = ref(false)
const pmsAdminUserIds = ref<Set<string>>(new Set())

// 검색/필터
const search = ref({ keyword: '', status: '' })

// 추가 폼
const showAdd = ref(false)
const newUser = ref({ userId: '', password: '', userName: '', department: '', position: '', phone: '', projectId: null as number | null })
const idCheck = ref<'' | 'ok' | 'taken'>('')

// 수정
const editDialog = ref(false)
const editForm = ref<any>({})
const editProjectId = ref<number | null>(null)
const editCurrentMemberId = ref<number | null>(null)

// 비밀번호
const pwDialog = ref(false)
const pwForm = ref({ userId: '', userName: '', newPassword: '', confirmPassword: '' })

async function fetchAll() {
  loading.value = true
  try {
    const [uRes, pRes] = await Promise.all([
      userService.getList({ size: 200 }),
      api.get('/projects', { params: { size: 100 } }),
    ])
    if (uRes.success) users.value = uRes.data
    if (pRes.data.success) projects.value = pRes.data.data
    // PMSAdmin ID 수집
    const adminIds = new Set<string>()
    for (const p of projects.value) {
      try {
        const mRes = await api.get(`/projects/${p.projectId}/members`)
        if (mRes.data.success) {
          for (const m of mRes.data.data) { if (m.role === 'PMSAdmin') adminIds.add(m.userId || m.user?.userId) }
        }
      } catch {}
    }
    pmsAdminUserIds.value = adminIds
  } catch {} finally { loading.value = false }
}

const filteredUsers = computed(() => {
  return users.value.filter(u => {
    if (u.systemRole !== 'ADMIN' && !pmsAdminUserIds.value.has(u.userId)) return false
    if (search.value.keyword) {
      const kw = search.value.keyword.toLowerCase()
      if (!((u.userId || '').toLowerCase().includes(kw) || (u.userName || '').toLowerCase().includes(kw) || (u.department || '').toLowerCase().includes(kw))) return false
    }
    if (search.value.status === 'active' && !u.isActive) return false
    if (search.value.status === 'pending' && u.isActive) return false
    return true
  })
})

function getUserProject(userId: string) {
  for (const p of projects.value) { if (pmsAdminUserIds.value.has(userId)) return p.projectName }
  return '-'
}

async function checkId() {
  if (!newUser.value.userId || !/^[a-zA-Z0-9]{4,20}$/.test(newUser.value.userId)) {
    await showAlert('아이디는 영문+숫자 4~20자', { color: 'error' }); return
  }
  try {
    const res = await api.post('/auth/check-id', { userId: newUser.value.userId })
    idCheck.value = res.data.data.available ? 'ok' : 'taken'
  } catch { idCheck.value = '' }
}

async function createUser() {
  if (!newUser.value.userId || !newUser.value.password || !newUser.value.userName) {
    await showAlert('아이디, 임시 비밀번호, 성명은 필수입니다.', { color: 'error' }); return
  }
  if (idCheck.value !== 'ok') { await showAlert('아이디 중복 확인을 해주세요.', { color: 'error' }); return }
  try {
    await userService.create({ ...newUser.value, projectRole: 'PMSAdmin' } as any)
    showAdd.value = false
    newUser.value = { userId: '', password: '', userName: '', department: '', position: '', phone: '', projectId: null }
    idCheck.value = ''
    await fetchAll(); await showAlert('PMSAdmin 계정이 등록되었습니다.')
  } catch (err: any) { showAlert(err.response?.data?.message || '등록 실패', { color: 'error' }) }
}

async function openEdit(u: any) {
  editForm.value = { userId: u.userId, userName: u.userName, department: u.department || '', position: u.position || '', phone: u.phone || '' }
  editProjectId.value = null; editCurrentMemberId.value = null
  for (const p of projects.value) {
    try {
      const mRes = await api.get(`/projects/${p.projectId}/members`)
      if (mRes.data.success) {
        const m = mRes.data.data.find((m: any) => (m.userId || m.user?.userId) === u.userId && m.role === 'PMSAdmin')
        if (m) { editProjectId.value = p.projectId; editCurrentMemberId.value = m.memberId; break }
      }
    } catch {}
  }
  editForm.value.projectId = editProjectId.value
  editDialog.value = true
}

async function saveEdit() {
  try {
    await userService.update(editForm.value.userId, { userName: editForm.value.userName, department: editForm.value.department, position: editForm.value.position, phone: editForm.value.phone })
    const newPid = editForm.value.projectId; const oldPid = editProjectId.value
    if (newPid !== oldPid) {
      if (oldPid && editCurrentMemberId.value) { try { await api.delete(`/projects/${oldPid}/members/${editCurrentMemberId.value}`) } catch {} }
      if (newPid) { await api.post(`/projects/${newPid}/members`, { userId: editForm.value.userId, role: 'PMSAdmin', joinDate: new Date().toISOString().substring(0, 10) }) }
    }
    editDialog.value = false; await fetchAll(); await showAlert('수정되었습니다.')
  } catch (err: any) { showAlert(err.response?.data?.message || '수정 실패', { color: 'error' }) }
}

function openPw(u: any) { pwForm.value = { userId: u.userId, userName: u.userName, newPassword: '', confirmPassword: '' }; pwDialog.value = true }
async function savePw() {
  if (!pwForm.value.newPassword || pwForm.value.newPassword !== pwForm.value.confirmPassword) { await showAlert('비밀번호를 확인해주세요.', { color: 'error' }); return }
  try {
    await userService.update(pwForm.value.userId, { password: pwForm.value.newPassword })
    pwDialog.value = false; await showAlert('비밀번호가 초기화되었습니다.')
  } catch (err: any) { showAlert(err.response?.data?.message || '실패', { color: 'error' }) }
}

async function deleteUser(u: any) {
  if (!(await showConfirm(`"${u.userName}" (${u.userId})를 삭제하시겠습니까?`))) return
  try { await userService.remove(u.userId); await fetchAll() }
  catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

async function toggleActive(u: any) {
  try { await userService.update(u.userId, { isActive: !u.isActive }); await fetchAll() }
  catch (err: any) { showAlert(err.response?.data?.message || '실패', { color: 'error' }) }
}

onMounted(fetchAll)
</script>

<template>
  <MainLayout>
    <div class="pms-page-title mb-3">사용자 관리</div>

    <!-- 역할별 권한 안내 -->
    <div class="info-card mb-3">
      <div class="info-card-title">역할별 권한 안내</div>
      <table class="info-table">
        <thead>
          <tr><th style="width:100px">역할</th><th>프로젝트 관리</th><th>WBS/산출물/보고서</th><th>비고</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="role-badge admin">PMSAdmin</span></td>
            <td>프로젝트 기본정보 CRUD, 팀 생성, 인력 승인/관리, 설정</td>
            <td>WBS 구조 변경, 산출물 등록/승인설정, 보고서 생성/완료</td>
            <td>프로젝트 내 전체 관리 권한</td>
          </tr>
          <tr>
            <td><span class="role-badge pl">PL</span></td>
            <td>소속 부서 인력 실적 등록</td>
            <td>산출물 PL승인, 소속팀 태스크 실적 관리</td>
            <td>팀장 역할, 소속 부서 범위</td>
          </tr>
          <tr>
            <td><span class="role-badge tm">TM</span></td>
            <td>본인 태스크 실적 등록</td>
            <td>본인 담당 산출물 등록, 실적 입력</td>
            <td>팀원 기본 역할</td>
          </tr>
          <tr>
            <td><span class="role-badge qa">QA / PMO</span></td>
            <td>-</td>
            <td>산출물 QA/PMO 승인</td>
            <td>승인 프로세스 참여</td>
          </tr>
          <tr>
            <td><span class="role-badge pm">PM</span></td>
            <td>본인 태스크 실적 등록</td>
            <td>조회 + 본인 담당 실적</td>
            <td>모니터링 + 본인 담당</td>
          </tr>
          <tr>
            <td><span class="role-badge monitor">Customer / Inspector</span></td>
            <td>조회 전용</td>
            <td>조회 전용, 산출물 Customer 승인</td>
            <td>모니터링 전용</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 추가 버튼 -->
    <div class="d-flex align-center mb-2">
      <v-btn v-if="!showAdd" size="small" color="primary" prepend-icon="mdi-account-plus" @click="showAdd = true">새 PMSAdmin 등록</v-btn>
      <v-btn v-else size="small" variant="outlined" @click="showAdd = false">닫기</v-btn>
    </div>

    <!-- 추가 폼 -->
    <div v-if="showAdd" class="add-card mb-3">
      <div class="add-title">새 사용자 등록</div>
      <div class="add-body">
        <div class="add-row">
          <div class="add-field">
            <label>아이디 <span class="req">*</span></label>
            <div style="display:flex; gap:4px">
              <input v-model="newUser.userId" placeholder="영문+숫자 4자 이상" @input="idCheck = ''" />
              <button class="btn-check" @click="checkId">중복확인</button>
            </div>
            <div v-if="idCheck === 'ok'" class="hint-ok">사용 가능</div>
            <div v-if="idCheck === 'taken'" class="hint-err">사용 중</div>
          </div>
          <div class="add-field">
            <label>임시 비밀번호 <span class="req">*</span></label>
            <input v-model="newUser.password" placeholder="첫 로그인 시 변경됩니다" />
            <div class="hint">사용자 첫 로그인 시 비밀번호 변경이 강제됩니다.</div>
          </div>
        </div>
        <div class="add-row">
          <div class="add-field"><label>성명 <span class="req">*</span></label><input v-model="newUser.userName" /></div>
          <div class="add-field"><label>소속팀</label><input v-model="newUser.department" placeholder="PMSAdmin이 배정" /></div>
          <div class="add-field"><label>직급</label><input v-model="newUser.position" /></div>
        </div>
        <div class="add-row">
          <div class="add-field">
            <label>소속 프로젝트</label>
            <select v-model="newUser.projectId">
              <option :value="null">프로젝트 미지정</option>
              <option v-for="p in projects" :key="p.projectId" :value="p.projectId">{{ p.projectName }}</option>
            </select>
          </div>
          <div class="add-field"><label>연락처</label><input v-model="newUser.phone" placeholder="010-0000-0000" /></div>
          <div class="add-field" style="display:flex; align-items:flex-end"><button class="btn-add" @click="createUser">등록</button></div>
        </div>
      </div>
    </div>

    <!-- 검색/필터 -->
    <div class="filter-row mb-2">
      <input v-model="search.keyword" placeholder="아이디, 성명, 팀 검색" class="filter-input" />
      <select v-model="search.status" class="filter-select">
        <option value="">전체 상태</option>
        <option value="active">승인</option>
        <option value="pending">대기</option>
      </select>
      <span class="filter-count">{{ filteredUsers.length }}명</span>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-1" />

    <!-- 사용자 목록 -->
    <div class="user-table-wrap">
      <table class="user-table">
        <thead>
          <tr>
            <th>아이디</th><th>성명</th><th>소속팀</th><th>직급</th><th>소속 프로젝트</th><th>상태</th><th>액션</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!filteredUsers.length"><td colspan="7" class="empty">사용자가 없습니다.</td></tr>
          <tr v-for="u in filteredUsers" :key="u.userId">
            <td class="uid">{{ u.userId }}</td>
            <td class="uname">{{ u.userName }}</td>
            <td>{{ u.department || '-' }}</td>
            <td>{{ u.position || '-' }}</td>
            <td>{{ getUserProject(u.userId) }}</td>
            <td>
              <span :class="['status-badge', u.isActive ? 'active' : 'pending']" @click="toggleActive(u)" style="cursor:pointer">
                {{ u.isActive ? '승인' : '대기' }}
              </span>
            </td>
            <td class="actions">
              <button class="act-btn edit" @click="openEdit(u)">수정</button>
              <button class="act-btn pw" @click="openPw(u)">비밀번호</button>
              <button class="act-btn del" @click="deleteUser(u)">삭제</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 수정 오버레이 -->
    <div v-if="editDialog" class="edit-overlay" @click.self="editDialog = false">
      <div class="edit-panel">
        <div class="edit-header">
          <span>사용자 수정 — {{ editForm.userId }}</span>
          <button class="edit-close" @click="editDialog = false">&times;</button>
        </div>
        <div class="edit-body">
          <div class="add-row">
            <div class="add-field"><label>아이디</label><input :value="editForm.userId" disabled /></div>
            <div class="add-field"><label>성명</label><input v-model="editForm.userName" /></div>
          </div>
          <div class="add-row">
            <div class="add-field"><label>소속팀</label><input v-model="editForm.department" /></div>
            <div class="add-field"><label>직급</label><input v-model="editForm.position" /></div>
          </div>
          <div class="add-row">
            <div class="add-field"><label>연락처</label><input v-model="editForm.phone" /></div>
            <div class="add-field">
              <label>소속 프로젝트</label>
              <select v-model="editForm.projectId">
                <option :value="null">프로젝트 미지정</option>
                <option v-for="p in projects" :key="p.projectId" :value="p.projectId">{{ p.projectName }}</option>
              </select>
            </div>
          </div>
          <div class="add-row" style="justify-content:flex-end; gap:8px; margin-top:8px">
            <button class="btn-cancel" @click="editDialog = false">취소</button>
            <button class="btn-add" @click="saveEdit">저장</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 비밀번호 오버레이 -->
    <div v-if="pwDialog" class="edit-overlay" @click.self="pwDialog = false">
      <div class="edit-panel" style="width:380px">
        <div class="edit-header">
          <span>비밀번호 초기화 — {{ pwForm.userName }}</span>
          <button class="edit-close" @click="pwDialog = false">&times;</button>
        </div>
        <div class="edit-body">
          <div class="add-field mb-3"><label>새 비밀번호</label><input v-model="pwForm.newPassword" type="password" placeholder="영문+숫자+특수문자 8자 이상" /></div>
          <div class="add-field mb-2"><label>비밀번호 확인</label><input v-model="pwForm.confirmPassword" type="password" /></div>
          <div v-if="pwForm.confirmPassword && pwForm.newPassword === pwForm.confirmPassword" class="hint-ok">일치</div>
          <div v-if="pwForm.confirmPassword && pwForm.newPassword !== pwForm.confirmPassword" class="hint-err">불일치</div>
          <div class="add-row" style="justify-content:flex-end; gap:8px; margin-top:12px">
            <button class="btn-cancel" @click="pwDialog = false">취소</button>
            <button class="btn-add" :disabled="!pwForm.newPassword || pwForm.newPassword !== pwForm.confirmPassword" @click="savePw">변경</button>
          </div>
        </div>
      </div>
    </div>
  </MainLayout>
</template>

<style scoped>
/* 역할 권한 안내 카드 */
.info-card { background: #f8f9ff; border: 1px solid #e0e4f0; border-radius: 10px; overflow: hidden; }
.info-card-title { padding: 10px 16px; font-size: 13px; font-weight: 700; color: #1976D2; border-bottom: 1px solid #e0e4f0; }
.info-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.info-table th { background: #eef1f8; padding: 8px 12px; text-align: left; font-weight: 600; color: #555; border-bottom: 1px solid #ddd; }
.info-table td { padding: 8px 12px; border-bottom: 1px solid #eee; vertical-align: top; color: #444; line-height: 1.5; }
.role-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #fff; }
.role-badge.admin { background: #E53935; }
.role-badge.pl { background: #3949AB; }
.role-badge.tm { background: #43A047; }
.role-badge.qa { background: #00897B; }
.role-badge.pm { background: #1E88E5; }
.role-badge.monitor { background: #8D6E63; }

/* TMS 스타일 추가 폼 */
.add-card { border: 2px dashed #1976D2; border-radius: 12px; background: #fafbff; overflow: hidden; }
.add-title { padding: 12px 20px; font-size: 14px; font-weight: 700; color: #1976D2; border-bottom: 1px solid #e0e0e0; }
.add-body { padding: 16px 20px; }
.add-row { display: flex; gap: 12px; margin-bottom: 12px; align-items: flex-start; }
.add-field { flex: 1; }
.add-field label { display: block; font-size: 12px; font-weight: 600; color: #555; margin-bottom: 4px; }
.req { color: #E53935; }
.add-field input, .add-field select { width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; box-sizing: border-box; background: #fff; }
.add-field input:focus, .add-field select:focus { outline: none; border-color: #1976D2; box-shadow: 0 0 0 2px rgba(25,118,210,0.1); }
.btn-check { padding: 8px 14px; border: 1px solid #1976D2; border-radius: 8px; background: #fff; color: #1976D2; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.btn-check:hover { background: #1976D2; color: #fff; }
.btn-add { padding: 8px 24px; background: #1976D2; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn-add:hover { background: #1565C0; }
.hint { font-size: 10px; color: #999; margin-top: 2px; }
.hint-ok { font-size: 11px; color: #43A047; margin-top: 2px; }
.hint-err { font-size: 11px; color: #E53935; margin-top: 2px; }

/* 필터 */
.filter-row { display: flex; gap: 8px; align-items: center; }
.filter-input { flex: 1; max-width: 300px; padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; }
.filter-input:focus { outline: none; border-color: #1976D2; }
.filter-select { padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 12px; background: #fff; }
.filter-count { font-size: 12px; color: #999; margin-left: auto; }

/* 사용자 테이블 */
.user-table-wrap { background: #fff; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden; }
.user-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.user-table th { background: #f5f5f5; padding: 10px 12px; text-align: left; font-weight: 600; font-size: 12px; color: #555; border-bottom: 1px solid #ddd; }
.user-table td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; }
.user-table tr:hover { background: #f9f9f9; }
.uid { font-family: monospace; font-size: 12px; color: #666; }
.uname { font-weight: 600; }
.empty { text-align: center; padding: 24px !important; color: #999; }
.status-badge { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.status-badge.active { background: #E8F5E9; color: #2E7D32; }
.status-badge.pending { background: #FFF3E0; color: #E65100; }
.actions { display: flex; gap: 4px; }
.act-btn { padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; border: 1px solid; transition: all 0.15s; }
.act-btn.edit { border-color: #1976D2; color: #1976D2; background: #fff; }
.act-btn.edit:hover { background: #1976D2; color: #fff; }
.act-btn.pw { border-color: #FB8C00; color: #FB8C00; background: #fff; }
.act-btn.pw:hover { background: #FB8C00; color: #fff; }
.act-btn.del { border-color: #E53935; color: #E53935; background: #fff; }
.act-btn.del:hover { background: #E53935; color: #fff; }

/* 수정 오버레이 */
.edit-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; justify-content: center; align-items: center; z-index: 1000; }
.edit-panel { background: #fff; border-radius: 16px; width: 500px; max-height: 90vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.15); }
.edit-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #eee; font-size: 15px; font-weight: 700; }
.edit-close { background: none; border: none; font-size: 22px; cursor: pointer; color: #999; }
.edit-close:hover { color: #333; }
.edit-body { padding: 20px; }
.mb-3 { margin-bottom: 12px; }
.btn-cancel { padding: 8px 20px; border: 1px solid #ddd; border-radius: 8px; background: #fff; font-size: 13px; cursor: pointer; }
.btn-cancel:hover { background: #f5f5f5; }
</style>
