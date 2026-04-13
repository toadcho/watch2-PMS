import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';
import { getProjectRole } from '../utils/projectRole';
import { addMemberToChannel, removeMemberFromChannel } from '../utils/rocketchat';
import * as XLSX from 'xlsx';

const router = Router({ mergeParams: true });
router.use(authenticate);

// M/M 자동산정: 투입일~철수일 기간을 월 단위로 계산 (영업일 기준 22일/월)
function calcManMonth(joinDate: string | Date, leaveDate: string | Date | null | undefined): number {
  if (!leaveDate) return 0;
  const start = new Date(joinDate);
  const end = new Date(leaveDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return 0;

  // 영업일 계산 (토/일 제외)
  let bizDays = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) bizDays++;
    cur.setDate(cur.getDate() + 1);
  }

  // 22 영업일 = 1 M/M
  return Math.round((bizDays / 22) * 100) / 100;
}

function serializeMember(m: any) {
  return {
    ...m,
    memberId: Number(m.memberId),
    projectId: Number(m.projectId),
    manMonth: Number(m.manMonth),
  };
}

// GET /api/v1/projects/:projectId/members — 투입인력 목록
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);

    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: { select: { userId: true, userName: true, department: true, position: true, phone: true, email: true, address: true, photoPath: true, isActive: true } },
      },
      orderBy: { joinDate: 'asc' },
    });

    res.json({ success: true, data: members.map(serializeMember) });
  } catch (err) {
    console.error('Member list error:', err);
    res.status(500).json({ success: false, message: '투입인력 조회 중 오류가 발생했습니다.' });
  }
});

// GET /api/v1/projects/:projectId/members/my-role — 현재 사용자의 프로젝트 역할 조회
router.get('/my-role', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    res.json({ success: true, data: roleInfo });
  } catch (err) {
    console.error('My role error:', err);
    res.status(500).json({ success: false, message: '역할 조회 중 오류가 발생했습니다.' });
  }
});

// ════════════════════════════════════════════════════════
//  프로젝트 팀(부서) 관리 — /:memberId 보다 먼저 매칭되어야 함
// ════════════════════════════════════════════════════════

// GET /api/v1/projects/:projectId/members/teams
router.get('/teams', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const teams = await prisma.projectTeam.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { teamName: 'asc' }],
    });
    res.json({ success: true, data: teams.map(t => ({ ...t, teamId: Number(t.teamId), projectId: Number(t.projectId) })) });
  } catch (err) {
    res.status(500).json({ success: false, message: '팀 목록 조회 실패' });
  }
});

router.post('/teams', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin) { res.status(403).json({ success: false, message: '팀 관리는 PMSAdmin만 가능합니다.' }); return; }
    const { teamName } = req.body;
    if (!teamName) { res.status(400).json({ success: false, message: '팀명은 필수입니다.' }); return; }
    const maxOrder = await prisma.projectTeam.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    const team = await prisma.projectTeam.create({ data: { projectId, teamName, sortOrder: (maxOrder._max.sortOrder || 0) + 1 } });
    res.status(201).json({ success: true, data: { ...team, teamId: Number(team.teamId), projectId: Number(team.projectId) }, message: '팀이 생성되었습니다.' });
  } catch (err: any) {
    if (err.code === 'P2002') { res.status(409).json({ success: false, message: '이미 존재하는 팀명입니다.' }); return; }
    res.status(500).json({ success: false, message: '팀 생성 실패' });
  }
});

router.put('/teams/:teamId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin) { res.status(403).json({ success: false, message: '팀 관리는 PMSAdmin만 가능합니다.' }); return; }
    const teamId = BigInt(req.params.teamId);
    const { teamName, sortOrder } = req.body;
    const data: any = {};
    if (teamName !== undefined) data.teamName = teamName;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    const updated = await prisma.projectTeam.update({ where: { teamId }, data });
    res.json({ success: true, data: { ...updated, teamId: Number(updated.teamId), projectId: Number(updated.projectId) } });
  } catch (err) { res.status(500).json({ success: false, message: '팀 수정 실패' }); }
});

