import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, authorize } from '../middlewares/auth';

const router = Router();
router.use(authenticate);
router.use(authorize('ADMIN'));

// GET /api/v1/audit-logs — 감사로그 조회
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      page = '1', size = '20',
      userId, action, targetType,
      startDate, endDate,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string));
    const pageSize = Math.min(100, Math.max(1, parseInt(size as string)));
    const skip = (pageNum - 1) * pageSize;

    const where: any = {};
    if (userId) where.userId = { contains: userId as string, mode: 'insensitive' };
    if (action) where.action = action;
    if (targetType) where.targetType = targetType;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string + 'T23:59:59');
    }

    const [logs, totalCount] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);

    // 사용자 이름 매핑
    const userIds = [...new Set(logs.map(l => l.userId))];
    const users = await prisma.user.findMany({ where: { userId: { in: userIds } }, select: { userId: true, userName: true } });
    const userMap = Object.fromEntries(users.map(u => [u.userId, u.userName]));

    // BigInt → Number 변환 + userName 추가
    const serialized = logs.map(log => ({
      ...log,
      logId: Number(log.logId),
      targetId: log.targetId ? Number(log.targetId) : null,
      userName: userMap[log.userId] || null,
    }));

    res.json({
      success: true,
      data: serialized,
      pagination: {
        page: pageNum,
        size: pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (err) {
    console.error('AuditLog list error:', err);
    res.status(500).json({ success: false, message: '감사로그 조회 중 오류가 발생했습니다.' });
  }
});

export default router;
