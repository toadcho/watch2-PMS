import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, verifyToken, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';
import { getProjectRole, canLeaderEditTask, isOnlyActualFields } from '../utils/projectRole';
import { getMaxActualRate } from './approval';
import multer from 'multer';
import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const router = Router({ mergeParams: true });
// 쿼리 파라미터 토큰을 Authorization 헤더로 변환 (export 등 window.open 호출용)
router.use((req: Request, _res: Response, next: Function) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
});
router.use(authenticate);

// ─── 프로젝트 역할 기반 권한 체크 헬퍼 ───
// PMS관리자 전용 (태스크 등록/삭제, 스케줄, 가중치, 베이스라인, 임포트, 선후행, 순서변경)
async function requirePmsAdmin(req: Request, res: Response): Promise<boolean> {
  const currentUser = (req as any).user as JwtPayload;
  const projectId = BigInt(req.params.projectId);
  const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
  if (roleInfo.isPmsAdmin) return true;
  res.status(403).json({ success: false, message: '이 작업은 PMS관리자만 수행할 수 있습니다.' });
  return false;
}

// WBS 구조 잠금 체크: 실적 1건이라도 있으면 구조 변경 차단
async function checkWbsStructureLock(projectId: bigint, forceUnlock?: boolean): Promise<string | null> {
  if (forceUnlock) return null;
  const hasActual = await prisma.wbsTask.count({
    where: {
      projectId,
      OR: [
        { actualStart: { not: null } },
        { actualEnd: { not: null } },
        { actualRate: { gt: 0 } },
      ],
    },
  });
  if (hasActual > 0) {
    return '실적이 등록된 태스크가 있어 WBS 구조를 변경할 수 없습니다. PMS관리자의 잠금 해제가 필요합니다.';
  }
  return null;
}

// 영업일 유틸
function addBizDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  const dir = days >= 0 ? 1 : -1;
  const absDays = Math.abs(days);
  while (added < absDays) {
    d.setDate(d.getDate() + dir);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

function bizDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// WBS 코드 자연 정렬 (1.2 < 1.10 < 1.10.1 < 2)
function compareWbsCode(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? -1;
    const nb = pb[i] ?? -1;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function sortByWbs<T extends { wbsCode?: string | null; sortOrder?: number }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const wbsCmp = compareWbsCode(a.wbsCode || null, b.wbsCode || null);
    if (wbsCmp !== 0) return wbsCmp;
    return (a.sortOrder || 0) - (b.sortOrder || 0); // wbsCode 없으면 sortOrder 폴백
  });
}

// 계획진행률 자동 산정: 영업일(Working day) 기준 경과율
function calcPlanProgress(planStart: any, planEnd: any): number {
  if (!planStart || !planEnd) return 0;
  const start = new Date(planStart);
  const end = new Date(planEnd);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (today < start) return 0;
  if (today >= end) return 100;

  const totalBizDays = bizDaysBetween(start, end);
  if (totalBizDays <= 0) return 100;
  const elapsedBizDays = bizDaysBetween(start, today);
  return Math.round(elapsedBizDays / totalBizDays * 1000) / 10; // 소수 1자리
}

/**
 * 플랫 태스크 목록에 대해 계획/실적 진행률을 리프→부모 순으로 일괄 계산
 * - 리프: 계획진행률 = 기간 경과율, 실적진행률 = DB 값 (사용자 입력)
 * - 부모: 계획/실적 = 하위 태스크의 가중 평균
 */
function calcAllProgress(tasks: any[]): Map<number, { progressRate: number; actualRate: number }> {
  const result = new Map<number, { progressRate: number; actualRate: number }>();
  const taskMap = new Map<number, any>();
  const childrenMap = new Map<number, number[]>(); // parentId → childIds

  for (const t of tasks) {
    const id = Number(t.taskId);
    taskMap.set(id, t);
    const pid = t.parentTaskId ? Number(t.parentTaskId) : null;
    if (pid !== null) {
      if (!childrenMap.has(pid)) childrenMap.set(pid, []);
      childrenMap.get(pid)!.push(id);
    }
  }

  // 리프 먼저 계산
  for (const t of tasks) {
    const id = Number(t.taskId);
    const children = childrenMap.get(id);
    if (!children || children.length === 0) {
      // 리프 태스크
      result.set(id, {
        progressRate: calcPlanProgress(t.planStart, t.planEnd),
        actualRate: Number(t.actualRate || 0),
      });
    }
  }

  // 부모를 깊이 역순으로 계산 (깊은 부모 → 얕은 부모)
  const sorted = [...tasks].sort((a, b) => (b.depth || 0) - (a.depth || 0));
  for (const t of sorted) {
    const id = Number(t.taskId);
    if (result.has(id)) continue; // 이미 리프로 처리됨
    const children = childrenMap.get(id);
    if (!children || children.length === 0) continue;

    let totalWeight = 0, sumPlan = 0, sumActual = 0;
    for (const cid of children) {
      const cr = result.get(cid);
      if (!cr) continue;
      const ct = taskMap.get(cid);
      const w = Number(ct?.weight || 1);
      totalWeight += w;
      sumPlan += cr.progressRate * w;
      sumActual += cr.actualRate * w;
    }

    if (totalWeight > 0) {
      result.set(id, {
        progressRate: Math.round(sumPlan / totalWeight * 10) / 10,
        actualRate: Math.round(sumActual / totalWeight * 10) / 10,
      });
    } else {
      result.set(id, { progressRate: 0, actualRate: 0 });
    }
  }

  return result;
}

// progressMap: calcAllProgress 결과를 주입
let _progressMap: Map<number, { progressRate: number; actualRate: number }> | null = null;

function serializeTask(t: any): any {
  // 지연일 자동산정: (실제완료 or 오늘) - 변경계획완료 (영업일)
  let delayDays: number | null = null;
  if (t.planEnd) {
    const pe = new Date(t.planEnd);
    const compareDate = t.actualEnd ? new Date(t.actualEnd) : new Date();
    if (t.actualEnd || compareDate > pe) {
      if (compareDate > pe) delayDays = bizDaysBetween(pe, compareDate) - 1;
      else if (compareDate < pe) delayDays = -(bizDaysBetween(compareDate, pe) - 1);
      else delayDays = 0;
    }
  }

  const id = Number(t.taskId);
  const prog = _progressMap?.get(id);
  const progressRate = prog ? prog.progressRate : calcPlanProgress(t.planStart, t.planEnd);
  const actualRate = prog ? prog.actualRate : Number(t.actualRate || 0);

  return {
    ...t,
    taskId: id,
    projectId: Number(t.projectId),
    parentTaskId: t.parentTaskId ? Number(t.parentTaskId) : null,
    wbsCode: t.wbsCode || null,
    // 일정
    duration: (t.planStart && t.planEnd) ? bizDaysBetween(new Date(t.planStart), new Date(t.planEnd)) : (t.duration || null),
    actualMd: (t.actualStart && t.actualEnd) ? bizDaysBetween(new Date(t.actualStart), new Date(t.actualEnd)) : (t.actualMd || null),
    delayDays,
    // 진행률
    progressRate,
    actualRate,
    weight: Number(t.weight),
    // 역할/담당
    taskRole: t.taskRole || null,
    assigneeName: t.assignee?.userName || null,
    // 선행작업
    predecessors: t.predecessors?.map((d: any) => ({
      depId: Number(d.depId),
      predecessorId: Number(d.predecessorId),
      depType: d.depType,
      lagDays: d.lagDays,
      predecessorName: d.predecessor?.taskName || null,
    })) || [],
    children: t.childTasks?.map(serializeTask) || [],
  };
}

// 진척률 자동 산정: 하위 태스크 **가중** 평균 (재귀)
async function recalcProgress(taskId: bigint): Promise<void> {
  const children = await prisma.wbsTask.findMany({
    where: { parentTaskId: taskId },
    select: { taskId: true, progressRate: true, weight: true },
  });

  if (children.length === 0) return;

  const totalWeight = children.reduce((sum, c) => sum + Number(c.weight), 0);
  let avg: number;
  if (totalWeight > 0) {
    // 가중 평균: Σ(진척률 × 가중치) / Σ(가중치)
    avg = children.reduce((sum, c) => sum + Number(c.progressRate) * Number(c.weight), 0) / totalWeight;
  } else {
    // 가중치 미설정 시 단순 평균
    avg = children.reduce((sum, c) => sum + Number(c.progressRate), 0) / children.length;
  }

  await prisma.wbsTask.update({
    where: { taskId },
    data: { progressRate: Math.round(avg * 100) / 100 },
  });

  // 상위로 전파
  const parent = await prisma.wbsTask.findUnique({
    where: { taskId },
    select: { parentTaskId: true },
  });
  if (parent?.parentTaskId) {
    await recalcProgress(parent.parentTaskId);
  }
}

// GET /api/v1/projects/:projectId/wbs — WBS 트리 전체 조회
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const { flat } = req.query;

    if (flat === 'true') {
      // 플랫 목록 (간트차트용) — WBS 코드 자연 정렬
      const tasks = await prisma.wbsTask.findMany({
        where: { projectId },
        include: {
          assignee: { select: { userId: true, userName: true } },
          predecessors: { include: { predecessor: { select: { taskId: true, taskName: true } } } },
          childTasks: { select: { taskId: true } },
        },
      });
      const sorted = sortByWbs(tasks);
      _progressMap = calcAllProgress(sorted);
      const result = sorted.map(serializeTask);
      _progressMap = null;
      res.json({ success: true, data: result });
      return;
    }

    // 트리 구조 — WBS 코드 자연 정렬
    const allTasksRaw = await prisma.wbsTask.findMany({
      where: { projectId },
      include: {
        assignee: { select: { userId: true, userName: true } },
        predecessors: { include: { predecessor: { select: { taskId: true, taskName: true } } } },
        childTasks: { select: { taskId: true } },
      },
    });
    const allTasks = sortByWbs(allTasksRaw);
    _progressMap = calcAllProgress(allTasks);

    // 트리 빌드
    const taskMap = new Map<number, any>();
    const roots: any[] = [];

    for (const t of allTasks) {
      const serialized = { ...serializeTask(t), children: [] };
      taskMap.set(Number(t.taskId), serialized);
    }

    for (const t of allTasks) {
      const serialized = taskMap.get(Number(t.taskId));
      if (t.parentTaskId) {
        const parent = taskMap.get(Number(t.parentTaskId));
        if (parent) parent.children.push(serialized);
      } else {
        roots.push(serialized);
      }
    }

    _progressMap = null;
    res.json({ success: true, data: roots });
  } catch (err) {
    console.error('WBS list error:', err);
    res.status(500).json({ success: false, message: 'WBS 조회 중 오류가 발생했습니다.' });
  }
});

