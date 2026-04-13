import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';
import * as XLSX from 'xlsx';
import multer from 'multer';

const router = Router({ mergeParams: true });
router.use(authenticate);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function pid(req: Request): bigint { return BigInt(req.params.projectId as string); }

function serialize(r: any) {
  return JSON.parse(JSON.stringify(r, (_k, v) => typeof v === 'bigint' ? Number(v) : v));
}

// 상태 한글 매핑
const STATUS_LABELS: Record<string, string> = {
  NOT_START: '미착수', IN_PROGRESS: '진행중', DEV_DONE: '개발완료',
  TEST_DONE: '단위테스트완료', REVIEW_DONE: '검토완료', HOLD: '보류', STOP: '중단',
};
const STATUS_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_LABELS).map(([k, v]) => [v, k])
);

const DIFF_LABELS: Record<string, string> = { H: '상', M: '중', L: '하' };
const DIFF_REVERSE: Record<string, string> = { '상': 'H', '중': 'M', '하': 'L' };
const PGM_TYPES = ['ONL', 'BAT', 'INF', 'RPT', 'COM', 'MIG'];

// 상태 자동 유추
function computeStatus(pgm: { actualStartDate: Date | null; actualEndDate: Date | null; planEndDate: Date | null }): string {
  if (pgm.actualEndDate) return 'DEV_DONE';
  if (pgm.actualStartDate) {
    if (pgm.planEndDate && new Date(pgm.planEndDate) < new Date()) return 'DELAYED';
    return 'IN_PROGRESS';
  }
  if (pgm.planEndDate && new Date(pgm.planEndDate) < new Date()) return 'DELAYED';
  return 'NOT_START';
}

function serializeWithStatus(r: any) {
  const s = serialize(r);
  s.statusCode = computeStatus(r);
  return s;
}

// ====================================================================
// GET / — 프로그램 목록
// ====================================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const { taskCode, pgmType, devUserId, statusCode, keyword, page, size } = req.query;

    const pn = Math.max(1, parseInt(page as string) || 1);
    const ps = Math.min(200, Math.max(1, parseInt(size as string) || 100));

    const where: any = { projectId };
    if (taskCode) where.taskCode = taskCode;
    if (pgmType) where.pgmType = pgmType;
    if (devUserId) where.devUserId = devUserId;
    // 상태 필터는 computed이므로 서버에서 후처리
    if (keyword) where.OR = [
      { pgmCode: { contains: keyword as string } },
      { pgmName: { contains: keyword as string } },
    ];

    let allItems = await prisma.devProgram.findMany({ where, orderBy: [{ pgmCode: 'asc' }] });

    // 상태 필터 (computed)
    if (statusCode) {
      allItems = allItems.filter(i => computeStatus(i) === statusCode);
    }

    const total = allItems.length;
    const paged = allItems.slice((pn - 1) * ps, pn * ps);

    res.json({
      success: true,
      data: paged.map(serializeWithStatus),
      pagination: { page: pn, size: ps, totalCount: total, totalPages: Math.ceil(total / ps) },
    });
  } catch (err) {
    console.error('DevProgram list error:', err);
    res.status(500).json({ success: false, message: '프로그램 목록 조회 중 오류' });
  }
});

// ====================================================================
// GET /summary — 요약 통계
// ====================================================================
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const allPgms = await prisma.devProgram.findMany({ where: { projectId } });
    const total = allPgms.length;

    // 상태별 집계 (computed)
    const statusCounts: Record<string, number> = {};
    for (const p of allPgms) {
      const st = computeStatus(p);
      statusCounts[st] = (statusCounts[st] || 0) + 1;
    }
    const delayed = (statusCounts['DELAYED'] || 0);

    const byType = await prisma.devProgram.groupBy({ by: ['pgmType'], where: { projectId }, _count: true });
    const byTask = await prisma.devProgram.groupBy({ by: ['taskCode'], where: { projectId }, _count: true });

    res.json({
      success: true,
      data: {
        total,
        delayed,
        byStatus: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
        byType: byType.map(t => ({ type: t.pgmType, count: t._count })),
        byTask: byTask.map(t => ({ task: t.taskCode, count: t._count })),
      },
    });
  } catch (err) {
    console.error('DevProgram summary error:', err);
    res.status(500).json({ success: false, message: '요약 조회 중 오류' });
  }
});

