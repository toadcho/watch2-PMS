<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import MainLayout from '@/components/common/MainLayout.vue'
import { useDialog } from '@/composables/useDialog'

const props = withDefaults(defineProps<{
  category?: string
  pageTitle?: string
}>(), {
  category: 'notice',
  pageTitle: '공지사항',
})
import { noticeService } from '@/services/notices'
import { projectService } from '@/services/projects'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Placeholder from '@tiptap/extension-placeholder'
import api from '@/services/api'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const projectId = Number(route.params.projectId)
const { showAlert, showConfirm } = useDialog()

const notices = ref<any[]>([])
const boards = ref<any[]>([])
const loading = ref(false)
const myRole = ref<any>(null)
const canManage = ref(false)
const isProjectMember = ref(false)
const selectedBoard = ref<string>('all')  // 'all' | 'null' | boardId

// 전체 게시판: 관리자만 등록, 개별 게시판: 모든 멤버 등록 가능
const canPost = computed(() => {
  if (canManage.value) return true
  if (!isProjectMember.value) return false
  return selectedBoard.value !== 'all' && selectedBoard.value !== 'null'
})
// 수정/삭제: 관리자 또는 본인 작성글
function canEditNotice(n: any) {
  return canManage.value || n.writerId === authStore.user?.userId
}
const expandedId = ref<number | null>(null)

// 게시판 관리
const boardDialog = ref(false)
const boardEditMode = ref(false)
const boardEditId = ref<number | null>(null)
const boardForm = ref({ boardName: '', description: '' })

// 공지 작성/수정
const noticeDialog = ref(false)
const noticeEditMode = ref(false)
const noticeEditId = ref<number | null>(null)
const noticeForm = ref({ title: '', isPinned: false, boardId: '' as string })
const attachFiles = ref<File[]>([])
const existingAttachments = ref<any[]>([])
const removeAttachIds = ref<number[]>([])

// Tiptap 에디터
const editor = useEditor({
  extensions: [
    StarterKit,
    Image.configure({ inline: true, allowBase64: true }),
    Link.configure({ openOnClick: false }),
    Underline,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Placeholder.configure({ placeholder: '내용을 입력하세요...' }),
  ],
  editorProps: {
    handlePaste(view, event) {
      const items = event.clipboardData?.items
      if (!items) return false
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          event.preventDefault()
          const file = item.getAsFile()
          if (file) uploadAndInsertImage(file)
          return true
        }
      }
      return false
    },
    handleDrop(view, event) {
      const files = event.dataTransfer?.files
      if (!files?.length) return false
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          event.preventDefault()
          uploadAndInsertImage(file)
          return true
        }
      }
      return false
    },
  },
})

async function uploadAndInsertImage(file: File) {
  try {
    const res = await noticeService.uploadImage(file)
    if (res.success && editor.value) {
      const serverUrl = (api.defaults.baseURL || '').replace('/api/v1', '')
      editor.value.chain().focus().setImage({ src: `${serverUrl}${res.data.url}` }).run()
    }
  } catch { showAlert('이미지 업로드 실패', { color: 'error' }) }
}

// 데이터 로드
async function fetchAll() {
  loading.value = true
  try {
    const [boardRes, roleRes] = await Promise.all([
      noticeService.getBoards(projectId, props.category),
      projectService.getMyRole(projectId).catch(() => ({ success: false })),
    ])
    if (boardRes.success) boards.value = boardRes.data
    if (roleRes.success) myRole.value = roleRes.data
    canManage.value = myRole.value?.isPmsAdmin || false
    isProjectMember.value = !!myRole.value
    await fetchNotices()
  } finally { loading.value = false }
}

async function fetchNotices() {
  try {
    const params: any = { projectId, size: 50, category: props.category }
    if (selectedBoard.value !== 'all') params.boardId = selectedBoard.value
    const res = await noticeService.getList(params)
    if (res.success) notices.value = res.data
  } catch {}
}

watch(selectedBoard, () => fetchNotices())