router.delete('/teams/:teamId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin) { res.status(403).json({ success: false, message: '팀 관리는 PMSAdmin만 가능합니다.' }); return; }
    const teamId = BigInt(req.params.teamId);
    await prisma.projectTeam.delete({ where: { teamId } });
    res.json({ success: true, message: '팀이 삭제되었습니다.' });
  } catch (err) { res.status(500).json({ success: false, message: '팀 삭제 실패' }); }
});

// POST /api/v1/projects/:projectId/members — 투입인력 등록
router.post('/', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin) {
      res.status(403).json({ success: false, message: '투입인력 관리는 PMS관리자만 가능합니다.' });
      return;
    }
    const { userId, role, joinDate, leaveDate, manMonth } = req.body;

    if (!userId || !role || !joinDate) {
      res.status(400).json({ success: false, message: '사용자, 역할, 투입일은 필수입니다.' });
      return;
    }

    // 중복 체크
    const existing = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (existing) {
      res.status(409).json({ success: false, message: '이미 투입된 인력입니다.' });
      return;
    }

    // M/M: 수동 입력이 없으면 자동산정 (투입일~철수일 기반)
    const autoMM = (manMonth !== undefined && manMonth !== null && manMonth !== '' && Number(manMonth) > 0)
      ? manMonth
      : calcManMonth(joinDate, leaveDate);

    const member = await prisma.projectMember.create({
      data: {
        projectId,
        userId,
        role,
        joinDate: new Date(joinDate),
        leaveDate: leaveDate ? new Date(leaveDate) : null,
        manMonth: autoMM,
      },
      include: {
        user: { select: { userId: true, userName: true, department: true, position: true, phone: true, email: true, address: true, photoPath: true, isActive: true } },
      },
    });

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'CREATE',
      targetType: 'project_member',
      targetId: member.memberId,
      changeDetail: { projectId: Number(projectId), userId, role },
    });

    // Rocket.Chat 프로젝트 채널에 자동 초대
    try {
      const proj = await prisma.project.findUnique({ where: { projectId }, select: { rcChannelId: true } });
      const rcUser = await prisma.user.findUnique({ where: { userId }, select: { rcUserId: true } });
      if (proj?.rcChannelId && rcUser?.rcUserId) {
        await addMemberToChannel(proj.rcChannelId, rcUser.rcUserId);
      }
    } catch {}

    res.status(201).json({ success: true, data: serializeMember(member), message: '인력이 투입되었습니다.' });
  } catch (err) {
    console.error('Member create error:', err);
    res.status(500).json({ success: false, message: '인력 투입 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/projects/:projectId/members/:memberId — 투입인력 수정
router.put('/:memberId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    const memberId = BigInt(req.params.memberId);
    const { role, joinDate, leaveDate, manMonth } = req.body;

    // 비상연락망 토글은 PMS관리자가 아니어도 허용
    const isOnlyEmergencyToggle = Object.keys(req.body).length === 1 && req.body.isEmergency !== undefined;
    if (!roleInfo.isPmsAdmin && !isOnlyEmergencyToggle) {
      res.status(403).json({ success: false, message: '투입인력 관리는 PMS관리자만 가능합니다.' });
      return;
    }

    const existing = await prisma.projectMember.findUnique({ where: { memberId } });
    if (!existing) {
      res.status(404).json({ success: false, message: '인력을 찾을 수 없습니다.' });
      return;
    }

    const data: any = {};
    if (role !== undefined) data.role = role;
    if (joinDate !== undefined) data.joinDate = new Date(joinDate);
    if (req.body.isEmergency !== undefined) data.isEmergency = req.body.isEmergency;
    if (req.body.reportToId !== undefined) data.reportToId = req.body.reportToId ? BigInt(req.body.reportToId) : null;
    if (leaveDate !== undefined) data.leaveDate = leaveDate ? new Date(leaveDate) : null;

    // M/M 자동 재산정: 날짜가 변경되었고 수동 M/M 입력이 없으면 자동 계산
    const finalJoin = joinDate || existing.joinDate;
    const finalLeave = leaveDate !== undefined ? (leaveDate || null) : existing.leaveDate;

    if (manMonth !== undefined && manMonth !== null && manMonth !== '' && Number(manMonth) > 0) {
      data.manMonth = manMonth;
    } else {
      // M/M 자동 산정 (투입일~철수일 기반)
      data.manMonth = calcManMonth(finalJoin, finalLeave);
    }

    const updated = await prisma.projectMember.update({
      where: { memberId },
      data,
      include: {
        user: { select: { userId: true, userName: true, department: true, position: true, phone: true, email: true, address: true, photoPath: true, isActive: true } },
      },
    });

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'UPDATE',
      targetType: 'project_member',
      targetId: memberId,
      changeDetail: { fields: Object.keys(data) },
    });

    res.json({ success: true, data: serializeMember(updated), message: '인력 정보가 수정되었습니다.' });
  } catch (err) {
    console.error('Member update error:', err);
    res.status(500).json({ success: false, message: '인력 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/v1/projects/:projectId/members/:memberId — 투입인력 철수
router.delete('/:memberId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin) {
      res.status(403).json({ success: false, message: '투입인력 관리는 PMS관리자만 가능합니다.' });
      return;
    }
    const memberId = BigInt(req.params.memberId);

    // RC 채널에서 제거 (삭제 전 userId 확보)
    const memberToDelete = await prisma.projectMember.findUnique({ where: { memberId }, select: { userId: true } });

    await prisma.projectMember.delete({ where: { memberId } });

    // Rocket.Chat 채널에서 제외
    if (memberToDelete) {
      try {
        const proj = await prisma.project.findUnique({ where: { projectId }, select: { rcChannelId: true } });
        const rcUser = await prisma.user.findUnique({ where: { userId: memberToDelete.userId }, select: { rcUserId: true } });
        if (proj?.rcChannelId && rcUser?.rcUserId) {
          await removeMemberFromChannel(proj.rcChannelId, rcUser.rcUserId);
        }
      } catch {}
    }

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'DELETE',
      targetType: 'project_member',
      targetId: memberId,
    });

    res.json({ success: true, data: null, message: '인력이 철수되었습니다.' });
  } catch (err) {
    console.error('Member delete error:', err);
    res.status(500).json({ success: false, message: '인력 철수 중 오류가 발생했습니다.' });
  }
});