// ====================================================================
// GET /:pgmId — 상세
// ====================================================================
router.get('/:pgmId', async (req: Request, res: Response) => {
  try {
    const pgmId = BigInt(req.params.pgmId as string);
    const item = await prisma.devProgram.findUnique({
      where: { pgmId },
      include: { weeklyPlans: { orderBy: { weekNo: 'asc' } }, weeklyActuals: { orderBy: { weekNo: 'asc' } } },
    });
    if (!item) { res.status(404).json({ success: false, message: '프로그램을 찾을 수 없습니다.' }); return; }
    res.json({ success: true, data: serializeWithStatus(item) });
  } catch (err) {
    console.error('DevProgram detail error:', err);
    res.status(500).json({ success: false, message: '프로그램 상세 조회 중 오류' });
  }
});

// ====================================================================
// POST / — 등록
// ====================================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const cu = (req as any).user as JwtPayload;
    const b = req.body;

    if (!b.pgmCode || !b.pgmName || !b.taskCode || !b.pgmType || !b.planStartDate || !b.planEndDate) {
      res.status(400).json({ success: false, message: '필수 항목을 입력하세요.' }); return;
    }

    const item = await prisma.devProgram.create({
      data: {
        projectId,
        pgmCode: b.pgmCode,
        pgmName: b.pgmName,
        taskCode: b.taskCode,
        pgmType: b.pgmType,
        screenId: b.screenId || null,
        difficulty: b.difficulty || 'M',
        priority: b.priority || 'NORMAL',
        reqId: b.reqId || null,
        reqName: b.reqName || null,
        devUserId: b.devUserId || null,
        devUserName: b.devUserName || null,
        devTeam: b.devTeam || null,
        reviewerId: b.reviewerId || null,
        planStartDate: new Date(b.planStartDate),
        planEndDate: new Date(b.planEndDate),
        planTcCount: b.planTcCount || 0,
        relatedDoc: b.relatedDoc || null,
        remark: b.remark || null,
        createdBy: cu.userId,
      },
    });

    await writeAuditLog({ userId: cu.userId, ipAddress: req.ip, action: 'CREATE', targetType: 'dev_program', targetId: item.pgmId });
    res.status(201).json({ success: true, data: serialize(item) });
  } catch (err: any) {
    if (err.code === 'P2002') { res.status(409).json({ success: false, message: '프로그램 코드가 중복됩니다.' }); return; }
    console.error('DevProgram create error:', err);
    res.status(500).json({ success: false, message: '프로그램 등록 중 오류' });
  }
});

// ====================================================================
// PUT /:pgmId — 수정
// ====================================================================
router.put('/:pgmId', async (req: Request, res: Response) => {
  try {
    const pgmId = BigInt(req.params.pgmId as string);
    const cu = (req as any).user as JwtPayload;
    const b = req.body;

    const data: any = {};
    const fields = ['pgmCode', 'pgmName', 'taskCode', 'pgmType', 'screenId', 'difficulty', 'priority',
      'reqId', 'reqName', 'devUserId', 'devUserName', 'devTeam', 'reviewerId',
      'planTcCount', 'relatedDoc', 'remark'];
    for (const f of fields) { if (b[f] !== undefined) data[f] = b[f] ?? null; }
    // 숫자 필드: null 불가
    if (data.planTcCount === null || data.planTcCount === undefined) delete data.planTcCount;
    if (b.planStartDate !== undefined) data.planStartDate = b.planStartDate ? new Date(b.planStartDate) : null;
    if (b.planEndDate !== undefined) data.planEndDate = b.planEndDate ? new Date(b.planEndDate) : null;
    if (b.actualStartDate !== undefined) data.actualStartDate = b.actualStartDate ? new Date(b.actualStartDate) : null;
    if (b.actualEndDate !== undefined) data.actualEndDate = b.actualEndDate ? new Date(b.actualEndDate) : null;
    const item = await prisma.devProgram.update({ where: { pgmId }, data });
    await writeAuditLog({ userId: cu.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'dev_program', targetId: pgmId });
    res.json({ success: true, data: serializeWithStatus(item) });
  } catch (err) {
    console.error('DevProgram update error:', err);
    res.status(500).json({ success: false, message: '프로그램 수정 중 오류' });
  }
});

