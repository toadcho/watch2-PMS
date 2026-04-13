// ─── API 응답 공통 ───────────────────────────────
export interface ApiResponse<T = any> {
  success: boolean
  data: T
  message: string | null
  errorCode?: string
  pagination?: Pagination
}

export interface Pagination {
  page: number
  size: number
  totalCount: number
  totalPages: number
}

// ─── 사용자 ───────────────────────────────────────
export interface User {
  userId: string
  userName: string
  email: string
  department?: string
  position?: string
  phone?: string
  systemRole: string
  isActive: boolean
  lastLoginAt?: string
  createdAt: string
}

// ─── 프로젝트 (M1) ───────────────────────────────
export interface Project {
  projectId: number
  projectName: string
  businessNo: string
  startDate: string
  endDate: string
  status: string
  clientOrg?: string
  pmUserId?: string
  pmUserName?: string
  description?: string
  createdAt: string
  updatedAt: string
}

// ─── WBS 태스크 (M2) ─────────────────────────────
export interface WbsTask {
  taskId: number
  projectId: number
  parentTaskId?: number
  taskName: string
  phase?: string
  depth: number
  sortOrder: number
  planStart?: string
  planEnd?: string
  actualStart?: string
  actualEnd?: string
  progressRate: number
  assigneeId?: string
  assigneeName?: string
  children?: WbsTask[]
}

// ─── 산출물 (M3) ─────────────────────────────────
export interface Deliverable {
  docId: number
  taskId: number
  docType: string
  docName: string
  filePath?: string
  fileSize: number
  status: string
  auditorCheck: string
  uploaderId?: string
  uploaderName?: string
  uploadedAt: string
}

// ─── 결함 (M4) ───────────────────────────────────
export interface Defect {
  defectId: number
  defectNo: string
  tcId?: number
  projectId: number
  severity: string
  priority: string
  status: string
  title: string
  description?: string
  assigneeId?: string
  assigneeName?: string
  reporterId: string
  reporterName?: string
  reportedAt: string
  resolvedAt?: string
}

// ─── 위험 (M1) ───────────────────────────────────
export interface Risk {
  riskId: number
  projectId: number
  riskName: string
  impactLevel: string
  probability: string
  mitigationPlan?: string
  status: string
  ownerId?: string
  ownerName?: string
}

// ─── 이슈 (M5) ───────────────────────────────────
export interface Issue {
  issueId: number
  projectId: number
  issueTitle: string
  description?: string
  priority: string
  status: string
  reporterId: string
  reporterName?: string
  assigneeId?: string
  assigneeName?: string
  createdAt: string
  resolvedAt?: string
}

// ─── 공통코드 (M6) ──────────────────────────────
export interface CommonCode {
  codeGroup: string
  code: string
  codeName: string
  sortOrder: number
  isActive: boolean
  description?: string
}

// ─── 대시보드 (C1) ──────────────────────────────
export interface DashboardData {
  totalProgress: number
  openDefects: number
  totalMembers: number
  deliverableStatus: { total: number; completed: number }
  phaseProgress: { phase: string; rate: number }[]
  riskSummary: Risk[]
  defectSummary: { severity: string; count: number }[]
  auditChecklist: { docType: string; status: string }[]
}
