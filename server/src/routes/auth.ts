import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { generateToken, generateRefreshToken, verifyToken, authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';
import { createNotification } from './notifications';
import { createRcUser, updateRcUser } from '../utils/rocketchat';

const router = Router();

// M/M 자동산정: 투입일~철수일 기간을 월 단위로 계산 (영업일 기준 22일/월)
function calcManMonth(joinDate: string | Date, leaveDate: string | Date | null | undefined): number {
  if (!leaveDate) return 0;
  const start = new Date(joinDate);
  const end = new Date(leaveDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return 0;
  let bizDays = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) bizDays++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.round((bizDays / 22) * 100) / 100;
}

// POST /api/v1/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) {
      res.status(400).json({ success: false, message: '아이디와 비밀번호를 입력해주세요.' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) {
      res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
      return;
    }
    if (!user.isActive) {
      res.status(401).json({ success: false, message: '승인 대기 중인 계정입니다. 관리자 승인 후 로그인할 수 있습니다.' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
      return;
    }

    const payload: JwtPayload = {
      userId: user.userId,
      userName: user.userName,
      email: user.email,
      systemRole: user.systemRole,
      department: user.department || undefined,
    };

    const token = generateToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // 마지막 로그인 시간 업데이트
    await prisma.user.update({
      where: { userId },
      data: { lastLoginAt: new Date() },
    });

    await writeAuditLog({
      userId: user.userId,
      ipAddress: req.ip,
      action: 'LOGIN',
      targetType: 'user',
    });

    res.json({
      success: true,
      data: {
        token,
        refreshToken,
        user: {
          userId: user.userId,
          userName: user.userName,
          email: user.email,
          systemRole: user.systemRole,
          department: user.department,
          position: user.position,
          mustChangePassword: user.mustChangePassword,
        },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/auth/register-direct — PMSAdmin이 직접 사용자 생성 + 프로젝트 투입
router.post('/register-direct', authenticate, async (req: Request, res: Response) => {
  try {
    const { userId, password, userName, department, position, phone, projectId, role, joinDate, leaveDate } = req.body;
    if (!userId || !password || !userName) {
      res.status(400).json({ success: false, message: '사용자ID, 비밀번호, 사용자명은 필수입니다.' }); return;
    }
    const existing = await prisma.user.findUnique({ where: { userId } });
    if (existing) { res.status(409).json({ success: false, message: '이미 사용 중인 아이디입니다.' }); return; }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        userId, userName, email: `${userId}@direct.local`, passwordHash,
        department: department || null, position: position || null, phone: phone || null,
        systemRole: 'USER', isActive: true, mustChangePassword: true,
        homeProjectId: projectId ? BigInt(projectId) : null,  // 프로젝트 귀속 (삭제 시 함께 삭제)
      },
    });

    // Rocket.Chat 계정 자동 생성
    try {
      const rcUser = await createRcUser({ username: userId, name: userName, email: `${userId}@pms.local`, password });
      if (rcUser) {
        await prisma.user.update({ where: { userId }, data: { rcUserId: rcUser._id, rcUsername: userId } });
      }
    } catch {}

    if (projectId) {
      const jd = joinDate ? new Date(joinDate) : new Date();
      const ld = leaveDate ? new Date(leaveDate) : null;
      await prisma.projectMember.create({
        data: {
          projectId: BigInt(projectId), userId, role: role || 'TM',
          joinDate: jd,
          leaveDate: ld,
          manMonth: calcManMonth(jd, ld),
        },
      });
    }

    res.status(201).json({ success: true, message: '사용자가 등록되었습니다.' });
  } catch (err) {
    console.error('Register direct error:', err);
    res.status(500).json({ success: false, message: '사용자 등록 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/auth/change-password — 비밀번호 변경 (첫 로그인 시)
router.post('/change-password', async (req: Request, res: Response) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;
    if (!userId || !currentPassword || !newPassword) {
      res.status(400).json({ success: false, message: '모든 항목을 입력해주세요.' }); return;
    }
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[!@#$%^&*()_+\-=]/.test(newPassword)) {
      res.status(400).json({ success: false, message: '비밀번호는 영문+숫자+특수문자 포함 8자 이상이어야 합니다.' }); return;
    }
    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) { res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' }); return; }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) { res.status(401).json({ success: false, message: '현재 비밀번호가 일치하지 않습니다.' }); return; }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { userId }, data: { passwordHash, mustChangePassword: false } });
    // RC 비밀번호 동기화
    if (user.rcUserId) { updateRcUser(user.rcUserId, { password: newPassword }).catch(() => {}); }
    res.json({ success: true, message: '비밀번호가 변경되었습니다.' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ success: false, message: '비밀번호 변경 중 오류가 발생했습니다.' });
  }
});

// GET /api/v1/auth/projects — 가입용 프로젝트 목록 (인증 불필요)
router.get('/projects', async (_req: Request, res: Response) => {
  try {
    const projects = await prisma.project.findMany({
      where: { status: { notIn: ['종료'] } },
      select: { projectId: true, projectName: true, businessNo: true },
      orderBy: { projectName: 'asc' },
    });
    res.json({ success: true, data: projects.map(p => ({ ...p, projectId: Number(p.projectId) })) });
  } catch (err) {
    res.status(500).json({ success: false, message: '프로젝트 목록 조회 실패' });
  }
});

// GET /api/v1/auth/projects/:projectId/teams — 가입용 팀 목록 (인증 불필요)
router.get('/projects/:projectId/teams', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const teams = await prisma.projectTeam.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { teamName: 'asc' }],
    });
    res.json({ success: true, data: teams.map(t => ({ teamId: Number(t.teamId), teamName: t.teamName })) });
  } catch (err) {
    res.status(500).json({ success: false, message: '팀 목록 조회 실패' });
  }
});

// POST /api/v1/auth/register — 회원가입 (승인 대기)
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { userId, password, userName, phone, department, projectId } = req.body;

    // 필수값 검증
    if (!userId || !password || !userName || !phone || !department || !projectId) {
      res.status(400).json({ success: false, message: '모든 필수 항목을 입력해주세요.' });
      return;
    }

    // 아이디 형식 검증
    if (!/^[a-zA-Z0-9]{4,20}$/.test(userId)) {
      res.status(400).json({ success: false, message: '아이디는 영문+숫자 4~20자로 입력해주세요.' });
      return;
    }

    // 비밀번호 강도 검증
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*()_+\-=]/.test(password)) {
      res.status(400).json({ success: false, message: '비밀번호는 영문+숫자+특수문자 포함 8자 이상이어야 합니다.' });
      return;
    }

    // 중복 확인
    const existing = await prisma.user.findUnique({ where: { userId } });
    if (existing) {
      res.status(409).json({ success: false, message: '이미 사용 중인 아이디입니다.' });
      return;
    }

    // 프로젝트 존재 확인
    const project = await prisma.project.findUnique({ where: { projectId: BigInt(projectId) } });
    if (!project) {
      res.status(400).json({ success: false, message: '유효하지 않은 프로젝트입니다.' });
      return;
    }

    // 사용자 생성 (isActive: false → 승인 대기)
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        userId,
        userName,
        email: `${userId}@pending.local`, // 이메일 필수 필드 대응 (사용 안 함)
        passwordHash,
        department,
        phone: phone || null,
        systemRole: 'USER',
        isActive: false, // 승인 대기
        homeProjectId: BigInt(projectId),  // 프로젝트 귀속 (삭제 시 함께 삭제)
      },
    });

    // Rocket.Chat 계정 자동 생성
    try {
      const rcUser = await createRcUser({ username: userId, name: userName, email: `${userId}@pms.local`, password });
      if (rcUser) {
        await prisma.user.update({ where: { userId }, data: { rcUserId: rcUser._id, rcUsername: userId } });
      }
    } catch {}

    // 프로젝트 멤버로 등록 (TM 역할, 승인 후 변경 가능)
    await prisma.projectMember.create({
      data: {
        projectId: BigInt(projectId),
        userId,
        role: 'TM',
        joinDate: new Date(),
      },
    });

    // PMSAdmin + 시스템관리자에게 알림
    const sysAdmins = await prisma.user.findMany({ where: { systemRole: 'ADMIN', isActive: true }, select: { userId: true } });
    const pmsAdmins = await prisma.projectMember.findMany({ where: { projectId: BigInt(projectId), role: 'PMSAdmin' }, select: { userId: true } });
    const adminIds = new Set([...sysAdmins.map(a => a.userId), ...pmsAdmins.map(a => a.userId)]);
    for (const adminId of adminIds) {
      await createNotification({
        userId: adminId,
        projectId: BigInt(projectId),
        type: 'register_request',
        title: `[회원가입] ${userName} (${userId})`,
        message: `${department} · ${phone} — 승인이 필요합니다.`,
        link: `/projects/${Number(projectId)}/resources`,
      });
    }

    res.status(201).json({
      success: true,
      message: '회원가입이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.',
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: '회원가입 처리 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/auth/check-id — 아이디 중복 확인 (인증 불필요)
router.post('/check-id', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (!userId) { res.status(400).json({ success: false, message: '아이디를 입력해주세요.' }); return; }
    const existing = await prisma.user.findUnique({ where: { userId } });
    res.json({ success: true, data: { available: !existing } });
  } catch (err) {
    res.status(500).json({ success: false, message: '확인 중 오류' });
  }
});