// ====================================================================
// DELETE /:pgmId — 삭제
// ====================================================================
router.delete('/:pgmId', async (req: Request, res: Response) => {
  try {
    const pgmId = BigInt(req.params.pgmId as string);
    const cu = (req as any).user as JwtPayload;
    await prisma.devProgram.delete({ where: { pgmId } });
    await writeAuditLog({ userId: cu.userId, ipAddress: req.ip, action: 'DELETE', targetType: 'dev_program', targetId: pgmId });
    res.json({ success: true, message: '삭제되었습니다.' });
  } catch (err) {
    console.error('DevProgram delete error:', err);
    res.status(500).json({ success: false, message: '프로그램 삭제 중 오류' });
  }
});

// ====================================================================
// GET /export/excel — 엑셀 다운로드
// ====================================================================
router.get('/export/excel', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const items = await prisma.devProgram.findMany({ where: { projectId }, orderBy: { pgmCode: 'asc' } });

    const PGM_TYPE_LABELS: Record<string, string> = { ONL: '화면', BAT: '배치', INF: '인터페이스', RPT: '리포트', COM: '공통모듈', MIG: '데이터이행' };
    const PRIORITY_LABELS: Record<string, string> = { URGENT: '긴급', HIGH: '높음', NORMAL: '보통', LOW: '낮음' };

    const rows = items.map(i => ({
      '프로그램ID': i.pgmCode,
      '프로그램명': i.pgmName,
      '업무구분': i.taskCode,
      '프로그램유형': PGM_TYPE_LABELS[i.pgmType] || i.pgmType,
      '난이도': DIFF_LABELS[i.difficulty] || i.difficulty,
      '우선순위': PRIORITY_LABELS[i.priority] || i.priority,
      '요구사항ID': i.reqId || '',
      '요구사항명': i.reqName || '',
      '담당자': i.devUserName || '',
      '팀구분': i.devTeam || '',
      '계획시작일': i.planStartDate ? i.planStartDate.toISOString().substring(0, 10) : '',
      '계획종료일': i.planEndDate ? i.planEndDate.toISOString().substring(0, 10) : '',
      '실제시작일': i.actualStartDate ? i.actualStartDate.toISOString().substring(0, 10) : '',
      '개발완료일': i.actualEndDate ? i.actualEndDate.toISOString().substring(0, 10) : '',
      '비고': i.remark || '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '개발목록');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=dev-programs.xlsx');
    res.send(buf);
  } catch (err) {
    console.error('DevProgram export error:', err);
    res.status(500).json({ success: false, message: '엑셀 다운로드 중 오류' });
  }
});

