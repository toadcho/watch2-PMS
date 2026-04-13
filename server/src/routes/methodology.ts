import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const router = Router();
router.use(authenticate);

// ═══ 방법론 CRUD ═══

// GET /api/v1/methodologies
router.get('/', async (_req: Request, res: Response) => {
  try {
    const items = await prisma.methodology.findMany({
      include: { _count: { select: { deliverables: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: items.map(m => ({ ...m, methodologyId: Number(m.methodologyId) })) });
  } catch (err) {
    console.error('Methodology list error:', err);
    res.status(500).json({ success: false, message: '방법론 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/methodologies
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    if (!name) { res.status(400).json({ success: false, message: '방법론명은 필수입니다.' }); return; }
    const item = await prisma.methodology.create({ data: { name, description: description || null } });
    res.status(201).json({ success: true, data: { ...item, methodologyId: Number(item.methodologyId) }, message: '방법론이 등록되었습니다.' });
  } catch (err) {
    console.error('Methodology create error:', err);
    res.status(500).json({ success: false, message: '방법론 등록 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/methodologies/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const { name, description } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    const updated = await prisma.methodology.update({ where: { methodologyId: id }, data });
    res.json({ success: true, data: { ...updated, methodologyId: Number(updated.methodologyId) }, message: '방법론이 수정되었습니다.' });
  } catch (err) {
    console.error('Methodology update error:', err);
    res.status(500).json({ success: false, message: '방법론 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/v1/methodologies/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const count = await prisma.deliverableMaster.count({ where: { methodologyId: id } });
    if (count > 0) {
      await prisma.deliverableMaster.deleteMany({ where: { methodologyId: id } });
    }
    await prisma.methodology.delete({ where: { methodologyId: id } });
    res.json({ success: true, message: '방법론이 삭제되었습니다.' });
  } catch (err) {
    console.error('Methodology delete error:', err);
    res.status(500).json({ success: false, message: '방법론 삭제 중 오류가 발생했습니다.' });
  }
});

// ═══ 방법론 산출물 CRUD ═══

// GET /api/v1/methodologies/:id/deliverables
router.get('/:id/deliverables', async (req: Request, res: Response) => {
  try {
    const id = BigInt(req.params.id);
    const items = await prisma.deliverableMaster.findMany({
      where: { methodologyId: id },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: items.map(m => ({ ...m, masterId: Number(m.masterId), methodologyId: Number(m.methodologyId) })) });
  } catch (err) {
    console.error('Deliverable list error:', err);
    res.status(500).json({ success: false, message: '산출물 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/methodologies/:id/deliverables
router.post('/:id/deliverables', async (req: Request, res: Response) => {
  try {
    const methodologyId = BigInt(req.params.id);
    const { phase, docCode, docName, mandatory, description } = req.body;
    if (!phase || !docCode || !docName) {
      res.status(400).json({ success: false, message: '단계, 코드, 산출물명은 필수입니다.' }); return;
    }
    const maxOrder = await prisma.deliverableMaster.aggregate({ where: { methodologyId }, _max: { sortOrder: true } });
    const item = await prisma.deliverableMaster.create({
      data: { methodologyId, phase, docCode, docName, mandatory: mandatory || '선택', description: description || null, sortOrder: (maxOrder._max.sortOrder || 0) + 1 },
    });
    res.status(201).json({ success: true, data: { ...item, masterId: Number(item.masterId) }, message: '산출물이 추가되었습니다.' });
  } catch (err: any) {
    if (err.code === 'P2002') { res.status(409).json({ success: false, message: '이미 존재하는 산출물 코드입니다.' }); return; }
    console.error('Deliverable create error:', err);
    res.status(500).json({ success: false, message: '산출물 추가 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/methodologies/:id/deliverables/:masterId
router.put('/:id/deliverables/:masterId', async (req: Request, res: Response) => {
  try {
    const masterId = BigInt(req.params.masterId);
    const { phase, docCode, docName, mandatory, description } = req.body;
    const data: any = {};
    if (phase !== undefined) data.phase = phase;
    if (docCode !== undefined) data.docCode = docCode;
    if (docName !== undefined) data.docName = docName;
    if (mandatory !== undefined) data.mandatory = mandatory;
    if (description !== undefined) data.description = description;
    const updated = await prisma.deliverableMaster.update({ where: { masterId }, data });
    res.json({ success: true, data: { ...updated, masterId: Number(updated.masterId) }, message: '산출물이 수정되었습니다.' });
  } catch (err) {
    console.error('Deliverable update error:', err);
    res.status(500).json({ success: false, message: '산출물 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/v1/methodologies/:id/deliverables/:masterId
router.delete('/:id/deliverables/:masterId', async (req: Request, res: Response) => {
  try {
    const masterId = BigInt(req.params.masterId);
    await prisma.projectDeliverable.deleteMany({ where: { masterId } });
    await prisma.deliverableMaster.delete({ where: { masterId } });
    res.json({ success: true, message: '산출물이 삭제되었습니다.' });
  } catch (err) {
    console.error('Deliverable delete error:', err);
    res.status(500).json({ success: false, message: '산출물 삭제 중 오류가 발생했습니다.' });
  }
});

// ═══ 프로젝트 산출물 테일러링 ═══

// GET /api/v1/projects/:projectId/tailoring — 테일러링 현황 조회
router.get('/projects/:projectId/tailoring', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const project = await prisma.project.findUnique({ where: { projectId }, select: { methodologyId: true } });
    if (!project?.methodologyId) {
      res.json({ success: true, data: { methodologyId: null, masters: [], tailored: [] } });
      return;
    }
    const masters = await prisma.deliverableMaster.findMany({
      where: { methodologyId: project.methodologyId },
      orderBy: { sortOrder: 'asc' },
    });
    const tailored = await prisma.projectDeliverable.findMany({
      where: { projectId },
      include: { master: true },
    });
    res.json({
      success: true,
      data: {
        methodologyId: Number(project.methodologyId),
        masters: masters.map(m => ({ ...m, masterId: Number(m.masterId), methodologyId: Number(m.methodologyId) })),
        tailored: tailored.map(t => ({
          projDelId: Number(t.projDelId),
          masterId: Number(t.masterId),
          projectDocName: t.projectDocName,
          applied: t.applied,
          interim: t.interim,
          official: t.official,
          notAppliedReason: t.notAppliedReason,
          remark: t.remark,
          master: { ...t.master, masterId: Number(t.master.masterId) },
        })),
      },
    });
  } catch (err) {
    console.error('Tailoring get error:', err);
    res.status(500).json({ success: false, message: '테일러링 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/projects/:projectId/tailoring/init — 방법론 적용 시 전체 산출물 일괄 등록
router.post('/projects/:projectId/tailoring/init', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const project = await prisma.project.findUnique({ where: { projectId }, select: { methodologyId: true } });
    if (!project?.methodologyId) { res.status(400).json({ success: false, message: '방법론이 설정되지 않았습니다.' }); return; }

    const masters = await prisma.deliverableMaster.findMany({
      where: { methodologyId: project.methodologyId },
    });

    // 기존 테일러링 데이터 삭제 후 재생성
    await prisma.projectDeliverable.deleteMany({ where: { projectId } });

    let count = 0;
    for (const m of masters) {
      await prisma.projectDeliverable.create({
        data: {
          projectId,
          masterId: m.masterId,
          projectDocName: m.docName,
          applied: m.mandatory === '필수', // 필수는 자동 적용
          interim: false,
          official: false,
        },
      });
      count++;
    }

    res.json({ success: true, message: `${count}건 산출물이 초기화되었습니다. 필수 항목은 자동 적용됩니다.` });
  } catch (err) {
    console.error('Tailoring init error:', err);
    res.status(500).json({ success: false, message: '초기화 중 오류' });
  }
});

// PUT /api/v1/projects/:projectId/tailoring/:projDelId — 테일러링 상세 수정
router.put('/projects/:projectId/tailoring/:projDelId', async (req: Request, res: Response) => {
  try {
    const projDelId = BigInt(req.params.projDelId);
    const { projectDocName, applied, interim, official, notAppliedReason, remark } = req.body;
    const data: any = {};
    if (projectDocName !== undefined) data.projectDocName = projectDocName;
    if (applied !== undefined) data.applied = applied;
    if (interim !== undefined) data.interim = interim;
    if (official !== undefined) data.official = official;
    if (notAppliedReason !== undefined) data.notAppliedReason = notAppliedReason;
    if (remark !== undefined) data.remark = remark;
    const updated = await prisma.projectDeliverable.update({ where: { projDelId }, data });
    res.json({ success: true, data: { ...updated, projDelId: Number(updated.projDelId), masterId: Number(updated.masterId) } });
  } catch (err) {
    console.error('Tailoring update error:', err);
    res.status(500).json({ success: false, message: '수정 중 오류' });
  }
});

// GET /api/v1/projects/:projectId/tailoring/export — 테일러링 결과서 엑셀
router.get('/projects/:projectId/tailoring/export', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const project = await prisma.project.findUnique({
      where: { projectId },
      select: { projectName: true, methodologyId: true, methodology: { select: { name: true } } },
    });
    if (!project?.methodologyId) { res.status(400).json({ success: false, message: '방법론이 설정되지 않았습니다.' }); return; }

    const masters = await prisma.deliverableMaster.findMany({
      where: { methodologyId: project.methodologyId },
      orderBy: { sortOrder: 'asc' },
    });
    const tailored = await prisma.projectDeliverable.findMany({ where: { projectId } });
    const tailoredMap = new Map(tailored.map(t => [Number(t.masterId), t]));

    const headers = [
      `${project.methodology?.name} 경로 산출물`,
      '프로젝트 적용 산출물',
      '적용여부',
      '중간과정 산출물',
      '공식제출',
      '미적용 사유',
      '비고',
    ];

    const rows: any[][] = [headers];
    let currentPhase = '';
    for (const m of masters) {
      if (m.phase !== currentPhase) {
        rows.push([m.phase, '', '', '', '', '', '']);
        currentPhase = m.phase;
      }
      const t = tailoredMap.get(Number(m.masterId));
      rows.push([
        m.docName,
        t?.projectDocName || '',
        t ? (t.applied ? 'Y' : 'N') : '',
        t?.interim ? 'Y' : '',
        t?.official ? 'Y' : '',
        t?.notAppliedReason || '',
        t?.remark || '',
      ]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 30 }, { wch: 35 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 30 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, '산출물 테일러링');

    const dir = path.join(process.cwd(), 'uploads', 'temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, `tailoring_${projectId}_${Date.now()}.xlsx`);
    XLSX.writeFile(wb, filepath);
    res.download(filepath, `산출물테일러링_${project.projectName}.xlsx`, () => { try { fs.unlinkSync(filepath); } catch {} });
  } catch (err) {
    console.error('Tailoring export error:', err);
    res.status(500).json({ success: false, message: '엑셀 내보내기 중 오류가 발생했습니다.' });
  }
});

export default router;