// *** 고정 경로는 /:taskId 보다 반드시 위에 선언 ***
// GET /api/v1/projects/:projectId/wbs/weight-check
router.get('/weight-check', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const allTasks = await prisma.wbsTask.findMany({
      where: { projectId },
      select: { taskId: true, wbsCode: true, taskName: true, parentTaskId: true, weight: true },
      orderBy: { sortOrder: 'asc' },
    });
    const parentIds = new Set(allTasks.filter(t => t.parentTaskId).map(t => Number(t.parentTaskId)));
    const warnings: any[] = [];
    for (const pid of parentIds) {
      const parent = allTasks.find(t => Number(t.taskId) === pid);
      if (!parent) continue;
      const children = allTasks.filter(t => Number(t.parentTaskId) === pid);
      const sum = Math.round(children.reduce((s, c) => s + Number(c.weight), 0) * 100) / 100;
      if (sum !== 100) {
        warnings.push({
          taskId: pid, wbsCode: parent.wbsCode || '', taskName: parent.taskName,
          childrenSum: sum, diff: Math.round((100 - sum) * 100) / 100,
          children: children.map(c => ({ wbsCode: c.wbsCode || '', taskName: c.taskName, weight: Number(c.weight) })),
        });
      }
    }
    res.json({ success: true, data: { valid: warnings.length === 0, warnings } });
  } catch (err) {
    console.error('Weight check error:', err);
    res.status(500).json({ success: false, message: '가중치 검증 중 오류가 발생했습니다.' });
  }
});

// GET /api/v1/projects/:projectId/wbs/export — 인증을 쿼리 파라미터로도 허용
router.get('/export', async (req: Request, res: Response) => {
  // window.open 호출 시 Authorization 헤더 불가 → 쿼리 토큰 허용
  const token = req.query.token as string || req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = verifyToken(token);
      (req as any).user = decoded;
    } catch {
      res.status(401).json({ success: false, message: '유효하지 않은 토큰입니다.' });
      return;
    }
  } else {
    res.status(401).json({ success: false, message: '인증 토큰이 필요합니다.' });
    return;
  }

  const projectId = BigInt(req.params.projectId);
  const tasksRaw = await prisma.wbsTask.findMany({
    where: { projectId },
    include: {
      assignee: { select: { userName: true } },
      predecessors: { include: { predecessor: { select: { wbsCode: true, taskName: true } } } },
      deliverables: { select: { docType: true, docName: true } },
    },
  });
  const tasks = sortByWbs(tasksRaw as any[]) as any[];
  const idToWbs = new Map<number, string>();
  const childCounters = new Map<number | null, number>();
  for (const t of tasks) {
    const parentId = t.parentTaskId ? Number(t.parentTaskId) : null;
    const cnt = (childCounters.get(parentId) || 0) + 1;
    childCounters.set(parentId, cnt);
    const parentWbs = parentId ? idToWbs.get(parentId) : null;
    idToWbs.set(Number(t.taskId), parentWbs ? `${parentWbs}.${cnt}` : `${cnt}`);
  }
  const rows: any[][] = [['구분', 'WBS', '태스크명', '공정단계', '역할', '담당자', '초기계획시작', '초기계획종료', '초기계획MD', '변경계획시작', '변경계획종료', '변경계획MD', '실제시작', '실제종료', '지연일', '가중치', '계획진행율(%)', '실적진행율(%)', '선행작업', '산출물']];
  for (const t of tasks) {
    const hasKids = tasks.some(c => c.parentTaskId && Number(c.parentTaskId) === Number(t.taskId));
    const fmt = (d: any) => d ? new Date(d).toISOString().substring(0,10).replace(/-/g,'.') : '';
    // MD 계산
    const baselineMd = (t.baselineStart && t.baselineEnd) ? bizDaysBetween(t.baselineStart, t.baselineEnd) : '';
    const planMd = (t.planStart && t.planEnd) ? bizDaysBetween(t.planStart, t.planEnd) : '';
    // 지연일
    let delay: string | number = '';
    if (t.planEnd) {
      const compareDate = t.actualEnd ? new Date(t.actualEnd) : new Date();
      const pe = new Date(t.planEnd);
      if (t.actualEnd || compareDate > pe) {
        if (compareDate > pe) delay = bizDaysBetween(pe, compareDate) - 1;
        else if (compareDate < pe) delay = -(bizDaysBetween(compareDate, pe) - 1);
        else delay = 0;
      }
    }
    // 선행작업
    const preds = (t.predecessors || []).map((d: any) => `${d.predecessor?.wbsCode || ''} ${d.predecessor?.taskName || ''} [${d.depType}]`).join(', ');
    // 산출물
    const docs = (t.deliverables || []).map((d: any) => d.docType).join(', ');

    rows.push([
      hasKids ? '' : 'D',
      t.wbsCode || idToWbs.get(Number(t.taskId)) || '',
      t.taskName,
      t.phase || '',
      t.taskRole || '',
      t.assignee?.userName || '',
      fmt(t.baselineStart), fmt(t.baselineEnd), baselineMd,
      fmt(t.planStart), fmt(t.planEnd), planMd,
      fmt(t.actualStart), fmt(t.actualEnd),
      delay,
      Number(t.weight),
      Number(t.progressRate),
      Number(t.actualRate || 0),
      preds,
      docs,
    ]);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch:4 },{ wch:12 },{ wch:40 },{ wch:8 },{ wch:6 },{ wch:10 },
    { wch:12 },{ wch:12 },{ wch:5 },
    { wch:12 },{ wch:12 },{ wch:5 },
    { wch:12 },{ wch:12 },
    { wch:5 },{ wch:7 },{ wch:8 },{ wch:8 },
    { wch:30 },{ wch:25 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'pmsfGrid');
  const exportDir = path.join(process.cwd(), 'uploads', 'temp');
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
  const filename = `wbs_export_${Date.now()}.xlsx`;
  const filepath = path.join(exportDir, filename);
  XLSX.writeFile(wb, filepath);
  res.download(filepath, `WBS_${projectId}.xlsx`, () => { try { fs.unlinkSync(filepath); } catch {} });
});