// ====================================================================
// POST /import/excel — 엑셀 업로드
// ====================================================================
router.post('/import/excel', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const cu = (req as any).user as JwtPayload;
    const file = (req as any).file;
    if (!file) { res.status(400).json({ success: false, message: '파일을 첨부하세요.' }); return; }

    const mode = req.body.mode || 'append'; // append | reset

    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws);

    // reset 모드: 기존 데이터 전체 삭제
    if (mode === 'reset') {
      // 하위 테이블 먼저 삭제
      const pgmIds = (await prisma.devProgram.findMany({ where: { projectId }, select: { pgmId: true } })).map(p => p.pgmId);
      if (pgmIds.length) {
        await prisma.devActualWeekly.deleteMany({ where: { pgmId: { in: pgmIds } } });
        await prisma.devPlanWeekly.deleteMany({ where: { pgmId: { in: pgmIds } } });
      }
      await prisma.devProgram.deleteMany({ where: { projectId } });
    }

    let created = 0, updated = 0, errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const pgmCode = String(r['프로그램ID'] || '').trim();
      const pgmName = String(r['프로그램명'] || '').trim();
      if (!pgmCode || !pgmName) { errors.push(`${i + 2}행: 프로그램ID 또는 프로그램명 누락`); continue; }

      const PGM_TYPE_REVERSE: Record<string, string> = { '화면': 'ONL', '배치': 'BAT', '인터페이스': 'INF', '리포트': 'RPT', '공통모듈': 'COM', '데이터이행': 'MIG' };
      const PRIORITY_REVERSE: Record<string, string> = { '긴급': 'URGENT', '높음': 'HIGH', '보통': 'NORMAL', '낮음': 'LOW' };

      const rawType = String(r['프로그램유형'] || '').trim();
      const rawPriority = String(r['우선순위'] || '').trim();

      const data: any = {
        pgmName,
        taskCode: String(r['업무구분'] || '').trim() || '미분류',
        pgmType: PGM_TYPE_REVERSE[rawType] || rawType.toUpperCase() || 'ONL',
        difficulty: DIFF_REVERSE[String(r['난이도'] || '').trim()] || 'M',
        priority: PRIORITY_REVERSE[rawPriority] || rawPriority || 'NORMAL',
        reqId: String(r['요구사항ID'] || '').trim() || null,
        reqName: String(r['요구사항명'] || '').trim() || null,
        devUserName: String(r['담당자'] || r['개발담당자'] || '').trim() || null,
        devTeam: String(r['팀구분'] || r['개발팀'] || '').trim() || null,
        planStartDate: r['계획시작일'] ? new Date(r['계획시작일']) : new Date(),
        planEndDate: r['계획종료일'] ? new Date(r['계획종료일']) : new Date(),
        remark: String(r['비고'] || '').trim() || null,
      };
      // 실제일정 (있으면)
      if (r['실제시작일']) data.actualStartDate = new Date(r['실제시작일']);
      if (r['개발완료일']) data.actualEndDate = new Date(r['개발완료일']);

      // 담당자명 → userId 매핑
      if (data.devUserName) {
        const user = await prisma.user.findFirst({ where: { userName: data.devUserName } });
        if (user) { data.devUserId = user.userId; data.devTeam = data.devTeam || user.department; }
      }

      try {
        const existing = await prisma.devProgram.findUnique({ where: { projectId_pgmCode: { projectId, pgmCode } } });
        if (existing) {
          await prisma.devProgram.update({ where: { pgmId: existing.pgmId }, data });
          updated++;
        } else {
          await prisma.devProgram.create({ data: { projectId, pgmCode, createdBy: cu.userId, ...data } });
          created++;
        }
      } catch (e: any) {
        errors.push(`${i + 2}행: ${e.message?.substring(0, 50)}`);
      }
    }

    res.json({ success: true, data: { created, updated, errors: errors.slice(0, 10), totalErrors: errors.length } });
  } catch (err) {
    console.error('DevProgram import error:', err);
    res.status(500).json({ success: false, message: '엑셀 업로드 중 오류' });
  }
});

// ====================================================================
// PUT /:pgmId/actual — 담당자 실적 등록 (실제시작일/완료일)
// ====================================================================
router.put('/:pgmId/actual', async (req: Request, res: Response) => {
  try {
    const pgmId = BigInt(req.params.pgmId as string);
    const cu = (req as any).user as JwtPayload;
    const { actualStartDate, actualEndDate } = req.body;

    const data: any = {};
    if (actualStartDate !== undefined) data.actualStartDate = actualStartDate ? new Date(actualStartDate) : null;
    if (actualEndDate !== undefined) data.actualEndDate = actualEndDate ? new Date(actualEndDate) : null;

    const item = await prisma.devProgram.update({ where: { pgmId }, data });
    res.json({ success: true, data: serializeWithStatus(item) });
  } catch (err) {
    console.error('DevProgram actual error:', err);
    res.status(500).json({ success: false, message: '실적 등록 중 오류' });
  }
});

// ════════════════════════════════════════════════════
// 주차 유틸
// ════════════════════════════════════════════════════
function getYearWeek(date: Date): string {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNo = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getMonday(date: Date): Date {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff); return d;
}

function getFriday(mon: Date): Date {
  const d = new Date(mon); d.setDate(d.getDate() + 4); return d;
}

function generateWeeks(startDate: Date, endDate: Date) {
  const weeks: { weekNo: number; yearWeek: string; startDt: Date; endDt: Date }[] = [];
  let cur = getMonday(startDate);
  let weekNo = 1;
  while (cur <= endDate) {
    const fri = getFriday(cur);
    weeks.push({ weekNo, yearWeek: getYearWeek(cur), startDt: new Date(cur), endDt: fri });
    cur.setDate(cur.getDate() + 7);
    weekNo++;
  }
  return weeks;
}

