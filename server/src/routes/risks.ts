import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';

const router = Router({ mergeParams: true });
router.use(authenticate);

function serialize(r: any) {
  return { ...r, riskId: Number(r.riskId), projectId: Number(r.projectId),
    statusHistory: r.statusHistory?.map((h: any) => ({ ...h, historyId: Number(h.historyId), riskId: Number(h.riskId) })) };
}

const FIELDS = [
  'riskName', 'category', 'subType', 'phase', 'teamDept', 'content', 'impact',
  'impactLevel', 'probability', 'approach', 'status', 'assigneeName', 'relatedClient',
  'expectedAt', 'actionHistory', 'contingencyPlan', 'shareTarget', 'internalExternal', 'occurrenceRate', 'remark',
];

// GET /
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const { status, category, importance, phase, keyword, page, size } = req.query;
    const pn = Math.max(1, parseInt(page as string) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(size as string) || 50));
    const where: any = { projectId };
    if (status) where.status = status;
    if (category) where.category = category;
    if (importance) where.impactLevel = importance;
    if (phase) where.phase = phase;
    if (keyword) where.OR = [{ riskName: { contains: keyword as string, mode: 'insensitive' } }, { content: { contains: keyword as string, mode: 'insensitive' } }];
    const [items, total] = await Promise.all([
      prisma.risk.findMany({ where, orderBy: { riskId: 'desc' }, skip: (pn - 1) * ps, take: ps }),
      prisma.risk.count({ where }),
    ]);
    res.json({ success: true, data: items.map(serialize), pagination: { page: pn, size: ps, totalCount: total, totalPages: Math.ceil(total / ps) } });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: '리스크 조회 중 오류가 발생했습니다.' }); }
});

// GET /:riskId
router.get('/:riskId', async (req: Request, res: Response) => {
  try {
    const item = await prisma.risk.findUnique({ where: { riskId: BigInt(req.params.riskId) }, include: { statusHistory: { orderBy: { changeDate: 'desc' } } } });
    if (!item) { res.status(404).json({ success: false, message: '리스크를 찾을 수 없습니다.' }); return; }
    const s = serialize(item);
    const userIdsToResolve = new Set<string>();
    if (s.createdBy) userIdsToResolve.add(s.createdBy);
    if (s.statusHistory?.length) s.statusHistory.forEach((h: any) => userIdsToResolve.add(h.changedBy));
    if (userIdsToResolve.size) {
      const users = await prisma.user.findMany({ where: { userId: { in: [...userIdsToResolve] } }, select: { userId: true, userName: true } });
      const um = new Map(users.map((u: any) => [u.userId, u.userName]));
      if (s.createdBy) s.createdByName = um.get(s.createdBy) || s.createdBy;
      if (s.statusHistory?.length) s.statusHistory = s.statusHistory.map((h: any) => ({ ...h, changedByName: um.get(h.changedBy) || h.changedBy }));
    }
    res.json({ success: true, data: s });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: '리스크 조회 중 오류가 발생했습니다.' }); }
});

// POST /
router.post('/', async (req: Request, res: Response) => {
  try {
    const cu = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const b = req.body;
    if (!b.riskName) { res.status(400).json({ success: false, message: '리스크 제목은 필수입니다.' }); return; }
    const data: any = { projectId, createdBy: cu.userId, impactLevel: b.impactLevel || '중', probability: b.probability || '중' };
    for (const f of FIELDS) { if (b[f] !== undefined) data[f] = b[f] || null; }
    if (b.identifiedAt) data.identifiedAt = new Date(b.identifiedAt);
    const item = await prisma.risk.create({ data });
    await prisma.riskStatusHistory.create({ data: { riskId: item.riskId, status: item.status, changeContent: '초기 등록', changedBy: cu.userId } });
    await writeAuditLog({ userId: cu.userId, ipAddress: req.ip, action: 'CREATE', targetType: 'risk', targetId: item.riskId, changeDetail: { riskName: b.riskName } });
    res.status(201).json({ success: true, data: serialize(item), message: '리스크가 등록되었습니다.' });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: '리스크 등록 중 오류가 발생했습니다.' }); }
});

// PUT /:riskId
router.put('/:riskId', async (req: Request, res: Response) => {
  try {
    const cu = (req as any).user as JwtPayload;
    const riskId = BigInt(req.params.riskId);
    const b = req.body;
    const existing = await prisma.risk.findUnique({ where: { riskId } });
    if (!existing) { res.status(404).json({ success: false, message: '리스크를 찾을 수 없습니다.' }); return; }
    const data: any = {};
    for (const f of FIELDS) { if (b[f] !== undefined) data[f] = b[f] || null; }
    if (b.identifiedAt !== undefined) data.identifiedAt = b.identifiedAt ? new Date(b.identifiedAt) : null;
    if (b.resolvedAt !== undefined) data.resolvedAt = b.resolvedAt ? new Date(b.resolvedAt) : null;
    if (b.status && b.status !== existing.status) {
      await prisma.riskStatusHistory.create({ data: { riskId, status: b.status, changeContent: b.statusChangeContent || null, changedBy: cu.userId } });
      if (['Resolved', 'Closed'].includes(b.status) && !data.resolvedAt) data.resolvedAt = new Date();
    }
    const updated = await prisma.risk.update({ where: { riskId }, data });
    await writeAuditLog({ userId: cu.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'risk', targetId: riskId });
    res.json({ success: true, data: serialize(updated), message: '리스크가 수정되었습니다.' });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: '리스크 수정 중 오류가 발생했습니다.' }); }
});

// DELETE /:riskId
router.delete('/:riskId', async (req: Request, res: Response) => {
  try {
    const riskId = BigInt(req.params.riskId);
    await prisma.riskStatusHistory.deleteMany({ where: { riskId } });
    await prisma.risk.delete({ where: { riskId } });
    res.json({ success: true, message: '리스크가 삭제되었습니다.' });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: '삭제 중 오류가 발생했습니다.' }); }
});

export default router;
