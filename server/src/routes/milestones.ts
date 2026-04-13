import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';

const router = Router({ mergeParams: true });
router.use(authenticate);

function serialize(m: any) {
  return { ...m, milestoneId: Number(m.milestoneId), projectId: Number(m.projectId) };
}

// GET /api/v1/projects/:projectId/milestones
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const items = await prisma.milestone.findMany({
      where: { projectId },
      orderBy: { dueDate: 'asc' },
    });
    res.json({ success: true, data: items.map(serialize) });
  } catch (err) {
    console.error('Milestone list error:', err);
    res.status(500).json({ success: false, message: '마일스톤 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/projects/:projectId/milestones
router.post('/', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const { milestoneName, dueDate, milestoneType, description } = req.body;

    if (!milestoneName || !dueDate) {
      res.status(400).json({ success: false, message: '마일스톤명과 일자는 필수입니다.' });
      return;
    }

    const item = await prisma.milestone.create({
      data: { projectId, milestoneName, dueDate: new Date(dueDate), milestoneType: milestoneType || '기타', description: description || null },
    });

    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'CREATE', targetType: 'milestone', targetId: item.milestoneId });
    res.status(201).json({ success: true, data: serialize(item), message: '마일스톤이 등록되었습니다.' });
  } catch (err) {
    console.error('Milestone create error:', err);
    res.status(500).json({ success: false, message: '마일스톤 등록 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/projects/:projectId/milestones/:milestoneId
router.put('/:milestoneId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const milestoneId = BigInt(req.params.milestoneId);
    const { milestoneName, dueDate, milestoneType, status, description } = req.body;

    const data: any = {};
    if (milestoneName !== undefined) data.milestoneName = milestoneName;
    if (dueDate !== undefined) data.dueDate = new Date(dueDate);
    if (milestoneType !== undefined) data.milestoneType = milestoneType;
    if (status !== undefined) data.status = status;
    if (description !== undefined) data.description = description;

    const updated = await prisma.milestone.update({ where: { milestoneId }, data });
    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'milestone', targetId: milestoneId });
    res.json({ success: true, data: serialize(updated), message: '마일스톤이 수정되었습니다.' });
  } catch (err) {
    console.error('Milestone update error:', err);
    res.status(500).json({ success: false, message: '마일스톤 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/v1/projects/:projectId/milestones/:milestoneId
router.delete('/:milestoneId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const milestoneId = BigInt(req.params.milestoneId);
    await prisma.milestone.delete({ where: { milestoneId } });
    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'DELETE', targetType: 'milestone', targetId: milestoneId });
    res.json({ success: true, data: null, message: '마일스톤이 삭제되었습니다.' });
  } catch (err) {
    console.error('Milestone delete error:', err);
    res.status(500).json({ success: false, message: '마일스톤 삭제 중 오류가 발생했습니다.' });
  }
});

export default router;
