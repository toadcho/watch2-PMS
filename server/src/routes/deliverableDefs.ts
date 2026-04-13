import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';

const router = Router({ mergeParams: true });
router.use(authenticate);

// GET /api/v1/deliverable-masters — 마스터 산출물 전체 목록
router.get('/masters', async (_req: Request, res: Response) => {
  try {
    const masters = await prisma.deliverableMaster.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    res.json({
      success: true,
      data: masters.map(m => ({ ...m, masterId: Number(m.masterId) })),
    });
  } catch (err) {
    console.error('Master deliverable list error:', err);
    res.status(500).json({ success: false, message: '마스터 산출물 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/deliverable-masters — 마스터 산출물 추가
router.post('/masters', async (req: Request, res: Response) => {
  try {
    const { phase, docCode, docName, mandatory, description, remark } = req.body;
    if (!phase || !docCode || !docName) {
      res.status(400).json({ success: false, message: '단계, 산출물코드, 산출물명은 필수입니다.' });
      return;
    }
    const maxOrder = await prisma.deliverableMaster.aggregate({ _max: { sortOrder: true } });
    const item = await prisma.deliverableMaster.create({
      data: { phase, docCode, docName, mandatory: mandatory || '선택', description: description || null, remark: remark || null, sortOrder: (maxOrder._max.sortOrder || 0) + 1 },
    });
    res.status(201).json({ success: true, data: { ...item, masterId: Number(item.masterId) }, message: '산출물이 추가되었습니다.' });
  } catch (err: any) {
    if (err.code === 'P2002') { res.status(409).json({ success: false, message: '이미 존재하는 산출물 코드입니다.' }); return; }
    console.error('Master create error:', err);
    res.status(500).json({ success: false, message: '산출물 추가 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/deliverable-masters/:masterId — 마스터 산출물 수정
router.put('/masters/:masterId', async (req: Request, res: Response) => {
  try {
    const masterId = BigInt(req.params.masterId);
    const { phase, docCode, docName, mandatory, description, remark } = req.body;
    const data: any = {};
    if (phase !== undefined) data.phase = phase;
    if (docCode !== undefined) data.docCode = docCode;
    if (docName !== undefined) data.docName = docName;
    if (mandatory !== undefined) data.mandatory = mandatory;
    if (description !== undefined) data.description = description;
    if (remark !== undefined) data.remark = remark;

    const updated = await prisma.deliverableMaster.update({ where: { masterId }, data });
    res.json({ success: true, data: { ...updated, masterId: Number(updated.masterId) }, message: '산출물이 수정되었습니다.' });
  } catch (err) {
    console.error('Master update error:', err);
    res.status(500).json({ success: false, message: '산출물 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/v1/deliverable-masters/:masterId — 마스터 산출물 삭제
router.delete('/masters/:masterId', async (req: Request, res: Response) => {
  try {
    const masterId = BigInt(req.params.masterId);
    // 프로젝트에서 사용 중인지 확인
    const usageCount = await prisma.projectDeliverable.count({ where: { masterId } });
    if (usageCount > 0) {
      res.status(409).json({ success: false, message: `${usageCount}개 프로젝트에서 사용 중이므로 삭제할 수 없습니다.` });
      return;
    }
    await prisma.deliverableMaster.delete({ where: { masterId } });
    res.json({ success: true, message: '산출물이 삭제되었습니다.' });
  } catch (err) {
    console.error('Master delete error:', err);
    res.status(500).json({ success: false, message: '산출물 삭제 중 오류가 발생했습니다.' });
  }
});

// GET /api/v1/projects/:projectId/deliverable-defs — 프로젝트 산출물 정의 조회
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const defs = await prisma.projectDeliverable.findMany({
      where: { projectId },
      include: { master: true },
      orderBy: { master: { sortOrder: 'asc' } },
    });
    res.json({
      success: true,
      data: defs.map(d => ({
        projDelId: Number(d.projDelId),
        projectId: Number(d.projectId),
        masterId: Number(d.masterId),
        isActive: d.isActive,
        master: { ...d.master, masterId: Number(d.master.masterId) },
      })),
    });
  } catch (err) {
    console.error('Project deliverable defs error:', err);
    res.status(500).json({ success: false, message: '프로젝트 산출물 정의 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/projects/:projectId/deliverable-defs — 산출물 추가 (배열 지원)
router.post('/', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const { masterIds } = req.body; // number[]

    if (!masterIds || !Array.isArray(masterIds) || masterIds.length === 0) {
      res.status(400).json({ success: false, message: '추가할 산출물을 선택해주세요.' });
      return;
    }

    let added = 0;
    for (const mid of masterIds) {
      try {
        await prisma.projectDeliverable.create({
          data: { projectId, masterId: BigInt(mid) },
        });
        added++;
      } catch {
        // 이미 존재하면 무시
      }
    }

    res.status(201).json({ success: true, message: `${added}건의 산출물이 추가되었습니다.` });
  } catch (err) {
    console.error('Project deliverable def create error:', err);
    res.status(500).json({ success: false, message: '산출물 추가 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/v1/projects/:projectId/deliverable-defs — 산출물 제거 (배열 지원)
router.delete('/', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const { masterIds } = req.body; // number[]

    if (!masterIds || !Array.isArray(masterIds) || masterIds.length === 0) {
      res.status(400).json({ success: false, message: '제거할 산출물을 선택해주세요.' });
      return;
    }

    const result = await prisma.projectDeliverable.deleteMany({
      where: {
        projectId,
        masterId: { in: masterIds.map((id: number) => BigInt(id)) },
      },
    });

    res.json({ success: true, message: `${result.count}건의 산출물이 제거되었습니다.` });
  } catch (err) {
    console.error('Project deliverable def delete error:', err);
    res.status(500).json({ success: false, message: '산출물 제거 중 오류가 발생했습니다.' });
  }
});

export default router;
