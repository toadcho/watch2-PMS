import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';

const router = Router({ mergeParams: true });
router.use(authenticate);

function serialize(r: any) {
  return { ...r, issueId: Number(r.issueId), projectId: Number(r.projectId), relatedRiskId: r.relatedRiskId ? Number(r.relatedRiskId) : null,
    statusHistory: r.statusHistory?.map((h: any) => ({ ...h, historyId: Number(h.historyId), issueId: Number(h.issueId) })) };
}

const FIELDS = [
  'issueTitle', 'category', 'subType', 'phase', 'teamDept', 'content', 'impact',
  'importance', 'urgency', 'status', 'assigneeName', 'relatedClient',
  'resolution', 'shareTarget', 'internalExternal',
  'requestToClient', 'requestFromClient', 'remark',
];

// GET /
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const { status, category, importance, urgency, phase, keyword, page, size } = req.query;
    const pn = Math.max(1, parseInt(page as string) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(size as string) || 50));
    const where: any = { projectId };
    if (status) where.status = status;
    if (category) where.category = category;
    if (importance) where.importance = importance;
    if (urgency) where.urgency = urgency;
    if (phase) where.phase = phase;
    if (keyword) where.OR = [{ issueTitle: { contains: keyword as string, mode: 'insensitive' } }, { content: { contains: keyword as string, mode: 'insensitive' } }];
    const [items, total] = await Promise.all([
      prisma.issue.findMany({ where, orderBy: { issueId: 'desc' }, skip: (pn - 1) * ps, take: ps }),
      prisma.issue.count({ where }),
    ]);
    res.json({ success: true, data: items.map(serialize), pagination: { page: pn, size: ps, totalCount: total, totalPages: Math.ceil(total / ps) } });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: '이슈 조회 중 오류가 발생했습니다.' }); }
});

// GET /:issueId
router.get('/:issueId', async (req: Request, res: Response) => {
  try {
    const item = await prisma.issue.findUnique({ where: { issueId: BigInt(req.params.issueId) }, include: { statusHistory: { orderBy: { changeDate: 'desc' } } } });
    if (!item) { res.status(404).json({ success: false, message: '이슈를 찾을 수 없습니다.' }); return; }
    const s = serialize(item);
    // 등록자명 + 상태이력 변경자명 매핑
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
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: '이슈 조회 중 오류가 발생했습니다.' }); }
});

// POST /
router.post('/', async (req: Request, res: Response) => {
  try {
    const cu = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const b = req.body;
    if (!b.issueTitle) { res.status(400).json({ success: false, message: '이슈 제목은 필수입니다.' }); return; }
    const data: any = { projectId, createdBy: cu.userId };
    for (const f of FIELDS) { if (b[f] !== undefined) data[f] = b[f] || null; }
    if (b.identifiedAt) data.identifiedAt = new Date(b.identifiedAt);
    if (b.expectedEndAt) data.expectedEndAt = new Date(b.expectedEndAt);
    if (b.relatedRiskId) data.relatedRiskId = BigInt(b.relatedRiskId);
    const item = await prisma.issue.create({ data });
    await prisma.issueStatusHistory.create({ data: { issueId: item.issueId, status: item.status, changeContent: '초기 등록', changedBy: cu.userId } });
    await writeAuditLog({ userId: cu.userId, ipAddress: req.ip, action: 'CREATE', targetType: 'issue', targetId: item.issueId, changeDetail: { issueTitle: b.issueTitle } });
    res.status(201).json({ success: true, data: serialize(item), message: '이슈가 등록되었습니다.' });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: '이슈 등록 중 오류가 발생했습니다.' }); }
});

// PUT /:issueId
router.put('/:issueId', async (req: Request, res: Response) => {
  try {
    const cu = (req as any).user as JwtPayload;
    const issueId = BigInt(req.params.issueId);
    const b = req.body;
    const existing = await prisma.issue.findUnique({ where: { issueId } });
    if (!existing) { res.status(404).json({ success: false, message: '이슈를 찾을 수 없습니다.' }); return; }
    const data: any = {};
    for (const f of FIELDS) { if (b[f] !== undefined) data[f] = b[f] || null; }
    if (b.identifiedAt !== undefined) data.identifiedAt = b.identifiedAt ? new Date(b.identifiedAt) : null;
    if (b.expectedEndAt !== undefined) data.expectedEndAt = b.expectedEndAt ? new Date(b.expectedEndAt) : null;
    if (b.resolvedAt !== undefined) data.resolvedAt = b.resolvedAt ? new Date(b.resolvedAt) : null;
    if (b.relatedRiskId !== undefined) data.relatedRiskId = b.relatedRiskId ? BigInt(b.relatedRiskId) : null;
    if (b.status && b.status !== existing.status) {
      await prisma.issueStatusHistory.create({ data: { issueId, status: b.status, changeContent: b.statusChangeContent || null, changedBy: cu.userId } });
      if (['Solved', 'Cancelled'].includes(b.status) && !data.resolvedAt) data.resolvedAt = new Date();
    }
    const updated = await prisma.issue.update({ where: { issueId }, data });
    await writeAuditLog({ userId: cu.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'issue', targetId: issueId });
    res.json({ success: true, data: serialize(updated), message: '이슈가 수정되었습니다.' });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: '이슈 수정 중 오류가 발생했습니다.' }); }
});

// DELETE /:issueId
router.delete('/:issueId', async (req: Request, res: Response) => {
  try {
    const issueId = BigInt(req.params.issueId);
    await prisma.issueStatusHistory.deleteMany({ where: { issueId } });
    await prisma.issue.delete({ where: { issueId } });
    res.json({ success: true, message: '이슈가 삭제되었습니다.' });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: '삭제 중 오류가 발생했습니다.' }); }
});

export default router;