function getCurrentWeekNo(startDate: Date): number {
  const now = getMonday(new Date());
  const start = getMonday(startDate);
  const diff = Math.floor((now.getTime() - start.getTime()) / (7 * 86400000));
  return Math.max(1, diff + 1);
}

// ════════════════════════════════════════════════════
// 주차별 계획 API
// ════════════════════════════════════════════════════

// POST /:pgmId/plans/auto — 균등 배부 자동 생성
router.post('/:pgmId/plans/auto', async (req: Request, res: Response) => {
  try {
    const pgmId = BigInt(req.params.pgmId as string);
    const pgm = await prisma.devProgram.findUnique({ where: { pgmId } });
    if (!pgm) { res.status(404).json({ success: false, message: '프로그램 없음' }); return; }

    const weeks = generateWeeks(pgm.planStartDate, pgm.planEndDate);
    if (!weeks.length) { res.status(400).json({ success: false, message: '계획 기간이 유효하지 않습니다.' }); return; }

    const ratePerWeek = Math.round(10000 / weeks.length) / 100; // 균등
    let cumRate = 0;

    // 기존 삭제 후 재생성
    await prisma.devPlanWeekly.deleteMany({ where: { pgmId } });

    const data = weeks.map((w, i) => {
      const isLast = i === weeks.length - 1;
      const rate = isLast ? Math.round((100 - cumRate) * 100) / 100 : ratePerWeek;
      cumRate = Math.round((cumRate + rate) * 100) / 100;
      return {
        pgmId, weekNo: w.weekNo, yearWeek: w.yearWeek,
        weekStartDate: w.startDt, weekEndDate: w.endDt,
        planRate: rate, planCumRate: cumRate,
      };
    });

    await prisma.devPlanWeekly.createMany({ data });

    // planWeeks 제거됨 — 별도 업데이트 불필요

    const plans = await prisma.devPlanWeekly.findMany({ where: { pgmId }, orderBy: { weekNo: 'asc' } });
    res.json({ success: true, data: plans.map(serialize) });
  } catch (err) {
    console.error('Plan auto error:', err);
    res.status(500).json({ success: false, message: '계획 자동 생성 중 오류' });
  }
});

// GET /:pgmId/plans — 주차별 계획 조회
router.get('/:pgmId/plans', async (req: Request, res: Response) => {
  try {
    const pgmId = BigInt(req.params.pgmId as string);
    const plans = await prisma.devPlanWeekly.findMany({ where: { pgmId }, orderBy: { weekNo: 'asc' } });
    res.json({ success: true, data: plans.map(serialize) });
  } catch (err) {
    console.error('Plan list error:', err);
    res.status(500).json({ success: false, message: '계획 조회 중 오류' });
  }
});

// PUT /:pgmId/plans — 주차별 계획 일괄 수정 (배열)
router.put('/:pgmId/plans', async (req: Request, res: Response) => {
  try {
    const pgmId = BigInt(req.params.pgmId as string);
    const { plans } = req.body; // [{weekNo, planRate}]
    if (!Array.isArray(plans)) { res.status(400).json({ success: false, message: 'plans 배열 필요' }); return; }

    let cumRate = 0;
    for (const p of plans) {
      cumRate = Math.round((cumRate + Number(p.planRate || 0)) * 100) / 100;
      await prisma.devPlanWeekly.update({
        where: { pgmId_weekNo: { pgmId, weekNo: p.weekNo } },
        data: { planRate: Number(p.planRate || 0), planCumRate: cumRate },
      });
    }

    const updated = await prisma.devPlanWeekly.findMany({ where: { pgmId }, orderBy: { weekNo: 'asc' } });
    res.json({ success: true, data: updated.map(serialize) });
  } catch (err) {
    console.error('Plan update error:', err);
    res.status(500).json({ success: false, message: '계획 수정 중 오류' });
  }
});

// ════════════════════════════════════════════════════
// 주간 실적 API
// ════════════════════════════════════════════════════

