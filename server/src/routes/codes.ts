import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, authorize, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';

const router = Router();
router.use(authenticate);

// GET /api/v1/codes — 공통코드 전체 목록 (코드그룹별)
router.get('/', async (req: Request, res: Response) => {
  try {
    const { codeGroup } = req.query;
    const where: any = { isActive: true };
    if (codeGroup) where.codeGroup = codeGroup;

    const codes = await prisma.commonCode.findMany({
      where,
      orderBy: [{ codeGroup: 'asc' }, { sortOrder: 'asc' }],
    });

    // 코드그룹별로 그룹핑
    if (!codeGroup) {
      const grouped: Record<string, any[]> = {};
      for (const code of codes) {
        if (!grouped[code.codeGroup]) grouped[code.codeGroup] = [];
        grouped[code.codeGroup].push(code);
      }
      res.json({ success: true, data: grouped });
    } else {
      res.json({ success: true, data: codes });
    }
  } catch (err) {
    console.error('Code list error:', err);
    res.status(500).json({ success: false, message: '공통코드 조회 중 오류가 발생했습니다.' });
  }
});

// GET /api/v1/codes/groups — 코드그룹 목록
router.get('/groups', async (_req: Request, res: Response) => {
  try {
    const codes = await prisma.commonCode.findMany({
      select: { codeGroup: true },
      distinct: ['codeGroup'],
      orderBy: { codeGroup: 'asc' },
    });
    const groups = codes.map(c => c.codeGroup);
    res.json({ success: true, data: groups });
  } catch (err) {
    console.error('Code groups error:', err);
    res.status(500).json({ success: false, message: '코드그룹 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/codes — 공통코드 등록 (관리자 전용)
router.post('/', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const { codeGroup, code, codeName, sortOrder, description } = req.body;

    if (!codeGroup || !code || !codeName) {
      res.status(400).json({ success: false, message: '코드그룹, 코드, 코드명은 필수입니다.' });
      return;
    }

    const existing = await prisma.commonCode.findUnique({
      where: { codeGroup_code: { codeGroup, code } },
    });
    if (existing) {
      res.status(409).json({ success: false, message: '이미 존재하는 코드입니다.' });
      return;
    }

    const created = await prisma.commonCode.create({
      data: {
        codeGroup, code, codeName,
        sortOrder: sortOrder || 0,
        description: description || null,
      },
    });

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'CREATE',
      targetType: 'common_code',
      changeDetail: { codeGroup, code },
    });

    res.status(201).json({ success: true, data: created, message: '공통코드가 등록되었습니다.' });
  } catch (err) {
    console.error('Code create error:', err);
    res.status(500).json({ success: false, message: '공통코드 등록 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/codes/:codeGroup/:code — 공통코드 수정
router.put('/:codeGroup/:code', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const { codeGroup, code } = req.params;
    const { codeName, sortOrder, isActive, description } = req.body;

    const existing = await prisma.commonCode.findUnique({
      where: { codeGroup_code: { codeGroup, code } },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: '공통코드를 찾을 수 없습니다.' });
      return;
    }

    const data: any = {};
    if (codeName !== undefined) data.codeName = codeName;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (isActive !== undefined) data.isActive = isActive;
    if (description !== undefined) data.description = description;

    const updated = await prisma.commonCode.update({
      where: { codeGroup_code: { codeGroup, code } },
      data,
    });

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'UPDATE',
      targetType: 'common_code',
      changeDetail: { codeGroup, code, fields: Object.keys(data) },
    });

    res.json({ success: true, data: updated, message: '공통코드가 수정되었습니다.' });
  } catch (err) {
    console.error('Code update error:', err);
    res.status(500).json({ success: false, message: '공통코드 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/v1/codes/:codeGroup/:code — 공통코드 비활성화
router.delete('/:codeGroup/:code', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const { codeGroup, code } = req.params;

    await prisma.commonCode.update({
      where: { codeGroup_code: { codeGroup, code } },
      data: { isActive: false },
    });

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'DELETE',
      targetType: 'common_code',
      changeDetail: { codeGroup, code },
    });

    res.json({ success: true, data: null, message: '공통코드가 비활성화되었습니다.' });
  } catch (err) {
    console.error('Code delete error:', err);
    res.status(500).json({ success: false, message: '공통코드 삭제 중 오류가 발생했습니다.' });
  }
});

export default router;
