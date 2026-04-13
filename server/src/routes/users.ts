import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { authenticate, authorize, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';
import { setRcUserActive } from '../utils/rocketchat';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const photoDir = path.join(process.cwd(), 'uploads', 'photos');
if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });
const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, photoDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${path.extname(file.originalname)}`),
});
const photoUpload = multer({ storage: photoStorage, limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();

// 모든 라우트에 인증 필요
router.use(authenticate);

// GET /api/v1/users — 사용자 목록
router.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', size = '20', keyword, systemRole, isActive } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const pageSize = Math.min(100, Math.max(1, parseInt(size as string)));
    const skip = (pageNum - 1) * pageSize;

    const where: any = {};
    if (keyword) {
      where.OR = [
        { userName: { contains: keyword as string, mode: 'insensitive' } },
        { userId: { contains: keyword as string, mode: 'insensitive' } },
        { email: { contains: keyword as string, mode: 'insensitive' } },
        { department: { contains: keyword as string, mode: 'insensitive' } },
      ];
    }
    if (systemRole) where.systemRole = systemRole;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          userId: true, userName: true, email: true, department: true,
          position: true, phone: true, systemRole: true, isActive: true,
          lastLoginAt: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: users,
      pagination: {
        page: pageNum,
        size: pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (err) {
    console.error('User list error:', err);
    res.status(500).json({ success: false, message: '사용자 목록 조회 중 오류가 발생했습니다.' });
  }
});

// GET /api/v1/users/:userId — 사용자 상세
router.get('/:userId', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { userId: req.params.userId },
      select: {
        userId: true, userName: true, email: true, department: true,
        position: true, phone: true, systemRole: true, isActive: true,
        lastLoginAt: true, createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
      return;
    }

    res.json({ success: true, data: user });
  } catch (err) {
    console.error('User detail error:', err);
    res.status(500).json({ success: false, message: '사용자 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/users — 사용자 생성 (관리자 전용)
router.post('/', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const { userId, userName, email, password, department, position, phone, systemRole, projectId, projectRole } = req.body;

    if (!userId || !userName || !password) {
      res.status(400).json({ success: false, message: '필수 항목을 입력해주세요. (아이디, 이름, 비밀번호)' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { userId } });
    if (existing) {
      res.status(409).json({ success: false, message: '이미 존재하는 아이디입니다.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: {
        userId, userName,
        email: email || `${userId}@system.local`,
        passwordHash,
        department: department || null,
        position: position || null,
        phone: phone || null,
        systemRole: systemRole || 'USER',
        isActive: true, // 시스템관리자가 직접 생성 → 즉시 활성
        mustChangePassword: true, // 첫 로그인 시 비밀번호 변경 강제
      },
      select: {
        userId: true, userName: true, email: true, department: true,
        position: true, phone: true, systemRole: true, isActive: true, createdAt: true,
      },
    });

    // 프로젝트 멤버 등록
    if (projectId && projectRole) {
      await prisma.projectMember.create({
        data: {
          projectId: BigInt(projectId),
          userId,
          role: projectRole,
          joinDate: new Date(),
        },
      });
    }

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'CREATE',
      targetType: 'user',
      changeDetail: { created: userId, projectId, projectRole },
    });

    res.status(201).json({ success: true, data: newUser, message: '사용자가 등록되었습니다.' });
  } catch (err) {
    console.error('User create error:', err);
    res.status(500).json({ success: false, message: '사용자 생성 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/users/:userId — 사용자 수정 (관리자 전용)
router.put('/:userId', authenticate, async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const { userId: targetId } = req.params;
    const { userName, email, department, position, phone, systemRole, isActive, password } = req.body;

    const existing = await prisma.user.findUnique({ where: { userId: targetId } });
    if (!existing) {
      res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
      return;
    }

    const data: any = {};
    if (userName !== undefined) data.userName = userName;
    if (email !== undefined) data.email = email;
    if (department !== undefined) data.department = department;
    if (position !== undefined) data.position = position;
    if (phone !== undefined) data.phone = phone;
    if (req.body.address !== undefined) data.address = req.body.address;
    if (req.body.photoPath !== undefined) data.photoPath = req.body.photoPath;
    if (systemRole !== undefined) data.systemRole = systemRole;
    if (isActive !== undefined) data.isActive = isActive;
    if (password) { data.passwordHash = await bcrypt.hash(password, 10); data.mustChangePassword = true; }

    const updated = await prisma.user.update({
      where: { userId: targetId },
      data,
      select: {
        userId: true, userName: true, email: true, department: true,
        position: true, phone: true, address: true, photoPath: true,
        systemRole: true, isActive: true, createdAt: true,
      },
    });

    // RC 활성화 상태 동기화 (isActive 변경 시)
    if (isActive !== undefined) {
      const dbUser = await prisma.user.findUnique({ where: { userId: targetId }, select: { rcUserId: true } });
      if (dbUser?.rcUserId) {
        try { await setRcUserActive(dbUser.rcUserId, isActive); } catch {}
      }
    }

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'UPDATE',
      targetType: 'user',
      changeDetail: { updated: targetId, fields: Object.keys(data) },
    });

    res.json({ success: true, data: updated, message: '사용자 정보가 수정되었습니다.' });
  } catch (err) {
    console.error('User update error:', err);
    res.status(500).json({ success: false, message: '사용자 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/v1/users/:userId — 사용자 비활성화 (관리자 전용)
router.delete('/:userId', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const { userId: targetId } = req.params;

    if (targetId === currentUser.userId) {
      res.status(400).json({ success: false, message: '자기 자신은 삭제할 수 없습니다.' });
      return;
    }

    // 대상 사용자 정보 조회 (RC 비활성화용)
    const targetUser = await prisma.user.findUnique({ where: { userId: targetId }, select: { rcUserId: true } });

    // 프로젝트 멤버에서도 제거
    await prisma.projectMember.deleteMany({ where: { userId: targetId } });

    await prisma.user.update({
      where: { userId: targetId },
      data: { isActive: false },
    });

    // Rocket.Chat 계정 비활성화 (best-effort, 실패해도 진행)
    if (targetUser?.rcUserId) {
      try { await setRcUserActive(targetUser.rcUserId, false); } catch {}
    }

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'DELETE',
      targetType: 'user',
      changeDetail: { deactivated: targetId },
    });

    res.json({ success: true, data: null, message: '사용자가 비활성화되었습니다.' });
  } catch (err) {
    console.error('User delete error:', err);
    res.status(500).json({ success: false, message: '사용자 삭제 중 오류가 발생했습니다.' });
  }
});

// POST /:userId/photo — 사진 업로드
router.post('/:userId/photo', authenticate, photoUpload.single('photo'), async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const file = (req as any).file as Express.Multer.File;
    if (!file) { res.status(400).json({ success: false, message: '사진 파일을 첨부하세요.' }); return; }

    const photoPath = `/uploads/photos/${file.filename}`;

    // 기존 사진 삭제
    const user = await prisma.user.findUnique({ where: { userId }, select: { photoPath: true } });
    if (user?.photoPath) {
      const old = path.join(process.cwd(), user.photoPath);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }

    await prisma.user.update({ where: { userId }, data: { photoPath } });
    res.json({ success: true, data: { photoPath } });
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ success: false, message: '사진 업로드 중 오류' });
  }
});

export default router;