// 게시판 CRUD
function openBoardCreate() {
  boardEditMode.value = false; boardEditId.value = null
  boardForm.value = { boardName: '', description: '' }
  boardDialog.value = true
}
function openBoardEdit(b: any) {
  boardEditMode.value = true; boardEditId.value = b.boardId
  boardForm.value = { boardName: b.boardName, description: b.description || '' }
  boardDialog.value = true
}
async function saveBoard() {
  try {
    if (boardEditMode.value && boardEditId.value) {
      await noticeService.updateBoard(boardEditId.value, boardForm.value)
    } else {
      await noticeService.createBoard({ projectId, ...boardForm.value, category: props.category })
    }
    boardDialog.value = false
    const res = await noticeService.getBoards(projectId, props.category)
    if (res.success) boards.value = res.data
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
}
async function deleteBoard(b: any) {
  if (!(await showConfirm(`"${b.boardName}" 게시판을 삭제하시겠습니까?\n게시판 내 공지는 전체로 이동됩니다.`))) return
  try {
    await noticeService.deleteBoard(b.boardId)
    selectedBoard.value = 'all'
    const res = await noticeService.getBoards(projectId, props.category)
    if (res.success) boards.value = res.data
    await fetchNotices()
  } catch (err: any) { showAlert(err.response?.data?.message || '삭제 실패', { color: 'error' }) }
}

// 공지 CRUD
function openNoticeCreate() {
  noticeEditMode.value = false; noticeEditId.value = null
  noticeForm.value = { title: '', isPinned: false, boardId: selectedBoard.value === 'all' || selectedBoard.value === 'null' ? '' : selectedBoard.value }
  attachFiles.value = []
  existingAttachments.value = []
  removeAttachIds.value = []
  editor.value?.commands.setContent('')
  noticeDialog.value = true
}
function openNoticeEdit(n: any) {
  noticeEditMode.value = true; noticeEditId.value = n.noticeId
  noticeForm.value = { title: n.title, isPinned: n.isPinned, boardId: n.boardId ? String(n.boardId) : '' }
  attachFiles.value = []
  existingAttachments.value = n.attachments || []
  removeAttachIds.value = []
  editor.value?.commands.setContent(n.content || '')
  noticeDialog.value = true
}
async function saveNotice() {
  const content = editor.value?.getHTML() || ''
  if (!noticeForm.value.title || !content || content === '<p></p>') {
    await showAlert('제목과 내용은 필수입니다.'); return
  }
  try {
    const fd = new FormData()
    fd.append('title', noticeForm.value.title)
    fd.append('content', content)
    fd.append('isPinned', String(noticeForm.value.isPinned))
    if (noticeForm.value.boardId) fd.append('boardId', noticeForm.value.boardId)
    fd.append('projectId', String(projectId))
    fd.append('category', props.category)
    for (const f of attachFiles.value) fd.append('files', f)
    if (removeAttachIds.value.length) fd.append('removeAttachIds', JSON.stringify(removeAttachIds.value))

    if (noticeEditMode.value && noticeEditId.value) {
      await noticeService.update(noticeEditId.value, fd)
    } else {
      await noticeService.create(fd)
    }
    noticeDialog.value = false
    await fetchNotices()
  } catch (err: any) { showAlert(err.response?.data?.message || '저장 실패', { color: 'error' }) }
}
async function deleteNotice(noticeId: number) {
  if (!(await showConfirm('공지를 삭제하시겠습니까?'))) return
  try { await noticeService.remove(noticeId); await fetchNotices() } catch {}
}
function removeExistingAttach(attachId: number) {
  removeAttachIds.value.push(attachId)
  existingAttachments.value = existingAttachments.value.filter(a => a.attachId !== attachId)
}

function formatDate(d: string) { return d ? new Date(d).toLocaleDateString('ko-KR') : '-' }
function fileUrl(filePath: string) {
  const base = (api.defaults.baseURL || '').replace('/api/v1', '')
  return `${base}${filePath}`
}
function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1048576).toFixed(1) + 'MB'
}

const boardSelectItems = computed(() => [
  { title: '(미분류)', value: '' },
  ...boards.value.map(b => ({ title: b.boardName, value: String(b.boardId) })),
])

// 게시판별 색상 팔레트
const BOARD_COLORS = ['#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#E53935', '#00ACC1', '#F4511E', '#3949AB', '#7CB342', '#D81B60']
function boardColor(boardId: number | null): string {
  if (!boardId) return '#9E9E9E'
  const idx = boards.value.findIndex(b => b.boardId === boardId)
  return BOARD_COLORS[idx % BOARD_COLORS.length] || '#9E9E9E'
}

// 신규 게시물 판별 (24시간 이내)
function isNewNotice(n: any): boolean {
  if (!n.createdAt) return false
  const diff = Date.now() - new Date(n.createdAt).getTime()
  return diff < 24 * 60 * 60 * 1000
}