// GET /actuals — 전체 프로그램 주간 실적 목록 (주차 기준)
router.get('/actuals/weekly', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const { weekNo, taskCode, devUserId } = req.query;
    const wn = parseInt(weekNo as string) || 0;

    // 해당 프로젝트의 모든 프로그램
    const pgmWhere: any = { projectId };
    if (taskCode) pgmWhere.taskCode = taskCode;
    if (devUserId) pgmWhere.devUserId = devUserId;

    const programs = await prisma.devProgram.findMany({
      where: pgmWhere,
      include: {
        weeklyPlans: wn ? { where: { weekNo: wn } } : { orderBy: { weekNo: 'asc' } },
        weeklyActuals: wn ? { where: { weekNo: wn } } : { orderBy: { weekNo: 'asc' } },
      },
      orderBy: { pgmCode: 'asc' },
    });

    const data = programs.map(p => {
      const plan = wn ? p.weeklyPlans[0] : null;
      const actual = wn ? p.weeklyActuals[0] : null;
      // 이전 주차까지의 누적 실적
      const prevActuals = p.weeklyActuals.filter(a => a.weekNo < (wn || 999));
      const prevCumRate = prevActuals.length ? Number(prevActuals[prevActuals.length - 1].actualCumRate) : 0;

      return {
        pgmId: Number(p.pgmId),
        pgmCode: p.pgmCode,
        pgmName: p.pgmName,
        taskCode: p.taskCode,
        pgmType: p.pgmType,
        difficulty: p.difficulty,
        devUserName: p.devUserName,
        devTeam: p.devTeam,
        devUserId: p.devUserId,
        statusCode: computeStatus(p),
        planCumRate: plan ? Number(plan.planCumRate) : 0,
        planRate: plan ? Number(plan.planRate) : 0,
        actualRate: actual ? Number(actual.actualRate) : 0,
        actualCumRate: actual ? Number(actual.actualCumRate) : prevCumRate,
        prevCumRate,
        gapRate: actual ? Number(actual.gapRate) : 0,
        actualId: actual ? Number(actual.actualId) : null,
        delayReason: actual?.delayReason || '',
        tcExecCount: actual?.tcExecCount || 0,
        tcPassCount: actual?.tcPassCount || 0,
        tcFailCount: actual?.tcFailCount || 0,
        defectCount: actual?.defectCount || 0,
        effortMd: actual ? Number(actual.effortMd) : 0,
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    console.error('Actuals weekly error:', err);
    res.status(500).json({ success: false, message: '주간 실적 조회 중 오류' });
  }
});

// POST /actuals/batch — 주간 실적 일괄 저장
router.post('/actuals/batch', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const cu = (req as any).user as JwtPayload;
    const { weekNo, yearWeek, actuals } = req.body;
    // actuals: [{pgmId, actualRate, delayReason, tcExecCount, tcPassCount, tcFailCount, defectCount, effortMd}]

    if (!weekNo || !Array.isArray(actuals)) {
      res.status(400).json({ success: false, message: 'weekNo, actuals 배열 필요' }); return;
    }

    let saved = 0;
    for (const a of actuals) {
      const pgmId = BigInt(a.pgmId);
      const actualRate = Number(a.actualRate || 0);

      // 이전 주차 누적 실적
      const prevActual = await prisma.devActualWeekly.findFirst({
        where: { pgmId, weekNo: { lt: weekNo } },
        orderBy: { weekNo: 'desc' },
      });
      const prevCumRate = prevActual ? Number(prevActual.actualCumRate) : 0;
      const actualCumRate = Math.min(100, Math.round((prevCumRate + actualRate) * 100) / 100);

      // 계획 누적 (스냅샷)
      const plan = await prisma.devPlanWeekly.findUnique({ where: { pgmId_weekNo: { pgmId, weekNo } } });
      const planCumRate = plan ? Number(plan.planCumRate) : 0;
      const gapRate = Math.round((actualCumRate - planCumRate) * 100) / 100;

      // 이전 주 누적 공수
      const prevEffort = prevActual ? Number(prevActual.effortCumMd) : 0;
      const effortMd = Number(a.effortMd || 0);
      const effortCumMd = Math.round((prevEffort + effortMd) * 100) / 100;

      const yw = yearWeek || getYearWeek(new Date());

      await prisma.devActualWeekly.upsert({
        where: { pgmId_weekNo: { pgmId, weekNo } },
        update: {
          actualRate, actualCumRate, planCumRate, gapRate,
          statusCode: a.statusCode || null,
          delayReason: a.delayReason || null,
          tcExecCount: a.tcExecCount || 0,
          tcPassCount: a.tcPassCount || 0,
          tcFailCount: a.tcFailCount || 0,
          defectCount: a.defectCount || 0,
          effortMd, effortCumMd,
        },
        create: {
          pgmId, weekNo, yearWeek: yw,
          actualRate, actualCumRate, planCumRate, gapRate,
          statusCode: a.statusCode || null,
          delayReason: a.delayReason || null,
          tcExecCount: a.tcExecCount || 0,
          tcPassCount: a.tcPassCount || 0,
          tcFailCount: a.tcFailCount || 0,
          defectCount: a.defectCount || 0,
          effortMd, effortCumMd,
          regUserId: cu.userId,
        },
      });

      // 후속 주차 누적 재계산
      const laterActuals = await prisma.devActualWeekly.findMany({
        where: { pgmId, weekNo: { gt: weekNo } },
        orderBy: { weekNo: 'asc' },
      });
      let runCum = actualCumRate;
      let runEffort = effortCumMd;
      for (const la of laterActuals) {
        runCum = Math.min(100, Math.round((runCum + Number(la.actualRate)) * 100) / 100);
        runEffort = Math.round((runEffort + Number(la.effortMd)) * 100) / 100;
        const laPlan = await prisma.devPlanWeekly.findUnique({ where: { pgmId_weekNo: { pgmId, weekNo: la.weekNo } } });
        const laPlanCum = laPlan ? Number(laPlan.planCumRate) : 0;
        await prisma.devActualWeekly.update({
          where: { actualId: la.actualId },
          data: { actualCumRate: runCum, effortCumMd: runEffort, gapRate: Math.round((runCum - laPlanCum) * 100) / 100 },
        });
      }

      saved++;
    }

    await writeAuditLog({ userId: cu.userId, ipAddress: req.ip, action: 'CREATE', targetType: 'dev_actual_weekly', changeDetail: { weekNo, count: saved } });
    res.json({ success: true, data: { saved }, message: `${saved}건 저장되었습니다.` });
  } catch (err) {
    console.error('Actuals batch error:', err);
    res.status(500).json({ success: false, message: '주간 실적 저장 중 오류' });
  }
});

