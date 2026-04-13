import prisma from './prisma';

/**
 * 프로젝트 내 투입인력 역할 기반 권한 체크 유틸
 *
 * 역할 체계:
 *   PMSAdmin  — 프로젝트 내 전체 관리 전권
 *   PL        — 소속 TM(같은 부서) 태스크 할당/일정 조정, 산출물 등록/검토
 *   TM        — 본인 태스크 실적 입력, 산출물 등록
 *   PM/PMO/Customer/Inspector — 조회 전용 (PM/PMO는 본인 담당 실적 등록 가능)
 */

// 모니터링 전용 역할
const MONITOR_ROLES = ['PM', 'PMO', 'Customer', 'Inspector'];

export interface ProjectRoleInfo {
  role: string | null;       // 프로젝트 멤버 역할 (null = 미투입)
  isPmsAdmin: boolean;       // PMSAdmin
  isLeader: boolean;         // PL
  isMember: boolean;         // TM
  isMonitor: boolean;        // PM/PMO/Customer/Inspector
  isSystemAdmin: boolean;    // 시스템 관리자 (user.systemRole === 'ADMIN')
  department: string | null; // 사용자 부서 (PL의 소속 TM 판별용)
}

/**
 * 사용자의 프로젝트 내 역할 정보를 조회
 */
export async function getProjectRole(userId: string, projectId: bigint, systemRole: string): Promise<ProjectRoleInfo> {
  const member = await prisma.projectMember.findFirst({
    where: { projectId, userId },
    select: { role: true },
  });

  const user = await prisma.user.findUnique({
    where: { userId },
    select: { department: true },
  });

  const role = member?.role || null;
  return {
    role,
    isPmsAdmin: role === 'PMSAdmin',
    isLeader: role === 'PL',
    isMember: role === 'TM',
    isMonitor: role !== null && MONITOR_ROLES.includes(role),
    isSystemAdmin: systemRole === 'ADMIN' || systemRole === 'SYS_ADMIN',
    department: user?.department || null,
  };
}

/**
 * PL이 해당 태스크를 수정할 수 있는지 확인
 * — 담당자가 같은 부서 소속이거나, 담당자가 없는 경우
 */
export async function canLeaderEditTask(leaderDept: string | null, assigneeId: string | null): Promise<boolean> {
  if (!leaderDept) return false;
  if (!assigneeId) return true;

  const assignee = await prisma.user.findUnique({
    where: { userId: assigneeId },
    select: { department: true },
  });

  return assignee?.department === leaderDept;
}

/**
 * 실적 필드만 수정하는지 확인
 */
const MEMBER_ALLOWED_FIELDS = ['actualStart', 'actualEnd', 'actualMd', 'progressRate', 'actualRate'];

export function isOnlyActualFields(body: Record<string, any>): boolean {
  const editableFields = Object.keys(body).filter(k =>
    body[k] !== undefined && !['taskId', 'projectId'].includes(k)
  );
  return editableFields.length > 0 && editableFields.every(f => MEMBER_ALLOWED_FIELDS.includes(f));
}