onMounted(() => { authStore.restoreFromToken(); fetchAll() })
</script>

<template>
  <MainLayout>
    <!-- 헤더 -->
    <v-row class="mb-1" align="center" dense>
      <v-col cols="auto"><v-btn icon size="small" variant="text" @click="router.push(`/projects/${projectId}`)"><v-icon>mdi-arrow-left</v-icon></v-btn></v-col>
      <v-col><span class="pms-page-title">{{ pageTitle }}</span></v-col>
      <v-col cols="auto" class="d-flex" style="gap:4px">
        <v-btn v-if="canManage" size="x-small" variant="outlined" prepend-icon="mdi-folder-plus" @click="openBoardCreate">게시판</v-btn>
        <v-btn v-if="canPost" size="x-small" color="primary" prepend-icon="mdi-plus" @click="openNoticeCreate">공지 등록</v-btn>
      </v-col>
    </v-row>

    <!-- 게시판 탭 -->
    <v-tabs v-model="selectedBoard" color="primary" density="compact" class="mb-2">
      <v-tab value="all" size="small">전체</v-tab>
      <v-tab v-for="(b, bi) in boards" :key="b.boardId" :value="String(b.boardId)" size="small">
        <span class="board-dot" :style="{ background: BOARD_COLORS[bi % BOARD_COLORS.length] }"></span>
        {{ b.boardName }}
        <v-btn v-if="canManage" icon size="12" variant="text" class="ml-1" @click.stop="openBoardEdit(b)"><v-icon size="10">mdi-pencil</v-icon></v-btn>
        <v-btn v-if="canManage" icon size="12" variant="text" color="error" class="ml-0" @click.stop="deleteBoard(b)"><v-icon size="10">mdi-close</v-icon></v-btn>
      </v-tab>
    </v-tabs>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

    <!-- 공지 목록 -->
    <div class="pms-card">
      <div v-if="!notices.length" class="text-center pa-8" style="color:var(--pms-text-hint); font-size:var(--pms-font-body)">등록된 공지가 없습니다.</div>
      <div v-for="n in notices" :key="n.noticeId" class="notice-item" :class="{ 'notice-new': isNewNotice(n) }">
        <!-- 게시판 색상 플래그 -->
        <div class="notice-board-flag" :style="{ background: boardColor(n.boardId) }"></div>
        <!-- 공지 항목 -->
        <div class="notice-row" @click="expandedId = expandedId === n.noticeId ? null : n.noticeId">
          <v-icon v-if="n.isPinned" color="error" size="14" class="mr-1">mdi-pin</v-icon>
          <div style="flex:1; min-width:0">
            <div class="d-flex align-center" style="gap:5px">
              <v-chip v-if="n.board?.boardName" size="x-small" variant="flat" :style="{ background: boardColor(n.boardId), color: '#fff' }">{{ n.board.boardName }}</v-chip>
              <v-chip v-else size="x-small" variant="outlined" color="grey">미분류</v-chip>
              <span style="font-size:var(--pms-font-body); font-weight:600">{{ n.title }}</span>
              <span v-if="isNewNotice(n)" class="new-badge">NEW</span>
              <v-icon v-if="n.attachments?.length" size="12" color="grey">mdi-paperclip</v-icon>
            </div>
            <div style="font-size:var(--pms-font-caption); color:var(--pms-text-hint); margin-top:2px">{{ n.writerName }} | {{ formatDate(n.createdAt) }}</div>
          </div>
          <template v-if="canEditNotice(n)">
            <v-btn icon size="x-small" variant="text" @click.stop="openNoticeEdit(n)"><v-icon size="14">mdi-pencil</v-icon></v-btn>
            <v-btn icon size="x-small" variant="text" color="error" @click.stop="deleteNotice(n.noticeId)"><v-icon size="14">mdi-delete</v-icon></v-btn>
          </template>
        </div>
        <!-- 펼친 내용 -->
        <v-expand-transition>
          <div v-if="expandedId === n.noticeId" class="notice-expand">
            <div class="notice-content" v-html="n.content"></div>
            <div v-if="n.attachments?.length" class="mt-2 pt-2" style="border-top:1px solid var(--pms-border-light)">
              <div style="font-size:var(--pms-font-caption); font-weight:600; margin-bottom:4px">첨부파일</div>
              <div v-for="a in n.attachments" :key="a.attachId" class="d-flex align-center mb-1">
                <v-icon size="12" class="mr-1">mdi-file</v-icon>
                <a :href="fileUrl(a.filePath)" target="_blank" style="font-size:var(--pms-font-caption); color:var(--pms-primary)">{{ a.fileName }}</a>
                <span style="font-size:var(--pms-font-mini); color:var(--pms-text-hint); margin-left:4px">({{ formatSize(a.fileSize) }})</span>
              </div>
            </div>
          </div>
        </v-expand-transition>
      </div>
    </div>

    <!-- 게시판 관리 다이얼로그 -->
    <v-dialog v-model="boardDialog" max-width="400">
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">{{ boardEditMode ? '게시판 수정' : '게시판 생성' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="boardForm.boardName" variant="outlined" density="compact" hide-details class="pms-form mb-3">
            <template #label>게시판명<span class="pms-required">*</span></template>
          </v-text-field>
          <v-text-field v-model="boardForm.description" label="설명" variant="outlined" density="compact" hide-details class="pms-form" />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn size="small" variant="outlined" @click="boardDialog = false">취소</v-btn><v-btn size="small" color="primary" @click="saveBoard">저장</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 공지 작성/수정 다이얼로그 -->
    <v-dialog v-model="noticeDialog" max-width="800" persistent>
      <v-card>
        <v-card-title style="font-size:var(--pms-font-subtitle)">{{ noticeEditMode ? '공지 수정' : '공지 등록' }}</v-card-title>
        <v-card-text>
          <div class="pms-form-group">
            <div class="pms-form-group-title"><v-icon size="16">mdi-file-document-edit</v-icon>기본정보</div>
            <v-row dense>
              <v-col cols="8">
                <v-text-field v-model="noticeForm.title" variant="outlined" density="compact" hide-details class="pms-form">
                  <template #label>제목<span class="pms-required">*</span></template>
                </v-text-field>
              </v-col>
              <v-col cols="4">
                <v-select v-model="noticeForm.boardId" :items="boardSelectItems" label="게시판" variant="outlined" density="compact" hide-details class="pms-form" />
              </v-col>
            </v-row>
          </div>

          <!-- Tiptap 에디터 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title green"><v-icon size="16">mdi-text-box</v-icon>내용</div>
            <div class="editor-toolbar d-flex flex-wrap ga-1 mb-1" v-if="editor">
              <v-btn-group variant="outlined" density="compact">
                <v-btn size="x-small" :active="editor.isActive('bold')" @click="editor.chain().focus().toggleBold().run()"><v-icon size="14">mdi-format-bold</v-icon></v-btn>
                <v-btn size="x-small" :active="editor.isActive('italic')" @click="editor.chain().focus().toggleItalic().run()"><v-icon size="14">mdi-format-italic</v-icon></v-btn>
                <v-btn size="x-small" :active="editor.isActive('underline')" @click="editor.chain().focus().toggleUnderline().run()"><v-icon size="14">mdi-format-underline</v-icon></v-btn>
                <v-btn size="x-small" :active="editor.isActive('strike')" @click="editor.chain().focus().toggleStrike().run()"><v-icon size="14">mdi-format-strikethrough</v-icon></v-btn>
              </v-btn-group>
              <v-btn-group variant="outlined" density="compact">
                <v-btn size="x-small" :active="editor.isActive('heading', { level: 2 })" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"><v-icon size="14">mdi-format-header-2</v-icon></v-btn>
                <v-btn size="x-small" :active="editor.isActive('heading', { level: 3 })" @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"><v-icon size="14">mdi-format-header-3</v-icon></v-btn>
              </v-btn-group>
              <v-btn-group variant="outlined" density="compact">
                <v-btn size="x-small" :active="editor.isActive('bulletList')" @click="editor.chain().focus().toggleBulletList().run()"><v-icon size="14">mdi-format-list-bulleted</v-icon></v-btn>
                <v-btn size="x-small" :active="editor.isActive('orderedList')" @click="editor.chain().focus().toggleOrderedList().run()"><v-icon size="14">mdi-format-list-numbered</v-icon></v-btn>
              </v-btn-group>
              <v-btn-group variant="outlined" density="compact">
                <v-btn size="x-small" :active="editor.isActive({ textAlign: 'left' })" @click="editor.chain().focus().setTextAlign('left').run()"><v-icon size="14">mdi-format-align-left</v-icon></v-btn>
                <v-btn size="x-small" :active="editor.isActive({ textAlign: 'center' })" @click="editor.chain().focus().setTextAlign('center').run()"><v-icon size="14">mdi-format-align-center</v-icon></v-btn>
              </v-btn-group>
              <v-btn size="x-small" variant="outlined" @click="editor.chain().focus().setHorizontalRule().run()"><v-icon size="14">mdi-minus</v-icon></v-btn>
              <v-btn size="x-small" variant="outlined" @click="editor.chain().focus().toggleBlockquote().run()" :active="editor.isActive('blockquote')"><v-icon size="14">mdi-format-quote-close</v-icon></v-btn>
            </div>
            <div class="editor-wrap mb-1">
              <editor-content :editor="editor" />
            </div>
            <div style="font-size:var(--pms-font-caption); color:var(--pms-text-hint)">화면 캡처 이미지를 Ctrl+V로 붙여넣거나 드래그&드롭할 수 있습니다.</div>
          </div>

          <!-- 첨부파일 -->
          <div class="pms-form-group">
            <div class="pms-form-group-title orange"><v-icon size="16">mdi-paperclip</v-icon>첨부파일</div>
            <div v-for="a in existingAttachments" :key="a.attachId" class="d-flex align-center mb-1">
              <v-icon size="12" class="mr-1">mdi-file</v-icon>
              <span style="font-size:var(--pms-font-caption)">{{ a.fileName }} ({{ formatSize(a.fileSize) }})</span>
              <v-btn icon size="14" variant="text" color="error" class="ml-1" @click="removeExistingAttach(a.attachId)"><v-icon size="12">mdi-close</v-icon></v-btn>
            </div>
            <v-file-input v-model="attachFiles" label="파일 선택" variant="outlined" density="compact" multiple prepend-icon="" prepend-inner-icon="mdi-paperclip" hide-details class="pms-form" />
          </div>

          <v-switch v-model="noticeForm.isPinned" label="상단 고정" density="compact" color="primary" hide-details />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="outlined" @click="noticeDialog = false">취소</v-btn>
          <v-btn size="small" color="primary" @click="saveNotice">저장</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </MainLayout>