// GET /export/excel — 투입인력 엑셀 다운로드
router.get('/export/excel', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId as string);
    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { userId: true, userName: true, department: true, position: true, phone: true, email: true, address: true } } },
      orderBy: [{ memberId: 'asc' }],
    });

    const ROLE_LABELS: Record<string, string> = {
      PM: 'Project Manager', PL: 'Team Leader', TM: 'Team Member',
      QA: 'Quality Assurance', Customer: 'Customer', PMO: 'PMO',
      Inspector: 'Inspector', PMSAdmin: 'PMS Admin',
      TA: 'Technical Architect', AA: 'Application Architect',
      DBA: 'DataBase Architect', DA: 'Data Architect',
    };

    const rows = members.map((m, idx) => ({
      'No': idx + 1,
      '이름': m.user?.userName || '',
      '소속팀': m.user?.department || '',
      '직위': m.user?.position || '',
      '역할': m.role,
      '역할(영문)': ROLE_LABELS[m.role] || m.role,
      '투입일': m.joinDate ? m.joinDate.toISOString().substring(0, 10) : '',
      '철수일': m.leaveDate ? m.leaveDate.toISOString().substring(0, 10) : '',
      'M/M': Number(m.manMonth).toFixed(1),
      '연락처': m.user?.phone || '',
      '이메일': m.user?.email || '',
      '주소': m.user?.address || '',
      '비상연락망': m.isEmergency ? 'Y' : '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '투입인력');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=members.xlsx');
    res.send(buf);
  } catch (err) {
    console.error('Member export error:', err);
    res.status(500).json({ success: false, message: '엑셀 다운로드 중 오류' });
  }
});

export default router;
