import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate } from '../middlewares/auth';

const router = Router({ mergeParams: true });
router.use(authenticate);

function pid(req: Request): bigint { return BigInt(req.params.projectId as string); }
function serialize(r: any) { return JSON.parse(JSON.stringify(r, (_k, v) => typeof v === 'bigint' ? Number(v) : v)); }

// GET / — 관리 산출물 목록
router.get('/', async (req: Request, res: Response) => {
  try {
    const items = await prisma.managementDeliverable.findMany({
      where: { projectId: pid(req) },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: items.map(serialize) });
  } catch (err) { res.status(500).json({ success: false, message: '관리 산출물 조회 오류' }); }
});

// POST / — 등록
router.post('/', async (req: Request, res: Response) => {
  try {
    const { category, docName, isCustomer, isInternal, applied, remark, sortOrder } = req.body;
    const item = await prisma.managementDeliverable.create({
      data: { projectId: pid(req), category, docName, isCustomer: !!isCustomer, isInternal: !!isInternal, applied: applied !== false, remark: remark || null, sortOrder: sortOrder || 0 },
    });
    res.status(201).json({ success: true, data: serialize(item) });
  } catch (err) { res.status(500).json({ success: false, message: '관리 산출물 등록 오류' }); }
});

// PUT /:mgmtDelId — 수정
router.put('/:mgmtDelId', async (req: Request, res: Response) => {
  try {
    const mgmtDelId = BigInt(req.params.mgmtDelId as string);
    const { category, docName, isCustomer, isInternal, applied, remark, sortOrder } = req.body;
    const data: any = {};
    if (category !== undefined) data.category = category;
    if (docName !== undefined) data.docName = docName;
    if (isCustomer !== undefined) data.isCustomer = isCustomer;
    if (isInternal !== undefined) data.isInternal = isInternal;
    if (applied !== undefined) data.applied = applied;
    if (remark !== undefined) data.remark = remark;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    const item = await prisma.managementDeliverable.update({ where: { mgmtDelId }, data });
    res.json({ success: true, data: serialize(item) });
  } catch (err) { res.status(500).json({ success: false, message: '관리 산출물 수정 오류' }); }
});

// DELETE /:mgmtDelId — 삭제
router.delete('/:mgmtDelId', async (req: Request, res: Response) => {
  try {
    await prisma.managementDeliverable.delete({ where: { mgmtDelId: BigInt(req.params.mgmtDelId as string) } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: '관리 산출물 삭제 오류' }); }
});

// PUT /batch — 일괄 수정 (적용여부 등)
router.put('/batch/update', async (req: Request, res: Response) => {
  try {
    const { items } = req.body; // [{mgmtDelId, applied, isCustomer, isInternal, remark}]
    for (const item of items) {
      const data: any = {};
      if (item.applied !== undefined) data.applied = item.applied;
      if (item.isCustomer !== undefined) data.isCustomer = item.isCustomer;
      if (item.isInternal !== undefined) data.isInternal = item.isInternal;
      if (item.remark !== undefined) data.remark = item.remark;
      await prisma.managementDeliverable.update({ where: { mgmtDelId: BigInt(item.mgmtDelId) }, data });
    }
    res.json({ success: true, message: '저장되었습니다.' });
  } catch (err) { res.status(500).json({ success: false, message: '일괄 수정 오류' }); }
});

// GET /all-deliverables — 관리산출물 + 방법론산출물 통합 목록 (WBS 태스크 산출물 선택용)
router.get('/all-deliverables', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);

    // 1. 관리 산출물 (적용된 것만)
    const mgmt = await prisma.managementDeliverable.findMany({
      where: { projectId, applied: true },
      orderBy: { sortOrder: 'asc' },
    });

    // 2. 방법론 테일러링 산출물 (적용된 것만)
    const tailored = await prisma.projectDeliverable.findMany({
      where: { projectId, applied: true },
      include: { master: true },
      orderBy: [{ master: { phase: 'asc' } }, { master: { sortOrder: 'asc' } }],
    });

    const result = [
      ...mgmt.map(m => ({
        source: 'management' as const,
        id: Number(m.mgmtDelId),
        category: m.category,
        docName: m.docName,
        phase: null,
        docCode: null,
      })),
      ...tailored.map(t => ({
        source: 'methodology' as const,
        id: Number(t.projDelId),
        category: null,
        docName: t.projectDocName || t.master.docName,
        phase: t.master.phase,
        docCode: t.master.docCode,
      })),
    ];

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, message: '산출물 통합 목록 조회 오류' }); }
});

export default router;