</template>

<style scoped>
.notice-item {
  position: relative; border-bottom: 1px solid var(--pms-border-light, #eee);
  transition: background 0.2s;
}
.notice-item.notice-new {
  background: rgba(30, 136, 229, 0.04);
}
.notice-board-flag {
  position: absolute; left: 0; top: 0; bottom: 0; width: 4px; border-radius: 2px 0 0 2px;
}
.notice-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px 8px 14px; cursor: pointer; transition: background 0.15s;
}
.notice-row:hover { background: var(--pms-hover, #f5f5f5); }
.new-badge {
  display: inline-block; font-size: 9px; font-weight: 700; color: #fff;
  background: #E53935; border-radius: 3px; padding: 0 4px; line-height: 16px;
  animation: newPulse 2s ease-in-out infinite;
}
@keyframes newPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
.board-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; flex-shrink: 0;
}
.notice-expand {
  padding: 0 16px 12px 14px; font-size: var(--pms-font-body, 11px); line-height: 1.6;
}
.editor-wrap {
  border: 1px solid var(--pms-border, rgba(0,0,0,0.2));
  border-radius: var(--pms-radius, 4px);
  min-height: 220px;
  max-height: 380px;
  overflow-y: auto;
}
.editor-wrap :deep(.tiptap) {
  padding: 10px 12px;
  min-height: 210px;
  outline: none;
  font-size: var(--pms-font-body, 12px);
  line-height: 1.6;
}
.editor-wrap :deep(.tiptap p.is-editor-empty:first-child::before) {
  color: #aaa;
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}
.editor-wrap :deep(.tiptap img) {
  max-width: 100%;
  border-radius: 4px;
  margin: 8px 0;
}
.editor-wrap :deep(.tiptap blockquote) {
  border-left: 3px solid #ddd;
  padding-left: 12px;
  color: #666;
  margin: 8px 0;
}
.notice-content :deep(img) {
  max-width: 100%;
  border-radius: 4px;
  margin: 8px 0;
}
.notice-content :deep(blockquote) {
  border-left: 3px solid #ddd;
  padding-left: 12px;
  color: #666;
}
</style>