// ════════════════════════════════════════════════════
// 통계/S-Curve API
// ════════════════════════════════════════════════════

// GET /stats/weekly-trend — 주차별 S-Curve 데이터
// 계획: planEndDate 기준으로 해당 주차까지 완료 예정 프로그램 수 누적
// 실적: actualEndDate 기준으로 해당 주차까지 실제 완료 프로그램 수 누적
router.get('/stats/weekly-trend', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const { taskCode, devUserId } = req.query;

    // 프로젝트 기간
    const project = await prisma.project.findUnique({ where: { projectId }, select: { startDate: true, endDate: true } });
    if (!project) { res.json({ success: true, data: [] }); return; }

    const pgmWhere: any = { projectId };
    if (taskCode) pgmWhere.taskCode = taskCode;
    if (devUserId) pgmWhere.devUserId = devUserId;

    const programs = await prisma.devProgram.findMany({
      where: pgmWhere,
      select: { pgmId: true, difficulty: true, planEndDate: true, actualEndDate: true },
    });

    const total = programs.length;
    if (!total) { res.json({ success: true, data: [] }); return; }

    // 프로젝트 전체 주차 생성
    const weeks = generateWeeks(project.startDate, project.endDate);

    const trend = weeks.map(w => {
      const weekEnd = w.endDt;

      // 계획: planEndDate <= 해당 주 금요일인 프로그램 수
      const planDone = programs.filter(p => p.planEndDate && p.planEndDate <= weekEnd).length;
      // 실적: actualEndDate <= 해당 주 금요일인 프로그램 수
      const actualDone = programs.filter(p => p.actualEndDate && p.actualEndDate <= weekEnd).length;

      return {
        weekNo: w.weekNo,
        yearWeek: w.yearWeek,
        weekEnd: w.endDt.toISOString().substring(0, 10),
        planCount: planDone,
        actualCount: actualDone,
        planCumRate: Math.round(planDone / total * 1000) / 10,
        actualCumRate: Math.round(actualDone / total * 1000) / 10,
      };
    });

    res.json({ success: true, data: trend, total });
  } catch (err) {
    console.error('Weekly trend error:', err);
    res.status(500).json({ success: false, message: '주차별 추이 조회 중 오류' });
  }
});