// GET /api/v1/projects/:projectId/wbs/business-weights — 업무별 가중치 조회
router.get('/business-weights', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);

    // depth 2 태스크 = 업무 (depth 1은 프로젝트 전체)
    const businesses = await prisma.wbsTask.findMany({
      where: { projectId, depth: 2 },
      select: { taskId: true, wbsCode: true, taskName: true, bizWeight: true, phaseWeights: true },
      orderBy: { sortOrder: 'asc' },
    });

    // 실적 등록 여부 확인 (잠금 판단)
    const hasActual = await prisma.wbsTask.count({
      where: {
        projectId,
        OR: [
          { actualStart: { not: null } },
          { actualEnd: { not: null } },
          { progressRate: { gt: 0 } },
        ],
      },
    });

    // 프로젝트 기본 단계 가중치
    const project = await prisma.project.findUnique({ where: { projectId }, select: { phaseWeights: true } });
    const defaultPhaseWeights = (project?.phaseWeights as any) || { '분석': 20, '설계': 20, '구현': 40, '시험': 10, '이행': 10 };

    res.json({
      success: true,
      data: {
        locked: hasActual > 0,
        defaultPhaseWeights,
        businesses: businesses.map(b => ({
          taskId: Number(b.taskId),
          wbsCode: b.wbsCode,
          taskName: b.taskName,
          bizWeight: Number(b.bizWeight),
          phaseWeights: b.phaseWeights || null,
        })),
      },
    });
  } catch (err) {
    console.error('Business weights get error:', err);
    res.status(500).json({ success: false, message: '업무별 가중치 조회 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/projects/:projectId/wbs/business-weights — 업무별 가중치 저장
router.put('/business-weights', async (req: Request, res: Response) => {
  try {
    if (!(await requirePmsAdmin(req, res))) return;
    const projectId = BigInt(req.params.projectId);

    // 잠금 체크 (강제 해제 옵션)
    const { businesses, forceUnlock } = req.body;
    // businesses: [{ taskId, weight, phaseWeights }]

    if (!forceUnlock) {
      const hasActual = await prisma.wbsTask.count({
        where: {
          projectId,
          OR: [
            { actualStart: { not: null } },
            { actualEnd: { not: null } },
            { progressRate: { gt: 0 } },
          ],
        },
      });
      if (hasActual > 0) {
        res.status(409).json({ success: false, message: '실적이 등록된 태스크가 있어 가중치를 변경할 수 없습니다. 강제 해제가 필요합니다.' });
        return;
      }
    }

    if (!businesses || !Array.isArray(businesses)) {
      res.status(400).json({ success: false, message: '업무 목록이 필요합니다.' });
      return;
    }

    for (const b of businesses) {
      await prisma.wbsTask.update({
        where: { taskId: BigInt(b.taskId) },
        data: {
          bizWeight: b.bizWeight,
          phaseWeights: b.phaseWeights || null,
        },
      });
    }

    res.json({ success: true, message: '업무별 가중치가 저장되었습니다.' });
  } catch (err) {
    console.error('Business weights save error:', err);
    res.status(500).json({ success: false, message: '업무별 가중치 저장 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/projects/:projectId/wbs/business-weights/unlock — 잠금 해제
router.post('/business-weights/unlock', async (req: Request, res: Response) => {
  try {
    if (!(await requirePmsAdmin(req, res))) return;
    // 잠금 해제 = 클라이언트에서 forceUnlock: true로 저장 허용
    res.json({ success: true, message: '잠금이 해제되었습니다. 가중치를 수정할 수 있습니다.' });
  } catch (err) {
    res.status(500).json({ success: false, message: '잠금 해제 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/projects/:projectId/wbs/calc-weights — 태스크 가중치 자동산정 (MD비율)
router.post('/calc-weights', async (req: Request, res: Response) => {
  try {
    if (!(await requirePmsAdmin(req, res))) return;
    const projectId = BigInt(req.params.projectId);

    // 프로젝트의 phaseWeights 로드
    const project = await prisma.project.findUnique({ where: { projectId }, select: { phaseWeights: true } });
    const phaseWeights: Record<string, number> = (project?.phaseWeights as any) || { '분석': 20, '설계': 20, '구현': 40, '시험': 10, '이행': 10 };

    const allTasks = await prisma.wbsTask.findMany({
      where: { projectId },
      select: { taskId: true, parentTaskId: true, phase: true, planStart: true, planEnd: true, depth: true },
      orderBy: { sortOrder: 'asc' },
    });

    // 부모별로 자식 그룹핑
    const childrenOf = new Map<number | null, typeof allTasks>();
    for (const t of allTasks) {
      const pid = t.parentTaskId ? Number(t.parentTaskId) : null;
      if (!childrenOf.has(pid)) childrenOf.set(pid, []);
      childrenOf.get(pid)!.push(t);
    }

    let updated = 0;
    // 각 부모의 자식들에 대해 MD 비율로 가중치 산정
    for (const [parentId, children] of childrenOf) {
      // 각 자식의 계획MD 계산
      const mds = children.map(c => {
        if (c.planStart && c.planEnd) return bizDaysBetween(c.planStart, c.planEnd);
        return 0;
      });
      const totalMd = mds.reduce((s, m) => s + m, 0);
      if (totalMd === 0) continue;

      // 각 자식의 가중치를 소수점 2자리로 산정 후 합계 100% 보정
      const weights = mds.map(m => Math.floor(m / totalMd * 10000) / 100); // floor로 내림
      let remainder = Math.round((100 - weights.reduce((s, w) => s + w, 0)) * 100) / 100;

      // 나머지를 가장 큰 MD 항목부터 0.01씩 분배
      const sortedIdx = mds.map((_, i) => i).sort((a, b) => mds[b] - mds[a]);
      let ri = 0;
      while (remainder > 0.005 && ri < sortedIdx.length) {
        weights[sortedIdx[ri]] = Math.round((weights[sortedIdx[ri]] + 0.01) * 100) / 100;
        remainder = Math.round((remainder - 0.01) * 100) / 100;
        ri++;
        if (ri >= sortedIdx.length) ri = 0;
      }

      for (let i = 0; i < children.length; i++) {
        await prisma.wbsTask.update({
          where: { taskId: children[i].taskId },
          data: { weight: weights[i] },
        });
        updated++;
      }
    }

    // depth=2 태스크(단계)에 phaseWeights 적용
    const depth2 = allTasks.filter(t => t.depth === 2);
    for (const stage of depth2) {
      const phase = stage.phase;
      if (phase && phaseWeights[phase] !== undefined) {
        await prisma.wbsTask.update({
          where: { taskId: stage.taskId },
          data: { weight: phaseWeights[phase] },
        });
      }
    }

    res.json({ success: true, data: { updated }, message: `${updated}개 태스크의 가중치가 MD 비율로 산정되었습니다.` });
  } catch (err) {
    console.error('Calc weights error:', err);
    res.status(500).json({ success: false, message: '가중치 산정 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/projects/:projectId/wbs/reset-actuals — 실적 초기화
router.post('/reset-actuals', async (req: Request, res: Response) => {
  try {
    if (!(await requirePmsAdmin(req, res))) return;
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);

    // 모든 태스크 실적 초기화
    const taskResult = await prisma.wbsTask.updateMany({
      where: { projectId },
      data: { actualStart: null, actualEnd: null, actualRate: 0, actualMd: null },
    });

    // 모든 산출물 승인 상태 초기화
    const deliverables = await prisma.deliverable.findMany({
      where: { task: { projectId } },
      select: { docId: true },
    });
    for (const d of deliverables) {
      await prisma.deliverableApproval.deleteMany({ where: { docId: d.docId } });
    }
    await prisma.deliverable.updateMany({
      where: { task: { projectId } },
      data: { status: '등록', approvalDepth: 0 },
    });

    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'wbs_reset', changeDetail: { action: '실적초기화', tasksReset: taskResult.count, docsReset: deliverables.length } });
    res.json({ success: true, message: `실적이 초기화되었습니다. (태스크 ${taskResult.count}건, 산출물 ${deliverables.length}건)` });
  } catch (err) {
    console.error('Reset actuals error:', err);
    res.status(500).json({ success: false, message: '실적 초기화 중 오류가 발생했습니다.' });
  }
});


// GET /api/v1/projects/:projectId/wbs/import-template — 임포트 템플릿 다운로드
router.get('/import-template', async (_req: Request, res: Response) => {
  try {
    const headers = ['WBS', '작업이름', '공정단계', '담당자', '계획시작일', '계획종료일', '선행작업', '산출물'];
    const example =  ['1.1',   '분석단계',     '분석', '홍길동', '2026.04.01', '2026.05.31', '',                          ''];
    const example2 = ['1.1.1', '현행시스템분석', '분석', '김개발', '2026.04.01', '2026.04.15', '1.1 FS',                    '현행시스템분석서'];
    const example3 = ['1.1.2', '요구사항정의',   '분석', '이분석', '2026.04.10', '2026.04.30', '1.1.1 FS, 1.1 SS',         '요구사항정의서, 요구사항추적표'];
    const note1 = ['※ 필수: WBS, 작업이름, 공정단계, 계획시작일, 계획종료일', '', '', '', '', '', '', ''];
    const note2 = ['※ 날짜형식: YYYY.MM.DD | WBS 계층구조(1.1→1.1.1)로 상위-하위 자동 구성', '', '', '', '', '', '', ''];
    const note3 = ['※ 선행작업: "WBS코드 관계타입" (예: 1.1.1 FS) 콤마 구분으로 복수 입력 가능', '', '', '', '', '', '', ''];
    const note4 = ['※ 관계타입: FS(완료→시작), SS(동시시작), FF(동시완료), SF(시작→완료)', '', '', '', '', '', '', ''];
    const note5 = ['※ 산출물: 산출물명을 콤마 구분으로 복수 입력 가능', '', '', '', '', '', '', ''];
    const note6 = ['※ 초기계획은 계획시작일/종료일과 동일한 값으로 자동 설정됩니다', '', '', '', '', '', '', ''];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, example, example2, example3, [], note1, note2, note3, note4, note5, note6]);
    ws['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 25 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, 'WBS임포트');

    const exportDir = path.join(process.cwd(), 'uploads', 'temp');
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
    const filepath = path.join(exportDir, 'wbs_import_template.xlsx');
    XLSX.writeFile(wb, filepath);

    res.download(filepath, 'WBS_임포트_템플릿.xlsx', () => {
      try { fs.unlinkSync(filepath); } catch {}
    });
  } catch (err) {
    console.error('Template error:', err);
    res.status(500).json({ success: false, message: '템플릿 생성 중 오류가 발생했습니다.' });
  }
});

// GET /api/v1/projects/:projectId/wbs/progress-report
router.get('/progress-report', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const { baseDate } = req.query;
    const refDate = baseDate ? new Date(baseDate as string) : new Date();

    const allTasks = await prisma.wbsTask.findMany({
      where: { projectId },
      select: {
        taskId: true, wbsCode: true, taskName: true, parentTaskId: true, depth: true,
        planStart: true, planEnd: true, progressRate: true, actualRate: true, weight: true,
        childTasks: { select: { taskId: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    const leaves = allTasks.filter(t => t.childTasks.length === 0);
    const totalPlanMd = leaves.reduce((s, t) => {
      if (t.planStart && t.planEnd) return s + bizDaysBetween(t.planStart, t.planEnd);
      return s;
    }, 0);

    let planMdByRef = 0;
    for (const t of leaves) {
      if (!t.planStart || !t.planEnd) continue;
      const taskMd = bizDaysBetween(t.planStart, t.planEnd);
      if (refDate >= t.planEnd) planMdByRef += taskMd;
      else if (refDate >= t.planStart) planMdByRef += bizDaysBetween(t.planStart, refDate);
    }

    // 단계별 집계 (depth=2)
    const phases = new Map<string, { name: string; weight: number; planProgress: number; actualProgress: number; tasks: number }>();
    const depth2 = allTasks.filter(t => t.depth === 2);
    for (const stage of depth2) {
      const stageLeaves = leaves.filter(l => {
        let cur: any = l;
        while (cur) {
          if (Number(cur.parentTaskId) === Number(stage.taskId)) return true;
          cur = allTasks.find(a => Number(a.taskId) === Number(cur.parentTaskId));
        }
        return false;
      });
      const totalW = stageLeaves.reduce((s, t) => s + Number(t.weight), 0);
      const planProg = totalW > 0 ? stageLeaves.reduce((s, t) => s + Number(t.progressRate) * Number(t.weight), 0) / totalW : 0;
      const actProg = totalW > 0 ? stageLeaves.reduce((s, t) => s + Number(t.actualRate) * Number(t.weight), 0) / totalW : 0;
      phases.set(stage.wbsCode || String(stage.taskId), {
        name: stage.taskName, weight: Number(stage.weight),
        planProgress: Math.round(planProg * 100) / 100, actualProgress: Math.round(actProg * 100) / 100,
        tasks: stageLeaves.length,
      });
    }

    let totalPlanProgress = 0, totalActualProgress = 0, totalWeight = 0;
    for (const [, p] of phases) {
      totalPlanProgress += p.planProgress * p.weight;
      totalActualProgress += p.actualProgress * p.weight;
      totalWeight += p.weight;
    }
    if (totalWeight > 0) {
      totalPlanProgress = Math.round(totalPlanProgress / totalWeight * 100) / 100;
      totalActualProgress = Math.round(totalActualProgress / totalWeight * 100) / 100;
    }

    const planProgressByRef = totalPlanMd > 0 ? Math.round(planMdByRef / totalPlanMd * 10000) / 100 : 0;
    const vsProgress = planProgressByRef > 0 ? Math.round(totalActualProgress / planProgressByRef * 10000) / 100 : 0;

    res.json({
      success: true,
      data: {
        baseDate: refDate.toISOString().substring(0, 10),
        totalPlanMd, planMdByRef, planProgressByRef,
        totalPlanProgress, totalActualProgress, vsProgress,
        phases: Object.fromEntries(phases),
      },
    });
  } catch (err) {
    console.error('Progress report error:', err);
    res.status(500).json({ success: false, message: '진척률 리포트 조회 중 오류가 발생했습니다.' });
  }
});

// GET /api/v1/projects/:projectId/wbs/progress-weekly — 주단위 공정 진척 추이
router.get('/progress-weekly', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);

    // 프로젝트 기간 조회
    const project = await prisma.project.findUnique({
      where: { projectId },
      select: { startDate: true, endDate: true },
    });
    if (!project) { res.status(404).json({ success: false, message: '프로젝트를 찾을 수 없습니다.' }); return; }

    const allTasks = await prisma.wbsTask.findMany({
      where: { projectId },
      select: {
        taskId: true, parentTaskId: true, depth: true, wbsCode: true, taskName: true,
        planStart: true, planEnd: true, progressRate: true, actualRate: true, weight: true,
        childTasks: { select: { taskId: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    const leaves = allTasks.filter(t => t.childTasks.length === 0);
    const totalPlanMd = leaves.reduce((s, t) => {
      if (t.planStart && t.planEnd) return s + bizDaysBetween(t.planStart, t.planEnd);
      return s;
    }, 0);

    // calcAllProgress 방식으로 실적 산정 (WBS 트리와 동일)
    const progressMap = calcAllProgress(allTasks);
    const rootTask = allTasks.find(t => t.depth === 1);
    const rootProgress = rootTask ? progressMap.get(Number(rootTask.taskId)) : null;
    const currentActual = rootProgress ? rootProgress.actualRate : 0;

    // 프로젝트 시작~종료 주간 날짜 생성 (매주 월요일 기준)
    const start = new Date(project.startDate);
    const end = new Date(project.endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 첫 번째 월요일 찾기
    const firstMonday = new Date(start);
    const dow = firstMonday.getDay();
    if (dow !== 1) firstMonday.setDate(firstMonday.getDate() + ((8 - dow) % 7));

    const weeks: { date: string; plan: number; actual: number; diff: number; status: string }[] = [];
    const cur = new Date(firstMonday);

    while (cur <= end) {
      const refDate = new Date(cur);
      refDate.setHours(0, 0, 0, 0);

      // 해당 날짜 기준 계획진행률 산정
      let planMdByRef = 0;
      for (const t of leaves) {
        if (!t.planStart || !t.planEnd) continue;
        const ts = new Date(t.planStart); ts.setHours(0, 0, 0, 0);
        const te = new Date(t.planEnd); te.setHours(0, 0, 0, 0);
        const taskMd = bizDaysBetween(ts, te);
        if (refDate >= te) planMdByRef += taskMd;
        else if (refDate >= ts) planMdByRef += bizDaysBetween(ts, refDate);
      }
      const planProgress = totalPlanMd > 0 ? Math.round(planMdByRef / totalPlanMd * 1000) / 10 : 0;

      // 실적: 과거 날짜는 실적 데이터 없으므로, 현재 날짜까지만 실적 표시
      const actual = refDate <= today ? currentActual : 0;
      const diff = refDate <= today ? Math.round((actual - planProgress) * 10) / 10 : 0;
      const status = diff > 0 ? '▲' : diff < 0 ? '▼' : '';

      weeks.push({
        date: refDate.toISOString().substring(0, 10),
        plan: planProgress,
        actual: refDate <= today ? actual : 0,
        diff: refDate <= today ? diff : 0,
        status,
      });

      cur.setDate(cur.getDate() + 7);
    }

    // ── 업무별(depth=2) 주간 진척 ──
    const depth2 = allTasks.filter(t => t.depth === 2);
    const businesses: any[] = [];

    for (const biz of depth2) {
      // 해당 업무의 리프 태스크 찾기
      const bizLeaves = leaves.filter(l => {
        let c: any = l;
        while (c) {
          if (Number(c.parentTaskId) === Number(biz.taskId)) return true;
          c = allTasks.find(a => Number(a.taskId) === Number(c.parentTaskId));
        }
        return false;
      });
      if (!bizLeaves.length) continue;

      const bizPlanMd = bizLeaves.reduce((s, t) => {
        if (t.planStart && t.planEnd) return s + bizDaysBetween(t.planStart, t.planEnd);
        return s;
      }, 0);
      // calcAllProgress 방식으로 업무별 실적/계획 (WBS 트리와 동일)
      const bizProgress = progressMap.get(Number(biz.taskId));
      const bizActual = bizProgress ? bizProgress.actualRate : 0;
      const bizPlan = bizProgress ? bizProgress.progressRate : 0;

      // 주간 데이터
      const bizWeeks: { date: string; plan: number; actual: number; diff: number }[] = [];
      const bcur = new Date(firstMonday);
      while (bcur <= end) {
        const refDate = new Date(bcur); refDate.setHours(0, 0, 0, 0);
        let bPlanMdByRef = 0;
        for (const t of bizLeaves) {
          if (!t.planStart || !t.planEnd) continue;
          const ts = new Date(t.planStart); ts.setHours(0, 0, 0, 0);
          const te = new Date(t.planEnd); te.setHours(0, 0, 0, 0);
          const md = bizDaysBetween(ts, te);
          if (refDate >= te) bPlanMdByRef += md;
          else if (refDate >= ts) bPlanMdByRef += bizDaysBetween(ts, refDate);
        }
        const bPlan = bizPlanMd > 0 ? Math.round(bPlanMdByRef / bizPlanMd * 1000) / 10 : 0;
        const bActual = refDate <= today ? bizActual : 0;
        bizWeeks.push({
          date: refDate.toISOString().substring(0, 10),
          plan: bPlan,
          actual: bActual,
          diff: refDate <= today ? Math.round((bActual - bPlan) * 10) / 10 : 0,
        });
        bcur.setDate(bcur.getDate() + 7);
      }

      businesses.push({
        wbsCode: biz.wbsCode, taskName: biz.taskName,
        currentPlan: bizPlan, currentActual: bizActual,
        diff: Math.round((bizActual - bizPlan) * 10) / 10,
        taskCount: bizLeaves.length,
        weeks: bizWeeks,
      });
    }

    res.json({
      success: true,
      data: {
        projectStart: start.toISOString().substring(0, 10),
        projectEnd: end.toISOString().substring(0, 10),
        totalCount: weeks.length,
        weeks,
        businesses,
      },
    });
  } catch (err) {
    console.error('Progress weekly error:', err);
    res.status(500).json({ success: false, message: '주단위 진척 현황 조회 중 오류가 발생했습니다.' });
  }
});

// GET /api/v1/projects/:projectId/wbs/:taskId — 태스크 상세
router.get('/:taskId', async (req: Request, res: Response) => {
  try {
    const taskId = BigInt(req.params.taskId);
    const task = await prisma.wbsTask.findUnique({
      where: { taskId },
      include: {
        assignee: { select: { userId: true, userName: true } },
        childTasks: {
          include: { assignee: { select: { userId: true, userName: true } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!task) {
      res.status(404).json({ success: false, message: '태스크를 찾을 수 없습니다.' });
      return;
    }

    res.json({ success: true, data: serializeTask(task) });
  } catch (err) {
    console.error('WBS detail error:', err);
    res.status(500).json({ success: false, message: '태스크 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/projects/:projectId/wbs — 태스크 생성
router.post('/', async (req: Request, res: Response) => {
  try {
    if (!(await requirePmsAdmin(req, res))) return;
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const lockMsg = await checkWbsStructureLock(projectId, req.body.forceUnlock);
    if (lockMsg) { res.status(409).json({ success: false, message: lockMsg }); return; }
    const { parentTaskId, taskName, phase, planStart, planEnd, duration, assigneeId, sortOrder, weight, wbsCode } = req.body;

    if (!taskName) {
      res.status(400).json({ success: false, message: '태스크명은 필수입니다.' });
      return;
    }

    // depth 계산
    let depth = 1;
    if (parentTaskId) {
      const parent = await prisma.wbsTask.findUnique({
        where: { taskId: BigInt(parentTaskId) },
        select: { depth: true },
      });
      if (parent) {
        if (parent.depth >= 12) {
          res.status(400).json({ success: false, message: '최대 5 depth까지 허용됩니다.' });
          return;
        }
        depth = parent.depth + 1;
      }
    }

    // sortOrder 자동 계산
    let order = sortOrder;
    if (order === undefined || order === null) {
      const lastSibling = await prisma.wbsTask.findFirst({
        where: { projectId, parentTaskId: parentTaskId ? BigInt(parentTaskId) : null },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      order = (lastSibling?.sortOrder || 0) + 1;
    }

    // wbsCode 자동 채번
    let autoWbsCode = wbsCode;
    if (!autoWbsCode) {
      const siblingCount = await prisma.wbsTask.count({
        where: { projectId, parentTaskId: parentTaskId ? BigInt(parentTaskId) : null },
      });
      const newSeq = siblingCount + 1;
      if (parentTaskId) {
        const parent = await prisma.wbsTask.findUnique({
          where: { taskId: BigInt(parentTaskId) },
          select: { wbsCode: true },
        });
        autoWbsCode = parent?.wbsCode ? `${parent.wbsCode}.${newSeq}` : `${newSeq}`;
      } else {
        autoWbsCode = `${newSeq}`;
      }
    }

    const pStart = toWorkingDayStart(planStart ? new Date(planStart) : null);
    const pEnd = toWorkingDayEnd(planEnd ? new Date(planEnd) : null);

    const task = await prisma.wbsTask.create({
      data: {
        projectId,
        parentTaskId: parentTaskId ? BigInt(parentTaskId) : null,
        wbsCode: autoWbsCode || null,
        taskName,
        phase: phase || null,
        depth,
        sortOrder: order,
        planStart: pStart,
        planEnd: pEnd,
        baselineStart: pStart,
        baselineEnd: pEnd,
        duration: duration || null,
        weight: weight ?? 1,
        assigneeId: assigneeId || null,
      },
      include: {
        assignee: { select: { userId: true, userName: true } },
        predecessors: { include: { predecessor: { select: { taskId: true, taskName: true } } } },
      },
    });

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'CREATE',
      targetType: 'wbs_task',
      targetId: task.taskId,
      changeDetail: { taskName, phase },
    });

    res.status(201).json({ success: true, data: serializeTask(task), message: '태스크가 생성되었습니다.' });
  } catch (err) {
    console.error('WBS create error:', err);
    res.status(500).json({ success: false, message: '태스크 생성 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/projects/:projectId/wbs/:taskId — 태스크 수정
router.put('/:taskId', authenticate, async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const taskId = BigInt(req.params.taskId);
    const { wbsCode, taskName, phase, planStart, planEnd, baselineStart, baselineEnd, duration, actualStart, actualEnd, actualMd, progressRate, actualRate, weight, taskRole, assigneeId, sortOrder } = req.body;

    // 역할별 권한 체크
    const task = await prisma.wbsTask.findUnique({ where: { taskId }, select: { assigneeId: true, projectId: true } });
    if (!task) { res.status(404).json({ success: false, message: '태스크를 찾을 수 없습니다.' }); return; }

    const roleInfo = await getProjectRole(currentUser.userId, task.projectId, currentUser.systemRole);

    // PMS관리자/시스템관리자: 전체 수정 가능
    // 팀장/팀원/PM/PMO: 본인 담당 태스크 실적 필드만 수정 가능
    // Customer/Inspector: 수정 불가
    if (!roleInfo.isPmsAdmin) {
      // Customer/Inspector: 완전 조회 전용
      if (roleInfo.role === 'Customer' || roleInfo.role === 'Inspector') {
        res.status(403).json({ success: false, message: '조회 전용 역할은 태스크를 수정할 수 없습니다.' });
        return;
      }
      // PM/PMO: 본인 담당 태스크의 실적 필드만 허용
      if (roleInfo.isMonitor) {
        if (task.assigneeId !== currentUser.userId) {
          res.status(403).json({ success: false, message: '본인에게 할당된 태스크만 실적을 등록할 수 있습니다.' });
          return;
        }
        if (!isOnlyActualFields(req.body)) {
          res.status(403).json({ success: false, message: '실적 항목(실제시작/종료, 진척률)만 등록 가능합니다.' });
          return;
        }
      }
      // 팀장/팀원: 실적만 수정 가능
      if (!isOnlyActualFields(req.body)) {
        res.status(403).json({ success: false, message: 'PMS관리자만 태스크를 수정할 수 있습니다. 실적 항목(실제시작/종료, 진척률)만 등록 가능합니다.' });
        return;
      }
      if (roleInfo.isMember) {
        // 팀원: 본인 태스크만
        if (task.assigneeId !== currentUser.userId) {
          res.status(403).json({ success: false, message: '본인에게 할당된 태스크만 실적을 등록할 수 있습니다.' });
          return;
        }
      } else if (roleInfo.isLeader) {
        // 팀장: 소속 팀원 태스크
        const canEdit = await canLeaderEditTask(roleInfo.department, task.assigneeId);
        if (!canEdit) {
          res.status(403).json({ success: false, message: '소속 팀원의 태스크만 실적을 등록할 수 있습니다.' });
          return;
        }
      } else if (!roleInfo.isMonitor) {
        // PM/PMO는 위 isMonitor 분기에서 이미 본인 담당+실적 필드 검증 완료
        res.status(403).json({ success: false, message: '실적 등록 권한이 없습니다.' });
        return;
      }
    }

    // 부모 태스크: 일정/실적 필드 직접 수정 차단 (자식에서 자동 집계)
    const childCount = await prisma.wbsTask.count({ where: { parentTaskId: taskId } });
    const isParentTask = childCount > 0;

    const data: any = {};
    if (wbsCode !== undefined) data.wbsCode = wbsCode;
    if (taskName !== undefined) data.taskName = taskName;
    if (phase !== undefined) data.phase = phase;
    if (!isParentTask && planStart !== undefined) data.planStart = toWorkingDayStart(planStart ? new Date(planStart) : null);
    if (!isParentTask && baselineStart !== undefined) data.baselineStart = toWorkingDayStart(baselineStart ? new Date(baselineStart) : null);
    if (!isParentTask && baselineEnd !== undefined) data.baselineEnd = toWorkingDayEnd(baselineEnd ? new Date(baselineEnd) : null);
    if (!isParentTask && planEnd !== undefined) data.planEnd = toWorkingDayEnd(planEnd ? new Date(planEnd) : null);
    if (!isParentTask && actualStart !== undefined) data.actualStart = toWorkingDayStart(actualStart ? new Date(actualStart) : null);
    if (!isParentTask && actualEnd !== undefined) data.actualEnd = toWorkingDayEnd(actualEnd ? new Date(actualEnd) : null);
    if (!isParentTask && progressRate !== undefined) data.progressRate = progressRate;
    if (!isParentTask && actualRate !== undefined) {
      // 실제 시작일 없이 실적 등록 차단
      if (Number(actualRate) > 0) {
        const hasActualStart = data.actualStart || (await prisma.wbsTask.findUnique({ where: { taskId }, select: { actualStart: true } }))?.actualStart;
        if (!hasActualStart && !actualStart) {
          res.status(400).json({ success: false, message: '실제 시작일을 먼저 등록해야 실적을 입력할 수 있습니다.' });
          return;
        }
      }
      // 승인 프로세스 상한 체크 (PMS관리자/시스템관리자는 제외)
      if (!roleInfo.isPmsAdmin) {
        const maxRate = await getMaxActualRate(taskId, task.projectId);
        if (Number(actualRate) > maxRate) {
          res.status(400).json({ success: false, message: `산출물 승인 상태에 따라 실적 진행률은 최대 ${maxRate}%까지만 등록할 수 있습니다.` });
          return;
        }
      }
      data.actualRate = actualRate;
    }
    if (!isParentTask && duration !== undefined) data.duration = duration || null;
    if (!isParentTask && actualMd !== undefined) data.actualMd = actualMd || null;
    if (weight !== undefined) data.weight = weight;
    if (taskRole !== undefined) data.taskRole = taskRole || null;
    if (assigneeId !== undefined) data.assigneeId = assigneeId || null;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;

    const updated = await prisma.wbsTask.update({
      where: { taskId },
      data,
      include: { assignee: { select: { userId: true, userName: true } } },
    });

    // 진척률 변경 시 상위 태스크 자동 재산정
    if (progressRate !== undefined && updated.parentTaskId) {
      await recalcProgress(updated.parentTaskId);
    }

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'UPDATE',
      targetType: 'wbs_task',
      targetId: taskId,
      changeDetail: { fields: Object.keys(data) },
    });

    // 가중치 변경 시 부모의 자식 합계 경고
    let weightWarning: string | null = null;
    if (weight !== undefined && updated.parentTaskId) {
      const siblings = await prisma.wbsTask.findMany({
        where: { parentTaskId: updated.parentTaskId },
        select: { weight: true },
      });
      const sum = Math.round(siblings.reduce((s, c) => s + Number(c.weight), 0) * 100) / 100;
      if (sum !== 100) {
        weightWarning = `하위 태스크 가중치 합계: ${sum}% (100%와 ${Math.abs(100 - sum)}% 차이). 가중치를 조정해주세요.`;
      }
    }

    res.json({
      success: true,
      data: serializeTask(updated),
      message: '태스크가 수정되었습니다.',
      weightWarning,
    });
  } catch (err) {
    console.error('WBS update error:', err);
    res.status(500).json({ success: false, message: '태스크 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/v1/projects/:projectId/wbs/:taskId — 태스크 삭제
router.delete('/:taskId', async (req: Request, res: Response) => {
  try {
    if (!(await requirePmsAdmin(req, res))) return;
    const projectId = BigInt(req.params.projectId);
    const lockMsg = await checkWbsStructureLock(projectId, req.body?.forceUnlock);
    if (lockMsg) { res.status(409).json({ success: false, message: lockMsg }); return; }
    const currentUser = (req as any).user as JwtPayload;
    const taskId = BigInt(req.params.taskId);

    // 하위 태스크 존재 확인
    const childCount = await prisma.wbsTask.count({ where: { parentTaskId: taskId } });
    if (childCount > 0) {
      res.status(400).json({ success: false, message: '하위 태스크가 있어 삭제할 수 없습니다. 하위 태스크를 먼저 삭제해주세요.' });
      return;
    }

    const task = await prisma.wbsTask.findUnique({ where: { taskId }, select: { parentTaskId: true } });

    await prisma.taskDependency.deleteMany({ where: { OR: [{ predecessorId: taskId }, { successorId: taskId }] } });
    await prisma.wbsTask.delete({ where: { taskId } });

    // 상위 진척률 재산정
    if (task?.parentTaskId) {
      await recalcProgress(task.parentTaskId);
    }

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'DELETE',
      targetType: 'wbs_task',
      targetId: taskId,
    });

    res.json({ success: true, data: null, message: '태스크가 삭제되었습니다.' });
  } catch (err) {
    console.error('WBS delete error:', err);
    res.status(500).json({ success: false, message: '태스크 삭제 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/projects/:projectId/wbs/:taskId/reorder — 태스크 순서 변경
router.put('/:taskId/reorder', async (req: Request, res: Response) => {
  try {
    if (!(await requirePmsAdmin(req, res))) return;
    const projectId = BigInt(req.params.projectId);
    const lockMsg = await checkWbsStructureLock(projectId, req.body?.forceUnlock);
    if (lockMsg) { res.status(409).json({ success: false, message: lockMsg }); return; }
    const taskId = BigInt(req.params.taskId);
    const { newParentId, newSortOrder } = req.body;

    const task = await prisma.wbsTask.findUnique({ where: { taskId } });
    if (!task) {
      res.status(404).json({ success: false, message: '태스크를 찾을 수 없습니다.' });
      return;
    }

    let depth = 1;
    if (newParentId) {
      const parent = await prisma.wbsTask.findUnique({ where: { taskId: BigInt(newParentId) }, select: { depth: true } });
      if (parent) depth = parent.depth + 1;
    }

    await prisma.wbsTask.update({
      where: { taskId },
      data: {
        parentTaskId: newParentId ? BigInt(newParentId) : null,
        sortOrder: newSortOrder ?? 0,
        depth,
      },
    });

    res.json({ success: true, message: '태스크 순서가 변경되었습니다.' });
  } catch (err) {
    console.error('WBS reorder error:', err);
    res.status(500).json({ success: false, message: '순서 변경 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/projects/:projectId/wbs/schedule — 스케줄 검증/산정
router.post('/schedule', async (req: Request, res: Response) => {
  try {
    if (!(await requirePmsAdmin(req, res))) return;
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const lockMsg = await checkWbsStructureLock(projectId, req.body?.forceUnlock);
    if (lockMsg) { res.status(409).json({ success: false, message: lockMsg }); return; }
    const { mode } = req.body; // 'check' | 'apply'
    const isApply = mode === 'apply';

    const project = await prisma.project.findUnique({ where: { projectId } });
    if (!project) { res.status(404).json({ success: false, message: '프로젝트를 찾을 수 없습니다.' }); return; }

    const tasks = await prisma.wbsTask.findMany({
      where: { projectId },
      include: { predecessors: { include: { predecessor: { select: { taskId: true, wbsCode: true, taskName: true, planStart: true, planEnd: true } } } }, childTasks: { select: { taskId: true } } },
      orderBy: [{ sortOrder: 'asc' }],
    });
    if (!tasks.length) { res.status(400).json({ success: false, message: '등록된 태스크가 없습니다.' }); return; }

    const taskMap = new Map<bigint, typeof tasks[0]>();
    for (const t of tasks) taskMap.set(t.taskId, t);

    const projectStart = new Date(project.startDate);
    const projectEnd = new Date(project.endDate);
    const warnings: string[] = [];
    const conflicts: { wbsCode: string; taskName: string; depType: string; predName: string; issue: string }[] = [];

    // 1. 선후행 불일치 검증 (모든 태스크)
    for (const t of tasks) {
      if (!t.predecessors.length) continue;
      for (const dep of t.predecessors) {
        const pred = dep.predecessor;
        if (!pred.planEnd || !pred.planStart || !t.planStart || !t.planEnd) continue;

        const predStart = new Date(pred.planStart);
        const predEnd = new Date(pred.planEnd);
        const succStart = new Date(t.planStart);
        const succEnd = new Date(t.planEnd);
        let issue = '';

        switch (dep.depType) {
          case 'FS':
            if (succStart <= predEnd) issue = `후행 시작(${succStart.toISOString().substring(0,10)})이 선행 종료(${predEnd.toISOString().substring(0,10)}) 이전입니다`;
            break;
          case 'SS':
            if (succStart < predStart) issue = `후행 시작(${succStart.toISOString().substring(0,10)})이 선행 시작(${predStart.toISOString().substring(0,10)}) 이전입니다`;
            break;
          case 'FF':
            if (succEnd < predEnd) issue = `후행 종료(${succEnd.toISOString().substring(0,10)})가 선행 종료(${predEnd.toISOString().substring(0,10)}) 이전입니다`;
            break;
          case 'SF':
            if (succEnd < predStart) issue = `후행 종료(${succEnd.toISOString().substring(0,10)})가 선행 시작(${predStart.toISOString().substring(0,10)}) 이전입니다`;
            break;
        }
        if (issue) {
          conflicts.push({
            wbsCode: t.wbsCode || '', taskName: t.taskName,
            depType: dep.depType, predName: `${pred.wbsCode || ''} ${pred.taskName}`,
            issue,
          });
        }
      }
    }

    // 2. 적용 모드: 선후행이 있는 태스크만 일정 재산정
    let updated = 0;
    if (isApply) {
      // 선후행이 있는 태스크 ID 집합
      const hasDepIds = new Set<bigint>();
      for (const t of tasks) {
        if (t.predecessors.length > 0) hasDepIds.add(t.taskId);
        for (const dep of t.predecessors) hasDepIds.add(dep.predecessorId);
      }

      const leafTasks = tasks.filter(t => t.childTasks.length === 0);
      const parentTasks = tasks.filter(t => t.childTasks.length > 0);
      const earlyStart = new Map<bigint, Date>();
      const earlyFinish = new Map<bigint, Date>();

      // 선행 없는 태스크: 기존 일정 유지 또는 프로젝트 시작일
      for (const t of leafTasks) {
        if (t.predecessors.length === 0) {
          earlyStart.set(t.taskId, t.planStart || projectStart);
          const dur = t.duration || (t.planStart && t.planEnd ? bizDaysBetween(t.planStart, t.planEnd) : 1);
          earlyFinish.set(t.taskId, t.planEnd || addBizDays(t.planStart || projectStart, dur - 1));
        }
      }

      // BFS
      const processed = new Set<bigint>();
      const queue = leafTasks.filter(t => t.predecessors.length === 0).map(t => t.taskId);
      while (queue.length > 0) {
        const tid = queue.shift()!;
        if (processed.has(tid)) continue;
        processed.add(tid);

        const ef = earlyFinish.get(tid);
        const es = earlyStart.get(tid);
        if (!ef || !es) continue;

        for (const succ of leafTasks) {
          for (const dep of succ.predecessors) {
            if (dep.predecessorId !== tid) continue;
            let succStart: Date;
            switch (dep.depType) {
              case 'FS': succStart = addBizDays(ef, 1); break;
              case 'SS': succStart = new Date(es); break;
              case 'FF':
                const dFF = succ.duration || (succ.planStart && succ.planEnd ? bizDaysBetween(succ.planStart, succ.planEnd) : 1);
                succStart = addBizDays(ef, -(dFF - 1)); break;
              case 'SF':
                const dSF = succ.duration || (succ.planStart && succ.planEnd ? bizDaysBetween(succ.planStart, succ.planEnd) : 1);
                succStart = addBizDays(es, -(dSF - 1)); break;
              default: succStart = addBizDays(ef, 1);
            }
            const existing = earlyStart.get(succ.taskId);
            if (!existing || succStart > existing) {
              earlyStart.set(succ.taskId, succStart);
              const dur = succ.duration || (succ.planStart && succ.planEnd ? bizDaysBetween(succ.planStart, succ.planEnd) : 1);
              earlyFinish.set(succ.taskId, addBizDays(succStart, dur - 1));
            }
          }
        }

        for (const succ of leafTasks) {
          if (processed.has(succ.taskId)) continue;
          if (succ.predecessors.every(d => processed.has(d.predecessorId)) && earlyStart.has(succ.taskId)) {
            queue.push(succ.taskId);
          }
        }
      }

      // 선후행이 있는 리프 태스크만 DB 업데이트
      for (const t of leafTasks) {
        if (!hasDepIds.has(t.taskId)) continue;
        const ps = earlyStart.get(t.taskId);
        const pe = earlyFinish.get(t.taskId);
        if (ps && pe) {
          await prisma.wbsTask.update({ where: { taskId: t.taskId }, data: { planStart: ps, planEnd: pe } });
          updated++;
        }
      }

      // 부모 태스크 집계
      const sortedParents = [...parentTasks].sort((a, b) => b.depth - a.depth);
      for (const p of sortedParents) {
        const children = await prisma.wbsTask.findMany({ where: { parentTaskId: p.taskId }, select: { planStart: true, planEnd: true } });
        const starts = children.filter(c => c.planStart).map(c => c.planStart!.getTime());
        const ends = children.filter(c => c.planEnd).map(c => c.planEnd!.getTime());
        if (starts.length && ends.length) {
          await prisma.wbsTask.update({ where: { taskId: p.taskId }, data: { planStart: new Date(Math.min(...starts)), planEnd: new Date(Math.max(...ends)) } });
          updated++;
        }
      }

      await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'wbs_schedule', changeDetail: { mode, updated, conflicts: conflicts.length } });
    }

    // 계약기간 초과 체크
    const rootTask = await prisma.wbsTask.findFirst({ where: { projectId, parentTaskId: null }, select: { planEnd: true } });
    if (rootTask?.planEnd && rootTask.planEnd > projectEnd) {
      warnings.push(`스케줄 종료일(${rootTask.planEnd.toISOString().substring(0,10)})이 계약 종료일(${projectEnd.toISOString().substring(0,10)})을 초과합니다.`);
    }

    res.json({
      success: true,
      data: {
        mode: mode || 'check',
        updated,
        conflicts,
        warnings,
        projectStart: projectStart.toISOString().substring(0, 10),
        projectEnd: projectEnd.toISOString().substring(0, 10),
      },
      message: isApply
        ? `${updated}개 태스크의 일정이 재산정되었습니다. (선후행 불일치: ${conflicts.length}건)`
        : `검증 완료. 선후행 불일치: ${conflicts.length}건`,
    });
  } catch (err) {
    console.error('Schedule error:', err);
    res.status(500).json({ success: false, message: '스케줄 처리 중 오류가 발생했습니다.' });
  }
});

// ─── 작업 의존관계 (선후행) ──────────────────────────

// GET /api/v1/projects/:projectId/wbs/:taskId/dependencies
router.get('/:taskId/dependencies', async (req: Request, res: Response) => {
  try {
    const taskId = BigInt(req.params.taskId);
    const deps = await prisma.taskDependency.findMany({
      where: { successorId: taskId },
      include: { predecessor: { select: { taskId: true, taskName: true } } },
    });
    res.json({
      success: true,
      data: deps.map(d => ({
        depId: Number(d.depId),
        predecessorId: Number(d.predecessorId),
        successorId: Number(d.successorId),
        depType: d.depType,
        lagDays: d.lagDays,
        predecessorName: d.predecessor.taskName,
      })),
    });
  } catch (err) {
    console.error('Dependency list error:', err);
    res.status(500).json({ success: false, message: '의존관계 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/projects/:projectId/wbs/:taskId/dependencies
router.post('/:taskId/dependencies', async (req: Request, res: Response) => {
  try {
    if (!(await requirePmsAdmin(req, res))) return;
    const currentUser = (req as any).user as JwtPayload;
    const successorId = BigInt(req.params.taskId);
    const { predecessorId, depType, lagDays } = req.body;

    if (!predecessorId) {
      res.status(400).json({ success: false, message: '선행작업은 필수입니다.' });
      return;
    }
    if (BigInt(predecessorId) === successorId) {
      res.status(400).json({ success: false, message: '자기 자신을 선행작업으로 지정할 수 없습니다.' });
      return;
    }

    const dep = await prisma.taskDependency.create({
      data: {
        predecessorId: BigInt(predecessorId),
        successorId,
        depType: depType || 'FS',
        lagDays: lagDays || 0,
      },
      include: { predecessor: { select: { taskId: true, taskName: true } } },
    });

    await writeAuditLog({
      userId: currentUser.userId, ipAddress: req.ip,
      action: 'CREATE', targetType: 'task_dependency', targetId: dep.depId,
      changeDetail: { predecessorId: Number(predecessorId), successorId: Number(successorId), depType: dep.depType },
    });

    res.status(201).json({
      success: true,
      data: {
        depId: Number(dep.depId),
        predecessorId: Number(dep.predecessorId),
        successorId: Number(dep.successorId),
        depType: dep.depType,
        lagDays: dep.lagDays,
        predecessorName: dep.predecessor.taskName,
      },
      message: '선후행 관계가 등록되었습니다.',
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ success: false, message: '이미 등록된 선후행 관계입니다.' });
      return;
    }
    console.error('Dependency create error:', err);
    res.status(500).json({ success: false, message: '의존관계 등록 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/projects/:projectId/wbs/:taskId/dependencies/:depId
router.put('/:taskId/dependencies/:depId', async (req: Request, res: Response) => {
  try {
    if (!(await requirePmsAdmin(req, res))) return;
    const depId = BigInt(req.params.depId);
    const { depType, lagDays } = req.body;

    const data: any = {};
    if (depType !== undefined) data.depType = depType;
    if (lagDays !== undefined) data.lagDays = lagDays;

    const updated = await prisma.taskDependency.update({
      where: { depId },
      data,
      include: { predecessor: { select: { taskId: true, taskName: true } } },
    });

    res.json({
      success: true,
      data: {
        depId: Number(updated.depId),
        predecessorId: Number(updated.predecessorId),
        depType: updated.depType,
        lagDays: updated.lagDays,
        predecessorName: updated.predecessor.taskName,
      },
    });
  } catch (err) {
    console.error('Dependency update error:', err);
    res.status(500).json({ success: false, message: '의존관계 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/v1/projects/:projectId/wbs/:taskId/dependencies/:depId
router.delete('/:taskId/dependencies/:depId', async (req: Request, res: Response) => {
  try {
    if (!(await requirePmsAdmin(req, res))) return;
    const depId = BigInt(req.params.depId);
    await prisma.taskDependency.delete({ where: { depId } });
    res.json({ success: true, message: '선후행 관계가 삭제되었습니다.' });
  } catch (err) {
    console.error('Dependency delete error:', err);
    res.status(500).json({ success: false, message: '의존관계 삭제 중 오류가 발생했습니다.' });
  }
});

// ─── 엑셀 임포트 ────────────────────────────────────
const uploadDir = path.join(process.cwd(), 'uploads', 'temp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

// 날짜 파싱: "YYYY.MM.DD" 또는 Excel serial number
function parseDate(val: any): Date | null {
  if (!val) return null;
  if (typeof val === 'string') {
    const m = val.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
    if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'number') {
    // Excel serial date → JS Date
    const epoch = new Date(1899, 11, 30);
    return new Date(epoch.getTime() + Math.floor(val) * 86400000);
  }
  return null;
}

// Working Day 보정: 시작일→다음월요일, 종료일→직전금요일
function toWorkingDayStart(d: Date | null): Date | null {
  if (!d) return null;
  const dow = d.getDay();
  if (dow === 6) { d.setDate(d.getDate() + 2); return d; } // 토→월
  if (dow === 0) { d.setDate(d.getDate() + 1); return d; } // 일→월
  return d;
}
function toWorkingDayEnd(d: Date | null): Date | null {
  if (!d) return null;
  const dow = d.getDay();
  if (dow === 6) { d.setDate(d.getDate() - 1); return d; } // 토→금
  if (dow === 0) { d.setDate(d.getDate() - 2); return d; } // 일→금
  return d;
}
function formatYmd(d: Date): string {
  return d.toISOString().substring(0, 10);
}

// WBS 코드 정규화 (float 1.0 → "1", 1.2 → "1.2")
function normalizeWbs(val: any): string {
  if (val === null || val === undefined || val === '') return '';
  const s = String(val).trim();
  // "1.0" → "1"
  return s.replace(/\.0$/, '');
}

// POST /api/v1/projects/:projectId/wbs/import — 엑셀 임포트
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!(await requirePmsAdmin(req, res))) return;
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const lockMsg = await checkWbsStructureLock(projectId, req.body?.forceUnlock);
    if (lockMsg) { res.status(409).json({ success: false, message: lockMsg }); return; }
    const file = req.file;
    const { clearExisting } = req.body;

    if (!file) {
      res.status(400).json({ success: false, message: '엑셀 파일을 업로드해주세요.' });
      return;
    }

    const workbook = XLSX.readFile(file.path);

    // pmsfGrid 시트 우선, 없으면 첫번째 시트
    let sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('pmsfgrid')) || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // 헤더 감지 (WBS/작업이름 패턴)
    let headerRow = 0;
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const row = rows[i].map((c: any) => String(c).trim().toLowerCase());
      if (row.includes('wbs') || row.includes('작업이름') || row.includes('이름')) {
        headerRow = i;
        break;
      }
    }

    // 컬럼 인덱스 매핑
    const headerCells = rows[headerRow].map((c: any) => String(c).trim());
    // 2-row header 처리: row 0와 row 1 병합
    let mergedHeader = headerCells;
    if (headerRow === 0 && rows.length > 1) {
      const row1 = rows[1].map((c: any) => String(c).trim());
      // 실제 데이터 시작이 row 2인지 확인
      const hasSubHeader = row1.some(c => ['계획', '실적'].includes(c));
      if (hasSubHeader) headerRow = 1;
    }

    const colMap: Record<string, number> = {};
    for (let c = 0; c < mergedHeader.length; c++) {
      const h = mergedHeader[c].toLowerCase();
      if (h === 'wbs') colMap.wbs = c;
      if (h.includes('작업이름') || h === '이름') colMap.taskName = c;
      if (h === '구분') colMap.type = c;
      if (h.includes('activity type') || h.includes('activity')) colMap.phase = c;
      if (h.includes('계획시작') || h === '시작_날짜') colMap.planStart = c;
      if (h.includes('계획종료') || h === '완료_날짜') colMap.planEnd = c;
      if (h.includes('실제시작')) colMap.actualStart = c;
      if (h.includes('실제종료')) colMap.actualEnd = c;
      if (h.includes('진척률') || h.includes('실적')) colMap.progress = c;
      if (h.includes('담당자')) colMap.assignee = c;
      if (h.includes('산출물')) colMap.deliverable = c;
      if (h.includes('초기계획시작')) colMap.baselineStart = c;
      if (h.includes('초기계획종료')) colMap.baselineEnd = c;
      if (h.includes('선행작업') || h.includes('선행')) colMap.predecessor = c;
    }

    // 진척률 컬럼 재검출 (2-row header의 경우 col4가 실적)
    if (colMap.progress === undefined && rows.length > 1) {
      const row1 = rows[1].map((c: any) => String(c).trim());
      const idx = row1.indexOf('실적');
      if (idx >= 0) colMap.progress = idx;
    }

    if (colMap.wbs === undefined || colMap.taskName === undefined) {
      res.status(400).json({ success: false, message: 'WBS 또는 작업이름 컬럼을 찾을 수 없습니다. 엑셀 형식을 확인해주세요.' });
      return;
    }

    // 기존 데이터 삭제 옵션
    if (clearExisting === 'true' || clearExisting === true) {
      // 산출물/테스트케이스 등 관련 데이터가 있을 수 있어 cascade 필요
      const existingTasks = await prisma.wbsTask.findMany({ where: { projectId }, select: { taskId: true } });
      const taskIds = existingTasks.map(t => t.taskId);
      if (taskIds.length > 0) {
        await prisma.taskDependency.deleteMany({ where: { OR: [{ predecessorId: { in: taskIds } }, { successorId: { in: taskIds } }] } });
        await prisma.review.deleteMany({ where: { doc: { taskId: { in: taskIds } } } });
        await prisma.docVersion.deleteMany({ where: { doc: { taskId: { in: taskIds } } } });
        await prisma.deliverable.deleteMany({ where: { taskId: { in: taskIds } } });
        await prisma.testCase.deleteMany({ where: { taskId: { in: taskIds } } });
        await prisma.wbsTask.deleteMany({ where: { projectId } });
      }
    }

    // 데이터 파싱
    const dataStartRow = headerRow + 1;
    interface ParsedTask {
      wbsCode: string;
      taskName: string;
      type: string;
      phase: string;
      planStart: Date | null;
      planEnd: Date | null;
      actualStart: Date | null;
      actualEnd: Date | null;
      progressRate: number;
      baselineStart: Date | null;
      baselineEnd: Date | null;
      assignee: string;
      predecessorStr: string;
      deliverableStr: string;
      _rawPlanStart: Date | null;
      _rawPlanEnd: Date | null;
      depth: number;
      sortOrder: number;
      parentWbs: string;
    }

    const tasks: ParsedTask[] = [];
    let order = 0;

    for (let r = dataStartRow; r < rows.length; r++) {
      const row = rows[r];
      const wbsCode = normalizeWbs(row[colMap.wbs]);
      const taskName = String(row[colMap.taskName] || '').trim();

      if (!wbsCode || !taskName) continue;

      const parts = wbsCode.split('.');
      const depth = parts.length;
      const parentWbs = parts.length > 1 ? parts.slice(0, -1).join('.') : '';

      let progressVal = 0;
      if (colMap.progress !== undefined) {
        const pv = row[colMap.progress];
        if (typeof pv === 'number') progressVal = pv > 1 ? pv : pv * 100; // 0.5 → 50%
      }

      tasks.push({
        wbsCode,
        taskName,
        type: colMap.type !== undefined ? String(row[colMap.type] || '').trim() : '',
        phase: colMap.phase !== undefined ? String(row[colMap.phase] || '').trim() : '',
        planStart: toWorkingDayStart(parseDate(row[colMap.planStart])),
        planEnd: toWorkingDayEnd(parseDate(row[colMap.planEnd])),
        actualStart: colMap.actualStart !== undefined ? toWorkingDayStart(parseDate(row[colMap.actualStart])) : null,
        actualEnd: colMap.actualEnd !== undefined ? toWorkingDayEnd(parseDate(row[colMap.actualEnd])) : null,
        _rawPlanStart: parseDate(row[colMap.planStart]),
        _rawPlanEnd: parseDate(row[colMap.planEnd]),
        progressRate: Math.round(progressVal * 100) / 100,
        baselineStart: colMap.baselineStart !== undefined ? toWorkingDayStart(parseDate(row[colMap.baselineStart])) : null,
        baselineEnd: colMap.baselineEnd !== undefined ? toWorkingDayEnd(parseDate(row[colMap.baselineEnd])) : null,
        assignee: colMap.assignee !== undefined ? String(row[colMap.assignee] || '').trim() : '',
        predecessorStr: colMap.predecessor !== undefined ? String(row[colMap.predecessor] || '').trim() : '',
        deliverableStr: colMap.deliverable !== undefined ? String(row[colMap.deliverable] || '').trim() : '',
        depth,
        sortOrder: ++order,
        parentWbs,
      });
    }

    // WBS 코드 → DB taskId 매핑하며 순서대로 삽입
    const wbsToId = new Map<string, bigint>();

    // Phase 매핑 (Activity Type → 공정)
    const phaseMap: Record<string, string> = {
      '착수 및 계획 수립': '분석', '소프트웨어 요구사항 분석': '분석',
      '소프트웨어 설계': '설계', '소프트웨어 개발': '구현',
      '실행 및 통제': '시험', '소프트웨어 전개': '이행',
    };

    // 담당자 이름 → userId 매핑 (프로젝트 투입인력 + 전체 사용자)
    const memberUsers = await prisma.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { userId: true, userName: true } } },
    });
    const allUsers = await prisma.user.findMany({ select: { userId: true, userName: true } });
    function resolveAssignee(name: string): string | null {
      if (!name) return null;
      const member = memberUsers.find((m: any) => m.user.userName === name);
      if (member) return member.user.userId;
      const user = allUsers.find((u: any) => u.userName === name);
      if (user) return user.userId;
      const byId = allUsers.find((u: any) => u.userId === name);
      if (byId) return byId.userId;
      return null;
    }

    let imported = 0;
    for (const t of tasks) {
      const parentTaskId = t.parentWbs ? (wbsToId.get(t.parentWbs) || null) : null;
      const phase = phaseMap[t.phase] || t.phase || null;
      const assigneeId = resolveAssignee(t.assignee);

      const created = await prisma.wbsTask.create({
        data: {
          projectId,
          parentTaskId,
          wbsCode: t.wbsCode,
          taskName: t.taskName,
          phase,
          depth: t.depth,
          sortOrder: t.sortOrder,
          planStart: t.planStart,
          planEnd: t.planEnd,
          actualStart: t.actualStart,
          actualEnd: t.actualEnd,
          duration: (t.planStart && t.planEnd) ? bizDaysBetween(t.planStart, t.planEnd) : null,
          baselineStart: t.baselineStart || t.planStart,
          baselineEnd: t.baselineEnd || t.planEnd,
          progressRate: t.progressRate,
          assigneeId,
        },
      });

      wbsToId.set(t.wbsCode, created.taskId);
      imported++;
    }

    // Working Day 보정 리포트
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const corrections: { wbsCode: string; taskName: string; field: string; before: string; after: string }[] = [];
    for (const t of tasks) {
      if (t._rawPlanStart && t.planStart && t._rawPlanStart.getTime() !== t.planStart.getTime()) {
        corrections.push({
          wbsCode: t.wbsCode, taskName: t.taskName, field: '계획시작일',
          before: `${formatYmd(t._rawPlanStart)}(${dayNames[t._rawPlanStart.getDay()]})`,
          after: `${formatYmd(t.planStart)}(${dayNames[t.planStart.getDay()]})`,
        });
      }
      if (t._rawPlanEnd && t.planEnd && t._rawPlanEnd.getTime() !== t.planEnd.getTime()) {
        corrections.push({
          wbsCode: t.wbsCode, taskName: t.taskName, field: '계획종료일',
          before: `${formatYmd(t._rawPlanEnd)}(${dayNames[t._rawPlanEnd.getDay()]})`,
          after: `${formatYmd(t.planEnd)}(${dayNames[t.planEnd.getDay()]})`,
        });
      }
    }

    // 선행작업 등록 (예: "1.1.1 FS, 1.1 SS")
    for (const t of tasks) {
      if (!t.predecessorStr) continue;
      const successorId = wbsToId.get(t.wbsCode);
      if (!successorId) continue;
      const parts = t.predecessorStr.split(',').map((s: string) => s.trim()).filter(Boolean);
      for (const part of parts) {
        const match = part.match(/^([\d.]+)\s*(FS|FF|SS|SF)?$/i);
        if (!match) continue;
        const predWbs = match[1];
        const depType = (match[2] || 'FS').toUpperCase();
        const predId = wbsToId.get(predWbs);
        if (!predId || predId === successorId) continue;
        try {
          await prisma.taskDependency.create({ data: { predecessorId: predId, successorId, depType } });
        } catch {} // 중복 무시
      }
    }

    // 산출물 등록 (콤마 구분)
    for (const t of tasks) {
      if (!t.deliverableStr) continue;
      const taskId = wbsToId.get(t.wbsCode);
      if (!taskId) continue;
      const docs = t.deliverableStr.split(',').map((s: string) => s.trim()).filter(Boolean);
      for (const docName of docs) {
        await prisma.deliverable.create({
          data: { taskId, docType: docName, docName, uploaderId: currentUser.userId },
        });
      }
    }

    // 부모 태스크 일정 집계 (자식 min/max)
    let parentFixed = 0;
    const allImported = await prisma.wbsTask.findMany({
      where: { projectId },
      select: { taskId: true, parentTaskId: true, depth: true, planStart: true, planEnd: true, baselineStart: true, baselineEnd: true },
      orderBy: { sortOrder: 'asc' },
    });
    const parentIds = new Set(allImported.filter(t => t.parentTaskId).map(t => Number(t.parentTaskId)));
    // 깊은 depth부터 역순
    const parents = allImported.filter(t => parentIds.has(Number(t.taskId))).sort((a, b) => b.depth - a.depth);
    for (const p of parents) {
      const children = allImported.filter(c => Number(c.parentTaskId) === Number(p.taskId));
      const planStarts = children.filter(c => c.planStart).map(c => c.planStart!.getTime());
      const planEnds = children.filter(c => c.planEnd).map(c => c.planEnd!.getTime());
      const blStarts = children.filter(c => c.baselineStart).map(c => c.baselineStart!.getTime());
      const blEnds = children.filter(c => c.baselineEnd).map(c => c.baselineEnd!.getTime());

      const data: any = {};
      if (planStarts.length) data.planStart = new Date(Math.min(...planStarts));
      if (planEnds.length) data.planEnd = new Date(Math.max(...planEnds));
      if (blStarts.length) data.baselineStart = new Date(Math.min(...blStarts));
      if (blEnds.length) data.baselineEnd = new Date(Math.max(...blEnds));

      if (Object.keys(data).length) {
        await prisma.wbsTask.update({ where: { taskId: p.taskId }, data });
        parentFixed++;
      }
    }

    // 임시 파일 삭제
    try { fs.unlinkSync(file.path); } catch {}

    await writeAuditLog({
      userId: currentUser.userId, ipAddress: req.ip,
      action: 'CREATE', targetType: 'wbs_import',
      changeDetail: { imported, sheet: sheetName },
    });

    const corrMsg = corrections.length ? ` | 주말보정 ${corrections.length}건` : '';
    const parentMsg = parentFixed ? ` | 부모일정 집계 ${parentFixed}건` : '';
    res.json({
      success: true,
      data: { imported, sheet: sheetName, corrections, parentFixed },
      message: `${imported}개 태스크 임포트 완료${corrMsg}${parentMsg}`,
    });
  } catch (err) {
    console.error('WBS import error:', err);
    res.status(500).json({ success: false, message: '엑셀 임포트 중 오류가 발생했습니다.' });
  }
});

export default router;