// GET /api/v1/auth/quick-login-users — 퀵로그인 사용자 목록 (인증 불필요)
router.get('/quick-login-users', async (_req: Request, res: Response) => {
  try {
    // 활성 프로젝트의 투입인력 + 시스템관리자
    const members = await prisma.projectMember.findMany({
      include: {
        user: { select: { userId: true, userName: true, department: true, position: true, systemRole: true, isActive: true } },
        project: { select: { projectId: true, projectName: true } },
      },
      orderBy: { joinDate: 'asc' },
    });

    const admins = await prisma.user.findMany({
      where: { systemRole: 'ADMIN', isActive: true },
      select: { userId: true, userName: true, department: true, position: true, systemRole: true },
    });

    // 부서별 그룹핑
    const userMap = new Map<string, any>();
    for (const a of admins) {
      userMap.set(a.userId, { ...a, role: '시스템관리자', projectName: null });
    }
    for (const m of members) {
      if (!m.user.isActive) continue;
      if (!userMap.has(m.user.userId)) {
        userMap.set(m.user.userId, { ...m.user, role: m.role, projectName: m.project.projectName });
      }
    }

    res.json({ success: true, data: Array.from(userMap.values()) });
  } catch (err) {
    console.error('Quick login users error:', err);
    res.status(500).json({ success: false, message: '사용자 목록 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/auth/quick-login — 퀵로그인 (userId만으로 로그인)
router.post('/quick-login', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (!userId) { res.status(400).json({ success: false, message: 'userId 필수' }); return; }

    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
      return;
    }

    const payload: JwtPayload = {
      userId: user.userId,
      userName: user.userName,
      email: user.email,
      systemRole: user.systemRole,
      department: user.department || undefined,
    };

    const token = generateToken(payload);
    const refreshToken = generateRefreshToken(payload);

    await prisma.user.update({ where: { userId }, data: { lastLoginAt: new Date() } });

    res.json({
      success: true,
      data: {
        token, refreshToken,
        user: {
          userId: user.userId, userName: user.userName, email: user.email,
          systemRole: user.systemRole, department: user.department, position: user.position,
        },
      },
    });
  } catch (err) {
    console.error('Quick login error:', err);
    res.status(500).json({ success: false, message: '퀵로그인 처리 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ success: false, message: 'Refresh token이 필요합니다.' });
      return;
    }

    const decoded = verifyToken(refreshToken);
    const user = await prisma.user.findUnique({ where: { userId: decoded.userId } });
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: '유효하지 않은 사용자입니다.' });
      return;
    }

    const payload: JwtPayload = {
      userId: user.userId,
      userName: user.userName,
      email: user.email,
      systemRole: user.systemRole,
      department: user.department || undefined,
    };

    const token = generateToken(payload);
    res.json({ success: true, data: { token } });
  } catch {
    res.status(401).json({ success: false, message: 'Refresh token이 만료되었습니다.' });
  }
});

// PUT /api/v1/auth/password
router.put('/password', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ success: false, message: '현재 비밀번호와 새 비밀번호를 입력해주세요.' });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ success: false, message: '비밀번호는 최소 8자 이상이어야 합니다.' });
      return;
    }

    const dbUser = await prisma.user.findUnique({ where: { userId: user.userId } });
    if (!dbUser) {
      res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, dbUser.passwordHash);
    if (!valid) {
      res.status(400).json({ success: false, message: '현재 비밀번호가 올바르지 않습니다.' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { userId: user.userId },
      data: { passwordHash: newHash },
    });

    // RC 비밀번호 동기화
    if (dbUser.rcUserId) { updateRcUser(dbUser.rcUserId, { password: newPassword }).catch(() => {}); }

    await writeAuditLog({
      userId: user.userId,
      ipAddress: req.ip,
      action: 'UPDATE',
      targetType: 'user',
      changeDetail: { field: 'password' },
    });

    res.json({ success: true, data: null, message: '비밀번호가 변경되었습니다.' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ success: false, message: '비밀번호 변경 중 오류가 발생했습니다.' });
  }
});

export default router;