// GET /stats/by-task — 업무별 진척현황 + 주차별 추이
router.get('/stats/by-task', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const project = await prisma.project.findUnique({ where: { projectId }, select: { startDate: true, endDate: true } });
    const programs = await prisma.devProgram.findMany({ where: { projectId } });

    const taskMap = new Map<string, { total: number; done: number; inProgress: number; delayed: number; programs: any[] }>();

    for (const p of programs) {
      const task = p.taskCode || '미분류';
      if (!taskMap.has(task)) taskMap.set(task, { total: 0, done: 0, inProgress: 0, delayed: 0, programs: [] });
      const t = taskMap.get(task)!;
      t.total++;
      t.programs.push(p);
      const st = computeStatus(p);
      if (st === 'DEV_DONE') t.done++;
      if (st === 'IN_PROGRESS') t.inProgress++;
      if (st === 'DELAYED') t.delayed++;
    }

    // 주차별 업무별 누적 완료율 (라인차트용)
    const weeks = project ? generateWeeks(project.startDate, project.endDate) : [];
    const taskTrend: Record<string, number[]> = {};
    for (const [task, t] of taskMap) {
      taskTrend[task] = weeks.map(w => {
        const done = t.programs.filter(p => p.actualEndDate && p.actualEndDate <= w.endDt).length;
        return t.total ? Math.round(done / t.total * 1000) / 10 : 0;
      });
    }

    const data = Array.from(taskMap.entries()).map(([task, t]) => ({
      taskCode: task,
      total: t.total,
      done: t.done,
      inProgress: t.inProgress,
      delayed: t.delayed,
      doneRate: t.total ? Math.round(t.done / t.total * 1000) / 10 : 0,
    }));

    res.json({
      success: true,
      data,
      weekNos: weeks.map(w => w.weekNo),
      taskTrend,
    });
  } catch (err) {
    console.error('By task error:', err);
    res.status(500).json({ success: false, message: '업무별 현황 조회 중 오류' });
  }
});

// GET /stats/by-developer — 담당자별 진척현황
router.get('/stats/by-developer', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const programs = await prisma.devProgram.findMany({ where: { projectId } });

    const devMap = new Map<string, { name: string; team: string; total: number; done: number; delayed: number }>();

    for (const p of programs) {
      const key = p.devUserName || p.devUserId || '미배정';
      if (!devMap.has(key)) devMap.set(key, { name: key, team: p.devTeam || '', total: 0, done: 0, delayed: 0 });
      const d = devMap.get(key)!;
      d.total++;
      const st = computeStatus(p);
      if (st === 'DEV_DONE') d.done++;
      if (st === 'DELAYED') d.delayed++;
    }

    const data = Array.from(devMap.values()).map(d => ({
      devName: d.name,
      devTeam: d.team,
      total: d.total,
      done: d.done,
      delayed: d.delayed,
      doneRate: d.total ? Math.round(d.done / d.total * 1000) / 10 : 0,
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('By developer error:', err);
    res.status(500).json({ success: false, message: '담당자별 현황 조회 중 오류' });
  }
});

// GET /stats/weeks — 프로젝트 주차 목록 (주차 선택용)
router.get('/stats/weeks', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const project = await prisma.project.findUnique({ where: { projectId }, select: { startDate: true, endDate: true } });
    if (!project) { res.status(404).json({ success: false, message: '프로젝트 없음' }); return; }

    const weeks = generateWeeks(project.startDate, project.endDate);
    const currentWeek = getCurrentWeekNo(project.startDate);

    res.json({
      success: true,
      data: {
        weeks: weeks.map(w => ({
          weekNo: w.weekNo,
          yearWeek: w.yearWeek,
          startDt: w.startDt.toISOString().substring(0, 10),
          endDt: w.endDt.toISOString().substring(0, 10),
        })),
        currentWeek,
      },
    });
  } catch (err) {
    console.error('Weeks error:', err);
    res.status(500).json({ success: false, message: '주차 목록 조회 중 오류' });
  }
});

export default router;
