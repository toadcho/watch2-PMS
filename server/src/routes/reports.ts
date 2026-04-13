import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';
import { createNotification } from './notifications';
import * as docx from 'docx';

const router = Router({ mergeParams: true });
router.use(authenticate);

function serialize(r: any) {
  return JSON.parse(JSON.stringify(r, (_k, v) => typeof v === 'bigint' ? Number(v) : v));
}

function pid(req: Request): bigint { return BigInt(req.params.projectId as string); }
function rid(req: Request): bigint { return BigInt(req.params.reportId as string); }
function sid(req: Request): bigint { return BigInt(req.params.sectionId as string); }

// ── 날짜 유틸 ──────────────────────────────────────
function toDateStr(d: Date | string | null): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

function toISODate(d: Date | string | null): string {
  if (!d) return '';
  return (typeof d === 'string' ? d : d.toISOString()).substring(0, 10);
}

// 날짜 범위 겹침 여부
function rangeOverlaps(taskStart: Date | null, taskEnd: Date | null, periodStart: Date, periodEnd: Date): boolean {
  if (!taskStart && !taskEnd) return false;
  const ts = taskStart || taskEnd!;
  const te = taskEnd || taskStart!;
  return ts <= periodEnd && te >= periodStart;
}

// ── 영업일 유틸 ──
function bizDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const cur = new Date(start); cur.setHours(0, 0, 0, 0);
  const e = new Date(end); e.setHours(0, 0, 0, 0);
  while (cur <= e) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ── 자동 수집 데이터 생성 헬퍼 ───────────────────────
async function buildAutoContent(projectId: bigint) {
  const project = await prisma.project.findUnique({
    where: { projectId },
    include: { pm: { select: { userName: true } } },
  });

  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { userName: true, department: true } } },
  });

  // ── 공정진척현황과 동일한 가중 평균 계산 ──
  const allTasks = await prisma.wbsTask.findMany({
    where: { projectId },
    select: {
      taskId: true, wbsCode: true, taskName: true, parentTaskId: true, depth: true,
      phase: true, planStart: true, planEnd: true, progressRate: true, actualRate: true,
      weight: true, bizWeight: true, phaseWeights: true,
      childTasks: { select: { taskId: true } },
    },
    orderBy: { sortOrder: 'asc' },
  });

  const leaves = allTasks.filter(t => t.childTasks.length === 0);
  const depth2Tasks = allTasks.filter(t => t.depth === 2);
  const rootTasks = allTasks.filter(t => !t.parentTaskId);

  const refDate = new Date(); refDate.setHours(0, 0, 0, 0);

  // 전체 경과 MD 기반 계획 진척률 (공정진척현황과 동일)
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

  // depth 2 업무별 진척률
  const bizProgress: { taskName: string; wbsCode: string; progressRate: number; actualRate: number; bizWeight: number; taskCount: number }[] = [];
  for (const stage of depth2Tasks) {
    const stageLeaves = leaves.filter(l => {
      let cur: any = l;
      while (cur) {
        if (Number(cur.parentTaskId) === Number(stage.taskId)) return true;
        cur = allTasks.find(a => Number(a.taskId) === Number(cur.parentTaskId));
      }
      return false;
    });

    // 계획: 경과 MD 비율 (공정진척현황과 동일)
    const stagePlanMd = stageLeaves.reduce((s, t) => t.planStart && t.planEnd ? s + bizDaysBetween(t.planStart, t.planEnd) : s, 0);
    let stagePlanByRef = 0;
    for (const t of stageLeaves) {
      if (!t.planStart || !t.planEnd) continue;
      const md = bizDaysBetween(t.planStart, t.planEnd);
      if (refDate >= t.planEnd) stagePlanByRef += md;
      else if (refDate >= t.planStart) stagePlanByRef += bizDaysBetween(t.planStart, refDate);
    }
    const planProg = stagePlanMd > 0 ? stagePlanByRef / stagePlanMd * 100 : 0;

    // 실적: weight 가중 평균
    const totalW = stageLeaves.reduce((s, t) => s + Number(t.weight || 1), 0);
    const actProg = totalW > 0 ? stageLeaves.reduce((s, t) => s + Number(t.actualRate || 0) * Number(t.weight || 1), 0) / totalW : 0;

    bizProgress.push({
      taskName: stage.taskName,
      wbsCode: stage.wbsCode || '',
      progressRate: Math.round(planProg * 100) / 100,
      actualRate: Math.round(actProg * 100) / 100,
      bizWeight: Number(stage.bizWeight || 0),
      taskCount: stageLeaves.length,
    });
  }

  // 전체 진척률
  const totalProgress = totalPlanMd > 0 ? Math.round(planMdByRef / totalPlanMd * 10000) / 100 : 0;

  // 전체 실적: depth2 weight 가중 평균
  let totalActual = 0, totalWeightSum = 0;
  for (const stage of depth2Tasks) {
    const bp = bizProgress.find(b => b.wbsCode === (stage.wbsCode || ''));
    if (!bp) continue;
    const w = Number(stage.weight || 1);
    totalActual += bp.actualRate * w;
    totalWeightSum += w;
  }
  if (totalWeightSum > 0) {
    totalActual = Math.round(totalActual / totalWeightSum * 100) / 100;
  }

  // 미해결 이슈 + 최신 상태변경 이력
  const openIssues = await prisma.issue.findMany({
    where: { projectId, status: { notIn: ['Solved', 'Closed', 'Cancelled'] } },
    include: { statusHistory: { orderBy: { changeDate: 'desc' }, take: 1 } },
    orderBy: { createdAt: 'desc' },
  });
  // 미해결 리스크 + 최신 상태변경 이력
  const openRisks = await prisma.risk.findMany({
    where: { projectId, status: { notIn: ['Resolved', 'Closed', 'Cancelled'] } },
    include: { owner: { select: { userName: true } }, statusHistory: { orderBy: { changeDate: 'desc' }, take: 1 } },
    orderBy: { createdAt: 'desc' },
  });

  const risks = openRisks;

  const deliverables = await prisma.deliverable.findMany({
    where: { task: { projectId } },
    select: { docType: true, status: true, auditorCheck: true },
  });

  // ── S-Curve 주차별 데이터 생성 ──
  const scurveWeeks: { weekNo: number; date: string; plan: number; actual: number }[] = [];
  if (project?.startDate && project?.endDate) {
    const pStart = new Date(project.startDate); pStart.setHours(0, 0, 0, 0);
    const pEnd = new Date(project.endDate); pEnd.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // 첫 번째 월요일
    const firstMonday = new Date(pStart);
    const dow = firstMonday.getDay();
    if (dow !== 1) firstMonday.setDate(firstMonday.getDate() + ((8 - dow) % 7));
    const cur = new Date(firstMonday);
    let weekNo = 0;
    while (cur <= pEnd) {
      weekNo++;
      const rd = new Date(cur); rd.setHours(0, 0, 0, 0);
      // 계획: 경과 MD 비율
      let planMd = 0;
      for (const t of leaves) {
        if (!t.planStart || !t.planEnd) continue;
        const ts = new Date(t.planStart); ts.setHours(0, 0, 0, 0);
        const te = new Date(t.planEnd); te.setHours(0, 0, 0, 0);
        const md = bizDaysBetween(ts, te);
        if (rd >= te) planMd += md;
        else if (rd >= ts) planMd += bizDaysBetween(ts, rd);
      }
      const plan = totalPlanMd > 0 ? Math.round(planMd / totalPlanMd * 1000) / 10 : 0;
      const actual = rd <= today ? totalActual : 0;
      scurveWeeks.push({ weekNo, date: rd.toISOString().substring(0, 10), plan, actual: Math.round(actual * 10) / 10 });
      cur.setDate(cur.getDate() + 7);
    }
  }

  return {
    project: {
      projectName: project?.projectName,
      businessNo: project?.businessNo,
      status: project?.status,
      pmName: project?.pm?.userName || '-',
      startDate: project?.startDate,
      endDate: project?.endDate,
    },
    scurveWeeks,
    totalProgress: Math.round(totalProgress * 10) / 10,
    totalActual: Math.round(totalActual * 10) / 10,
    memberCount: members.length,
    totalManMonth: members.reduce((s, m) => s + Number(m.manMonth), 0),
    phaseProgress: rootTasks.map(t => ({
      taskName: t.taskName,
      phase: t.phase,
      progressRate: Number(t.progressRate),
      actualRate: Number(t.actualRate || 0),
    })),
    bizProgress,
    openIssues: openIssues.map(i => {
      const lastHistory = (i as any).statusHistory?.[0];
      return {
        issueTitle: i.issueTitle, content: i.content,
        lastChangeContent: lastHistory?.changeContent || '',
        lastChangeDate: lastHistory?.changeDate || null,
        category: i.category, status: i.status,
        importance: i.importance, urgency: i.urgency, assigneeName: i.assigneeName,
      };
    }),
    openIssueCount: openIssues.length,
    openRisks: openRisks.map(r => {
      const lastHistory = (r as any).statusHistory?.[0];
      return {
        riskName: r.riskName, category: r.category, status: r.status,
        impactLevel: r.impactLevel, probability: r.probability,
        ownerName: r.owner?.userName || r.assigneeName || '-',
        lastChangeContent: lastHistory?.changeContent || '',
        lastChangeDate: lastHistory?.changeDate || null,
      };
    }),
    openRiskCount: openRisks.length,
    riskCount: risks.length,
    risks: risks.map(r => ({
      riskName: r.riskName, impactLevel: r.impactLevel, probability: r.probability,
      status: r.status, ownerName: r.owner?.userName || '-',
    })),
    deliverableSummary: {
      total: deliverables.length,
      approved: deliverables.filter(d => d.status === '승인' || d.status === '승인완료').length,
      auditPass: deliverables.filter(d => d.auditorCheck === '적합').length,
      auditFail: deliverables.filter(d => d.auditorCheck === '부적합').length,
    },
    generatedAt: new Date().toISOString(),

    // 팀별 진척률 (department 기준)
    teamProgress: await buildTeamProgress(projectId),

    // 개발진척현황
    devProgress: await buildDevProgress(projectId),
  };
}

async function buildTeamProgress(projectId: bigint) {
  // 모든 leaf 태스크 + 담당자 부서
  const leafTasks = await prisma.wbsTask.findMany({
    where: { projectId, childTasks: { none: {} }, assigneeId: { not: null } },
    select: { taskId: true, progressRate: true, actualRate: true, weight: true, assignee: { select: { department: true } } },
  });

  const teamMap = new Map<string, { planSum: number; actualSum: number; weightSum: number; count: number }>();
  for (const t of leafTasks) {
    const dept = t.assignee?.department || '미지정';
    if (!teamMap.has(dept)) teamMap.set(dept, { planSum: 0, actualSum: 0, weightSum: 0, count: 0 });
    const m = teamMap.get(dept)!;
    const w = Number(t.weight || 1);
    m.planSum += Number(t.progressRate) * w;
    m.actualSum += Number(t.actualRate || 0) * w;
    m.weightSum += w;
    m.count++;
  }

  return Array.from(teamMap.entries()).map(([team, m]) => ({
    teamName: team,
    taskCount: m.count,
    planRate: m.weightSum ? Math.round(m.planSum / m.weightSum * 10) / 10 : 0,
    actualRate: m.weightSum ? Math.round(m.actualSum / m.weightSum * 10) / 10 : 0,
  })).sort((a, b) => a.teamName.localeCompare(b.teamName));
}

async function buildDevProgress(projectId: bigint) {
  const proj = await prisma.project.findUnique({ where: { projectId }, select: { devProgressEnabled: true } });
  if (!proj?.devProgressEnabled) return null;

  const programs = await prisma.devProgram.findMany({ where: { projectId } });
  const total = programs.length;
  if (!total) return null;

  const done = programs.filter(p => p.actualEndDate).length;
  const inProgress = programs.filter(p => p.actualStartDate && !p.actualEndDate).length;
  const delayed = programs.filter(p => !p.actualEndDate && p.planEndDate && new Date(p.planEndDate) < new Date()).length;

  // 업무별
  const taskMap = new Map<string, { total: number; done: number }>();
  for (const p of programs) {
    const t = p.taskCode || '미분류';
    if (!taskMap.has(t)) taskMap.set(t, { total: 0, done: 0 });
    const m = taskMap.get(t)!;
    m.total++;
    if (p.actualEndDate) m.done++;
  }

  return {
    total, done, inProgress, delayed,
    doneRate: Math.round(done / total * 1000) / 10,
    byTask: Array.from(taskMap.entries()).map(([task, v]) => ({
      taskCode: task, total: v.total, done: v.done,
      doneRate: v.total ? Math.round(v.done / v.total * 1000) / 10 : 0,
    })),
  };
}

// ── 팀별 WBS 태스크 조회 (기간 기반) ─────────────────
async function getTeamTasks(
  projectId: bigint,
  department: string,
  periodStart: Date,
  periodEnd: Date,
  useActualRate: boolean, // true: 실적(actualRate), false: 계획(progressRate)
) {
  // 해당 팀(department) 소속 사용자 ID 목록
  const teamMembers = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { userId: true, department: true } } },
  });
  const teamUserIds = teamMembers
    .filter(m => (m.user?.department || '미지정') === department)
    .map(m => m.userId);

  if (!teamUserIds.length) return [];

  // depth 4 태스크 중 하위에 해당 팀원이 할당된 것 + 기간 겹침
  // 1) 해당 팀원이 할당된 leaf 태스크의 부모 depth 4 ID 수집
  const leafTasks = await prisma.wbsTask.findMany({
    where: {
      projectId,
      assigneeId: { in: teamUserIds },
      childTasks: { none: {} },
    },
    select: { taskId: true, parentTaskId: true, depth: true },
  });

  // leaf에서 depth 4 조상 찾기
  const allTasks = await prisma.wbsTask.findMany({
    where: { projectId },
    select: { taskId: true, parentTaskId: true, depth: true },
  });
  const taskMap = new Map(allTasks.map(t => [Number(t.taskId), t]));

  function findAncestorAtDepth(taskId: number, targetDepth: number): number | null {
    let cur = taskMap.get(taskId);
    while (cur) {
      if (cur.depth === targetDepth) return Number(cur.taskId);
      if (!cur.parentTaskId) return null;
      cur = taskMap.get(Number(cur.parentTaskId));
    }
    return null;
  }

  const depth4Ids = new Set<number>();
  for (const leaf of leafTasks) {
    if (leaf.depth === 4) { depth4Ids.add(Number(leaf.taskId)); continue; }
    const ancestorId = findAncestorAtDepth(Number(leaf.taskId), 4);
    if (ancestorId) depth4Ids.add(ancestorId);
  }

  if (!depth4Ids.size) return [];

  const tasks = await prisma.wbsTask.findMany({
    where: {
      projectId,
      taskId: { in: Array.from(depth4Ids).map(BigInt) },
    },
    include: {
      assignee: { select: { userName: true } },
      parentTask: { select: { taskName: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { taskId: 'asc' }],
  });

  // 기간 필터링
  return tasks
    .filter(t => {
      const start = t.actualStart || t.planStart;
      const end = t.actualEnd || t.planEnd;
      return rangeOverlaps(start, end, periodStart, periodEnd);
    })
    .map(t => {
      const pStart = t.actualStart || t.planStart;
      const pEnd = t.actualEnd || t.planEnd;
      return {
        taskId: Number(t.taskId),
        taskName: t.taskName,
        parentName: t.parentTask?.taskName || '',
        assigneeName: t.assignee?.userName || '',
        content: t.taskName,
        schedule: pStart && pEnd ? `${toDateStr(pStart)}~${toDateStr(pEnd)}` : '',
        scheduleStart: toISODate(pStart),
        scheduleEnd: toISODate(pEnd),
        progressRate: useActualRate ? Number(t.actualRate) : Number(t.progressRate),
        status: Number(t.actualRate) >= 100 ? '완료' : '진행중',
      };
    });
}

// ── 팀 목록 추출 (투입인력 department 기반) ─────────────
async function getProjectTeams(projectId: bigint) {
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { userName: true, department: true, userId: true } } },
  });
  const teamMap = new Map<string, { userId: string; userName: string; role: string }>();
  for (const m of members) {
    const dept = m.user?.department || '미지정';
    // 팀장(PL/PM) 우선, 없으면 첫 멤버
    if (!teamMap.has(dept) || m.role === 'PL' || m.role === 'PM') {
      teamMap.set(dept, { userId: m.userId, userName: m.user?.userName || '', role: m.role });
    }
  }
  return Array.from(teamMap.entries()).map(([team, writer]) => ({
    teamName: team,
    userId: writer.userId,
    userName: writer.userName,
  }));
}

// ====================================================================
// GET / — 보고서 목록
// ====================================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const { reportType, status, page, size } = req.query;

    const pn = Math.max(1, parseInt(page as string) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(size as string) || 50));

    const where: any = { projectId };
    if (reportType) where.reportType = reportType;
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.report.findMany({
        where,
        include: { sections: { select: { sectionId: true, teamName: true, status: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (pn - 1) * ps,
        take: ps,
      }),
      prisma.report.count({ where }),
    ]);

    // createdBy → 사용자 이름 매핑
    const userIds = [...new Set(items.map(i => i.createdBy))];
    const users = await prisma.user.findMany({ where: { userId: { in: userIds } }, select: { userId: true, userName: true } });
    const userMap = Object.fromEntries(users.map(u => [u.userId, u.userName]));

    res.json({
      success: true,
      data: items.map(i => ({ ...serialize(i), createdByName: userMap[i.createdBy] || i.createdBy })),
      pagination: { page: pn, size: ps, totalCount: total, totalPages: Math.ceil(total / ps) },
    });
  } catch (err) {
    console.error('Report list error:', err);
    res.status(500).json({ success: false, message: '보고서 목록 조회 중 오류' });
  }
});

// ====================================================================
// GET /:reportId — 보고서 상세
// ====================================================================
router.get('/:reportId', async (req: Request, res: Response) => {
  try {
    // 레거시 type 경로 호환 (weekly/monthly/audit/completion)
    if (isNaN(Number(req.params.reportId))) {
      return await handleLegacyGenerate(req, res);
    }

    const reportId = rid(req);
    const report = await prisma.report.findUnique({
      where: { reportId },
      include: { sections: { orderBy: { sectionId: 'asc' } } },
    });

    if (!report) {
      res.status(404).json({ success: false, message: '보고서를 찾을 수 없습니다.' });
      return;
    }

    const creator = await prisma.user.findUnique({ where: { userId: report.createdBy }, select: { userName: true } });
    res.json({ success: true, data: { ...serialize(report), createdByName: creator?.userName || report.createdBy } });
  } catch (err) {
    console.error('Report detail error:', err);
    res.status(500).json({ success: false, message: '보고서 상세 조회 중 오류' });
  }
});

// ====================================================================
// POST / — 보고서 생성 (자동 데이터 수집 + 팀 섹션 + WBS 태스크)
// ====================================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const cu = (req as any).user as JwtPayload;
    const { reportType, title, periodStart, periodEnd, nextStart, nextEnd, selectedTeams } = req.body;

    if (!reportType || !title) {
      res.status(400).json({ success: false, message: 'reportType, title은 필수입니다.' });
      return;
    }

    // 자동 데이터 수집
    const autoContent = await buildAutoContent(projectId);

    // 팀 목록 추출
    let teams = await getProjectTeams(projectId);

    // 선택된 팀만 필터링
    if (Array.isArray(selectedTeams) && selectedTeams.length > 0) {
      teams = teams.filter(t => selectedTeams.includes(t.teamName));
    }

    // 주간/월간: 팀별 WBS 태스크 자동 수집
    const isWeeklyOrMonthly = reportType === 'weekly' || reportType === 'monthly';
    const pStart = periodStart ? new Date(periodStart) : null;
    const pEnd = periodEnd ? new Date(periodEnd) : null;
    const nStart = nextStart ? new Date(nextStart) : null;
    const nEnd = nextEnd ? new Date(nextEnd) : null;

    const sectionData = [];
    for (const t of teams) {
      let currentTasks: any[] = [];
      let nextTasks: any[] = [];

      if (isWeeklyOrMonthly && pStart && pEnd) {
        currentTasks = await getTeamTasks(projectId, t.teamName, pStart, pEnd, true);
      }
      if (isWeeklyOrMonthly && nStart && nEnd) {
        nextTasks = await getTeamTasks(projectId, t.teamName, nStart, nEnd, false);
      }

      sectionData.push({
        teamName: t.teamName,
        writerId: t.userId,
        writerName: t.userName,
        status: '미작성' as const,
        currentTasks: currentTasks.length ? currentTasks : undefined,
        nextTasks: nextTasks.length ? nextTasks : undefined,
      });
    }

    const report = await prisma.report.create({
      data: {
        projectId,
        reportType,
        title,
        periodStart: pStart,
        periodEnd: pEnd,
        nextStart: nStart,
        nextEnd: nEnd,
        status: '생성',
        autoContent: autoContent as any,
        createdBy: cu.userId,
        sections: { create: sectionData },
      },
      include: { sections: true },
    });

    await writeAuditLog({
      userId: cu.userId, ipAddress: req.ip, action: 'CREATE',
      targetType: 'report', targetId: report.reportId,
    });

    res.status(201).json({ success: true, data: serialize(report) });
  } catch (err) {
    console.error('Report create error:', err);
    res.status(500).json({ success: false, message: '보고서 생성 중 오류' });
  }
});

// ====================================================================
// PUT /:reportId — 보고서 수정
// ====================================================================
router.put('/:reportId', async (req: Request, res: Response) => {
  try {
    const reportId = rid(req);
    const cu = (req as any).user as JwtPayload;
    const { title, periodStart, periodEnd, nextStart, nextEnd, summaryNote } = req.body;

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (periodStart !== undefined) data.periodStart = periodStart ? new Date(periodStart) : null;
    if (periodEnd !== undefined) data.periodEnd = periodEnd ? new Date(periodEnd) : null;
    if (nextStart !== undefined) data.nextStart = nextStart ? new Date(nextStart) : null;
    if (nextEnd !== undefined) data.nextEnd = nextEnd ? new Date(nextEnd) : null;
    if (summaryNote !== undefined) data.summaryNote = summaryNote;

    const report = await prisma.report.update({
      where: { reportId }, data,
      include: { sections: true },
    });

    await writeAuditLog({
      userId: cu.userId, ipAddress: req.ip, action: 'UPDATE',
      targetType: 'report', targetId: reportId,
    });

    res.json({ success: true, data: serialize(report) });
  } catch (err) {
    console.error('Report update error:', err);
    res.status(500).json({ success: false, message: '보고서 수정 중 오류' });
  }
});

// ====================================================================
// DELETE /:reportId — 보고서 삭제
// ====================================================================
router.delete('/:reportId', async (req: Request, res: Response) => {
  try {
    const reportId = rid(req);
    const cu = (req as any).user as JwtPayload;
    await prisma.report.delete({ where: { reportId } });
    await writeAuditLog({
      userId: cu.userId, ipAddress: req.ip, action: 'DELETE',
      targetType: 'report', targetId: reportId,
    });
    res.json({ success: true, message: '보고서가 삭제되었습니다.' });
  } catch (err) {
    console.error('Report delete error:', err);
    res.status(500).json({ success: false, message: '보고서 삭제 중 오류' });
  }
});

// ====================================================================
// POST /:reportId/request-write — 작성 요청
// ====================================================================
router.post('/:reportId/request-write', async (req: Request, res: Response) => {
  try {
    const reportId = rid(req);
    const cu = (req as any).user as JwtPayload;
    const projectId = pid(req);
    const report = await prisma.report.update({
      where: { reportId }, data: { status: '작성요청' },
      include: { sections: true },
    });
    await writeAuditLog({
      userId: cu.userId, ipAddress: req.ip, action: 'UPDATE',
      targetType: 'report', targetId: reportId,
      changeDetail: { action: '작성요청' },
    });

    // 각 팀 섹션 작성자에게 알림 발송
    for (const section of report.sections) {
      if (section.writerId) {
        await createNotification({
          userId: section.writerId,
          projectId,
          type: 'report_request',
          title: `[주간보고] ${report.title} 작성 요청`,
          message: `${section.teamName} 팀의 주간보고 작성이 요청되었습니다.`,
          link: `/projects/${Number(projectId)}/reports`,
        });
      }
    }

    res.json({ success: true, data: serialize(report) });
  } catch (err) {
    console.error('Report request-write error:', err);
    res.status(500).json({ success: false, message: '작성 요청 중 오류' });
  }
});

// ====================================================================
// PUT /:reportId/sections/:sectionId — 팀 섹션 작성/수정
// ====================================================================
router.put('/:reportId/sections/:sectionId', async (req: Request, res: Response) => {
  try {
    const reportId = rid(req);
    const sectionId = sid(req);
    const { achievements, plans, issues, currentRemark, nextRemark, status, currentTasks, nextTasks } = req.body;

    const data: any = {};
    if (achievements !== undefined) data.achievements = achievements;
    if (plans !== undefined) data.plans = plans;
    if (issues !== undefined) data.issues = issues;
    if (currentRemark !== undefined) data.currentRemark = currentRemark;
    if (nextRemark !== undefined) data.nextRemark = nextRemark;
    if (status !== undefined) data.status = status;
    if (currentTasks !== undefined) data.currentTasks = currentTasks;
    if (nextTasks !== undefined) data.nextTasks = nextTasks;

    const section = await prisma.reportTeamSection.update({
      where: { sectionId }, data,
    });

    // 보고서 상태 자동 업데이트
    const allSections = await prisma.reportTeamSection.findMany({ where: { reportId } });
    const anyWriting = allSections.some(s => s.status === '작성중' || s.status === '작성완료');
    const report = await prisma.report.findUnique({ where: { reportId } });
    if (anyWriting && report && (report.status === '작성요청' || report.status === '생성')) {
      await prisma.report.update({ where: { reportId }, data: { status: '작성중' } });
    }

    // 작성완료 시 → PMS관리자에게 알림 + 전원 완료 시 자동 검토 전환
    if (status === '작성완료' && report) {
      // 업데이트 후 최신 상태로 재조회
      const freshSections = await prisma.reportTeamSection.findMany({ where: { reportId } });
      const doneCount = freshSections.filter(s => s.status === '작성완료').length;
      const totalCount = freshSections.length;
      const projectId = report.projectId;

      // 시스템관리자 + 프로젝트 PMSAdmin + PM 에게 알림
      const sysAdmins = await prisma.user.findMany({
        where: { systemRole: 'ADMIN', isActive: true },
        select: { userId: true },
      });
      const pmsAdmins = await prisma.projectMember.findMany({
        where: { projectId, role: 'PMSAdmin' },
        select: { userId: true },
      });
      const proj = await prisma.project.findUnique({ where: { projectId }, select: { pmUserId: true } });
      const adminIds = new Set([
        ...sysAdmins.map(a => a.userId),
        ...pmsAdmins.map(a => a.userId),
      ]);
      if (proj?.pmUserId) adminIds.add(proj.pmUserId);

      for (const adminId of adminIds) {
        await createNotification({
          userId: adminId,
          projectId,
          type: 'report_section_done',
          title: `[주간보고] ${section.teamName} 작성완료 (${doneCount}/${totalCount})`,
          message: doneCount === totalCount
            ? `모든 팀이 작성을 완료했습니다. 검토를 진행하세요.`
            : `${section.teamName} 팀이 주간보고를 작성 완료했습니다.`,
          link: `/projects/${Number(projectId)}/reports`,
        });
      }

      // 모든 팀 작성완료 → 자동 검토 전환 (autoContent 집계)
      if (doneCount === totalCount) {
        const autoContent = await buildAutoContent(projectId);
        await prisma.report.update({
          where: { reportId },
          data: { status: '검토', autoContent: autoContent as any },
        });
      }
    }

    res.json({ success: true, data: serialize(section) });
  } catch (err) {
    console.error('Section update error:', err);
    res.status(500).json({ success: false, message: '섹션 수정 중 오류' });
  }
});

// ====================================================================
// POST /:reportId/consolidate — 취합
// ====================================================================
router.post('/:reportId/consolidate', async (req: Request, res: Response) => {
  try {
    const reportId = rid(req);
    const projectId = pid(req);
    const cu = (req as any).user as JwtPayload;
    const autoContent = await buildAutoContent(projectId);
    const report = await prisma.report.update({
      where: { reportId },
      data: { status: '취합', autoContent: autoContent as any },
      include: { sections: true },
    });
    await writeAuditLog({
      userId: cu.userId, ipAddress: req.ip, action: 'UPDATE',
      targetType: 'report', targetId: reportId,
      changeDetail: { action: '취합' },
    });
    res.json({ success: true, data: serialize(report) });
  } catch (err) {
    console.error('Report consolidate error:', err);
    res.status(500).json({ success: false, message: '취합 중 오류' });
  }
});

// ====================================================================
// POST /:reportId/complete — 최종 완료
// ====================================================================
router.post('/:reportId/complete', async (req: Request, res: Response) => {
  try {
    const reportId = rid(req);
    const cu = (req as any).user as JwtPayload;
    const report = await prisma.report.update({
      where: { reportId },
      data: { status: '완료', completedAt: new Date() },
      include: { sections: true },
    });
    await writeAuditLog({
      userId: cu.userId, ipAddress: req.ip, action: 'UPDATE',
      targetType: 'report', targetId: reportId,
      changeDetail: { action: '최종완료' },
    });
    res.json({ success: true, data: serialize(report) });
  } catch (err) {
    console.error('Report complete error:', err);
    res.status(500).json({ success: false, message: '완료 처리 중 오류' });
  }
});

// ====================================================================
// POST /:reportId/refresh — 자동 데이터 갱신 (WBS 태스크 포함)
// ====================================================================
router.post('/:reportId/refresh', async (req: Request, res: Response) => {
  try {
    const reportId = rid(req);
    const projectId = pid(req);

    const autoContent = await buildAutoContent(projectId);

    const report = await prisma.report.findUnique({
      where: { reportId },
      include: { sections: true },
    });
    if (!report) {
      res.status(404).json({ success: false, message: '보고서를 찾을 수 없습니다.' });
      return;
    }

    // 주간/월간이면 팀별 WBS 태스크도 갱신
    const isWeeklyOrMonthly = report.reportType === 'weekly' || report.reportType === 'monthly';
    if (isWeeklyOrMonthly && report.periodStart && report.periodEnd) {
      for (const section of report.sections) {
        const currentTasks = await getTeamTasks(
          projectId, section.teamName,
          report.periodStart, report.periodEnd, true,
        );
        const nextTasks = report.nextStart && report.nextEnd
          ? await getTeamTasks(projectId, section.teamName, report.nextStart, report.nextEnd, false)
          : [];

        await prisma.reportTeamSection.update({
          where: { sectionId: section.sectionId },
          data: {
            currentTasks: currentTasks.length ? currentTasks : undefined,
            nextTasks: nextTasks.length ? nextTasks : undefined,
          },
        });
      }
    }

    const updated = await prisma.report.update({
      where: { reportId },
      data: { autoContent: autoContent as any },
      include: { sections: true },
    });

    res.json({ success: true, data: serialize(updated) });
  } catch (err) {
    console.error('Report refresh error:', err);
    res.status(500).json({ success: false, message: '데이터 갱신 중 오류' });
  }
});

// ====================================================================
// POST /:reportId/sections — 팀 섹션 추가
// ====================================================================
router.post('/:reportId/sections', async (req: Request, res: Response) => {
  try {
    const reportId = rid(req);
    const { teamName, writerId, writerName } = req.body;
    if (!teamName) {
      res.status(400).json({ success: false, message: 'teamName은 필수입니다.' });
      return;
    }
    const section = await prisma.reportTeamSection.create({
      data: { reportId, teamName, writerId, writerName, status: '미작성' },
    });
    res.status(201).json({ success: true, data: serialize(section) });
  } catch (err) {
    console.error('Section create error:', err);
    res.status(500).json({ success: false, message: '섹션 추가 중 오류' });
  }
});

// ====================================================================
// DELETE /:reportId/sections/:sectionId — 팀 섹션 삭제
// ====================================================================
router.delete('/:reportId/sections/:sectionId', async (req: Request, res: Response) => {
  try {
    const sectionId = sid(req);
    await prisma.reportTeamSection.delete({ where: { sectionId } });
    res.json({ success: true, message: '섹션이 삭제되었습니다.' });
  } catch (err) {
    console.error('Section delete error:', err);
    res.status(500).json({ success: false, message: '섹션 삭제 중 오류' });
  }
});

// ====================================================================
// 레거시 호환: GET /reports/:type (기존 단순 생성)
// ====================================================================
async function handleLegacyGenerate(req: Request, res: Response) {
  try {
    const projectId = pid(req);
    const typeParam = req.params.reportId as string;
    const autoContent = await buildAutoContent(projectId);
    let reportTitle = '';
    switch (typeParam) {
      case 'weekly': reportTitle = '주간보고'; break;
      case 'monthly': reportTitle = '월간보고'; break;
      case 'audit': reportTitle = '감리보고'; break;
      case 'completion': reportTitle = '사업완료보고'; break;
      default: reportTitle = '프로젝트 현황보고';
    }
    res.json({ success: true, data: { reportTitle, reportType: typeParam, ...autoContent } });
  } catch (err) {
    console.error('Legacy report error:', err);
    res.status(500).json({ success: false, message: '보고서 생성 중 오류가 발생했습니다.' });
  }
}

// ====================================================================
// POST /:reportId/export/docx — DOCX 다운로드 (GET도 호환)
// ====================================================================
router.post('/:reportId/export/docx', async (req: Request, res: Response) => {
  try {
    if (isNaN(Number(req.params.reportId))) { res.status(400).json({ success: false, message: '유효하지 않은 reportId' }); return; }
    const reportId = rid(req);
    const projectId = pid(req);
    // const chartImage: string | undefined = req.body?.chartImage; // 향후 차트 이미지 지원 시 사용

    const report = await prisma.report.findUnique({
      where: { reportId },
      include: { sections: { orderBy: { sectionId: 'asc' } } },
    });
    if (!report) { res.status(404).json({ success: false, message: '보고서를 찾을 수 없습니다.' }); return; }

    const auto = (report.autoContent || {}) as any;
    const proj = auto.project || {};

    // 스타일 정의
    const TITLE_SIZE = 28; // 14pt
    const HEADING_SIZE = 24; // 12pt
    const BODY_SIZE = 20; // 10pt
    const SMALL_SIZE = 18; // 9pt

    const fmtD = (d: any) => {
      if (!d) return '-';
      const dt = d instanceof Date ? d : new Date(d);
      const y = dt.getFullYear(); const m = String(dt.getMonth() + 1).padStart(2, '0'); const dd = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    const fmtShort = (d: any) => {
      if (!d) return '';
      const dt = d instanceof Date ? d : new Date(d);
      return `${dt.getMonth() + 1}/${dt.getDate()}`;
    };

    const children: (docx.Paragraph | docx.Table)[] = [];

    // 제목
    children.push(new docx.Paragraph({
      alignment: docx.AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new docx.TextRun({ text: report.title, bold: true, size: 32, font: '맑은 고딕' })],
    }));
    children.push(new docx.Paragraph({
      alignment: docx.AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new docx.TextRun({
        text: `${report.periodStart ? fmtD(report.periodStart) + ' ~ ' + fmtD(report.periodEnd) : ''}`,
        size: BODY_SIZE, color: '888888', font: '맑은 고딕',
      })],
    }));

    // 1. 프로젝트 개요
    children.push(createHeading('1. 프로젝트 개요'));
    children.push(createInfoTable([
      ['프로젝트명', proj.projectName || ''],
      ['사업관리번호', proj.businessNo || ''],
      ['PM', proj.pmName || ''],
      ['사업기간', `${fmtD(proj.startDate)} ~ ${fmtD(proj.endDate)}`],
      ['투입인력', `${auto.memberCount || 0}명 (${auto.totalManMonth || 0}M/M)`],
    ]));

    // 2. 진척 현황
    children.push(createHeading('2. 진척 현황'));

    // 전체 진척률 강조 표시 (그레이톤, 12pt)
    const diff = Math.round(((auto.totalActual || 0) - (auto.totalProgress || 0)) * 10) / 10;
    const diffSign = diff > 0 ? '+' : '';
    children.push(new docx.Paragraph({
      spacing: { before: 100, after: 50 },
      shading: { fill: 'F0F0F0' },
      children: [
        new docx.TextRun({ text: '  전체 계획  ', size: 24, font: '맑은 고딕', bold: true, color: '333333' }),
        new docx.TextRun({ text: `${auto.totalProgress || 0}%`, size: 24, font: '맑은 고딕', bold: true, color: '333333' }),
        new docx.TextRun({ text: '    전체 실적  ', size: 24, font: '맑은 고딕', bold: true, color: '555555' }),
        new docx.TextRun({ text: `${auto.totalActual || 0}%`, size: 24, font: '맑은 고딕', bold: true, color: '555555' }),
        new docx.TextRun({ text: `    차이  `, size: 24, font: '맑은 고딕', bold: true, color: diff >= 0 ? '555555' : '333333' }),
        new docx.TextRun({ text: `${diffSign}${diff}%`, size: 24, font: '맑은 고딕', bold: true, color: diff >= 0 ? '555555' : '333333' }),
      ],
    }));

    // 업무별 진척률 (표 형태)
    if (auto.bizProgress?.length) {
      children.push(new docx.Paragraph({ spacing: { before: 150, after: 50 }, children: [new docx.TextRun({ text: '업무별 진척률', size: 20, font: '맑은 고딕', bold: true, color: '333333' })] }));
      const bizRows = auto.bizProgress.map((b: any) => {
        const d = Math.round((b.actualRate - b.progressRate) * 10) / 10;
        return [b.taskName, `${b.progressRate}%`, `${b.actualRate}%`, `${d > 0 ? '+' : ''}${d}%`];
      });
      children.push(createTable(['업무', '계획', '실적', '차이'], bizRows));
    }

    // 3. 이슈/리스크 현황
    if (auto.openIssues?.length || auto.openRisks?.length) {
      children.push(createHeading(`3. 이슈/리스크 현황 (이슈 ${auto.openIssueCount || 0}건, 리스크 ${auto.openRiskCount || 0}건)`));
      if (auto.openIssues?.length) {
        children.push(new docx.Paragraph({ spacing: { before: 100 }, children: [new docx.TextRun({ text: `미해결 이슈 (${auto.openIssueCount}건)`, bold: true, size: BODY_SIZE, font: '맑은 고딕' })] }));
        children.push(createTable(
          ['이슈명', '이슈내용', '변경내역', '상태', '중요도', '담당자'],
          auto.openIssues.map((i: any) => [i.issueTitle, i.content || '', i.lastChangeContent || '', i.status, i.importance || '', i.assigneeName || '']),
        ));
      }
      if (auto.openRisks?.length) {
        children.push(new docx.Paragraph({ spacing: { before: 100 }, children: [new docx.TextRun({ text: `미해결 리스크 (${auto.openRiskCount}건)`, bold: true, size: BODY_SIZE, font: '맑은 고딕' })] }));
        children.push(createTable(
          ['리스크명', '변경내역', '상태', '영향도', '담당자'],
          auto.openRisks.map((r: any) => [r.riskName, r.lastChangeContent || '', r.status, r.impactLevel || '', r.ownerName || '']),
        ));
      }
    }

    // 4. 팀별 실적/계획
    children.push(createHeading('4. 팀별 실적/계획'));

    for (const section of report.sections) {
      children.push(new docx.Paragraph({
        spacing: { before: 200, after: 100 },
        children: [
          new docx.TextRun({ text: `${section.teamName}`, bold: true, size: HEADING_SIZE, font: '맑은 고딕', color: '333333' }),
        ],
      }));

      const curTasks = (section.currentTasks as any[]) || [];
      const nxtTasks = (section.nextTasks as any[]) || [];
      const curLabel = report.reportType === 'weekly' ? '금주 실적' : '금월 실적';
      const nxtLabel = report.reportType === 'weekly' ? '차주 계획' : '차월 계획';
      const maxRows = Math.max(curTasks.length, nxtTasks.length, 1);

      // 좌우 병렬 테이블: 금주 실적 | 차주 계획
      const sideRows: docx.TableRow[] = [];
      // 헤더
      const hdFill = 'E0E0E0';
      const hdColor = '333333';
      sideRows.push(new docx.TableRow({
        tableHeader: true,
        children: [
          new docx.TableCell({ width: { size: 35, type: docx.WidthType.PERCENTAGE }, shading: { fill: hdFill }, children: [new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: curLabel, bold: true, size: 18, font: '맑은 고딕', color: hdColor })] })] }),
          new docx.TableCell({ width: { size: 10, type: docx.WidthType.PERCENTAGE }, shading: { fill: hdFill }, children: [new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: '일정', bold: true, size: 16, font: '맑은 고딕', color: hdColor })] })] }),
          new docx.TableCell({ width: { size: 5, type: docx.WidthType.PERCENTAGE }, shading: { fill: hdFill }, children: [new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: '상태', bold: true, size: 16, font: '맑은 고딕', color: hdColor })] })] }),
          new docx.TableCell({ width: { size: 35, type: docx.WidthType.PERCENTAGE }, shading: { fill: hdFill }, children: [new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: nxtLabel, bold: true, size: 18, font: '맑은 고딕', color: hdColor })] })] }),
          new docx.TableCell({ width: { size: 10, type: docx.WidthType.PERCENTAGE }, shading: { fill: hdFill }, children: [new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: '일정', bold: true, size: 16, font: '맑은 고딕', color: hdColor })] })] }),
          new docx.TableCell({ width: { size: 5, type: docx.WidthType.PERCENTAGE }, shading: { fill: hdFill }, children: [new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: '상태', bold: true, size: 16, font: '맑은 고딕', color: hdColor })] })] }),
        ],
      }));
      for (let i = 0; i < maxRows; i++) {
        const cur = curTasks[i];
        const nxt = nxtTasks[i];
        const mkCell = (text: string, align?: (typeof docx.AlignmentType)[keyof typeof docx.AlignmentType]) => new docx.TableCell({
          children: [new docx.Paragraph({ alignment: align || docx.AlignmentType.LEFT, children: [new docx.TextRun({ text, size: 16, font: '맑은 고딕' })] })],
          verticalAlign: docx.VerticalAlign.CENTER,
        });
        const sch = (t: any) => t ? (t.schedule || `${fmtShort(t.scheduleStart)}~${fmtShort(t.scheduleEnd)}`) : '';
        // 내용 행
        sideRows.push(new docx.TableRow({
          children: [
            mkCell(cur?.content || ''),
            mkCell(sch(cur), docx.AlignmentType.CENTER),
            mkCell(cur?.status || '', docx.AlignmentType.CENTER),
            mkCell(nxt?.content || ''),
            mkCell(sch(nxt), docx.AlignmentType.CENTER),
            mkCell(nxt?.status || '', docx.AlignmentType.CENTER),
          ],
        }));
      }
      // 비고 행 (테이블 내부 마지막 행)
      if (section.currentRemark || section.nextRemark) {
        const remarkCell = (text: string) => new docx.TableCell({
          columnSpan: 3, shading: { fill: 'FAFAFA' },
          children: [new docx.Paragraph({ children: [
            new docx.TextRun({ text: '비고: ', bold: true, size: 14, font: '맑은 고딕', color: '666666' }),
            new docx.TextRun({ text: text, size: 14, font: '맑은 고딕', color: '666666', italics: true }),
          ] })],
        });
        sideRows.push(new docx.TableRow({
          children: [
            remarkCell(section.currentRemark || ''),
            remarkCell(section.nextRemark || ''),
          ],
        }));
      }
      // 이슈/건의사항 (테이블 내부 마지막 행)
      if (section.issues) {
        sideRows.push(new docx.TableRow({
          children: [
            new docx.TableCell({
              columnSpan: 6, shading: { fill: 'F5F5F5' },
              children: [new docx.Paragraph({ children: [
                new docx.TextRun({ text: '이슈/건의: ', bold: true, size: 14, font: '맑은 고딕', color: '333333' }),
                new docx.TextRun({ text: section.issues, size: 14, font: '맑은 고딕' }),
              ] })],
            }),
          ],
        }));
      }
      children.push(new docx.Table({ width: { size: 100, type: docx.WidthType.PERCENTAGE }, rows: sideRows }));
    }

    // 5. 개발진척현황
    if (auto.devProgress) {
      children.push(createHeading('5. 개발진척현황'));
      children.push(new docx.Paragraph({
        spacing: { after: 100 },
        children: [
          new docx.TextRun({ text: `전체 ${auto.devProgress.total}본  |  완료 ${auto.devProgress.done}본 (${auto.devProgress.doneRate}%)  |  진행 ${auto.devProgress.inProgress}본  |  지연 ${auto.devProgress.delayed}본`, size: BODY_SIZE, font: '맑은 고딕' }),
        ],
      }));
      if (auto.devProgress.byTask?.length) {
        children.push(createTable(
          ['업무', '전체', '완료', '완료율'],
          auto.devProgress.byTask.map((t: any) => [t.taskCode, String(t.total), String(t.done), `${t.doneRate}%`]),
        ));
        // 시각적 바 차트 (텍스트 기반)
        for (const t of auto.devProgress.byTask) {
          const barLen = Math.round(t.doneRate / 5);
          const bar = '█'.repeat(barLen) + '░'.repeat(20 - barLen);
          children.push(new docx.Paragraph({
            spacing: { before: 30, after: 30 },
            children: [
              new docx.TextRun({ text: `${t.taskCode}  `, size: 16, font: '맑은 고딕' }),
              new docx.TextRun({ text: bar, size: 16, font: 'Courier New', color: '43A047' }),
              new docx.TextRun({ text: ` ${t.doneRate}%`, size: 16, font: '맑은 고딕', bold: true }),
            ],
          }));
        }
      }
    }

    // 7. 총괄소견
    if (report.summaryNote) {
      children.push(createHeading(`${auto.devProgress ? '7' : '6'}. 관리자 총괄소견`));
      children.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: report.summaryNote, size: BODY_SIZE, font: '맑은 고딕' })],
      }));
    }

    const doc = new docx.Document({
      sections: [{
        properties: {
          page: {
            size: { orientation: docx.PageOrientation.LANDSCAPE, width: 16838, height: 11906 },
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children,
      }],
    });

    const buffer = await docx.Packer.toBuffer(doc);

    const fileName = encodeURIComponent(`${report.title}.docx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('DOCX export error:', err);
    res.status(500).json({ success: false, message: 'DOCX 생성 중 오류' });
  }
});

// ── DOCX 헬퍼 ──
function createHeading(text: string): docx.Paragraph {
  return new docx.Paragraph({
    spacing: { before: 300, after: 100 },
    children: [new docx.TextRun({ text, bold: true, size: 24, font: '맑은 고딕', color: '333333' })],
    border: { bottom: { style: docx.BorderStyle.SINGLE, size: 1, color: '999999' } },
  });
}

function createInfoTable(rows: string[][]): docx.Table {
  return new docx.Table({
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    rows: rows.map(([label, value]) => new docx.TableRow({
      children: [
        new docx.TableCell({
          width: { size: 25, type: docx.WidthType.PERCENTAGE },
          shading: { fill: 'F5F5F5' },
          children: [new docx.Paragraph({ children: [new docx.TextRun({ text: label, bold: true, size: 20, font: '맑은 고딕' })] })],
          verticalAlign: docx.VerticalAlign.CENTER,
        }),
        new docx.TableCell({
          width: { size: 75, type: docx.WidthType.PERCENTAGE },
          children: [new docx.Paragraph({ children: [new docx.TextRun({ text: value, size: 20, font: '맑은 고딕' })] })],
          verticalAlign: docx.VerticalAlign.CENTER,
        }),
      ],
    })),
  });
}

function createTable(headers: string[], rows: string[][]): docx.Table {
  const colWidth = Math.floor(100 / headers.length);
  return new docx.Table({
    width: { size: 100, type: docx.WidthType.PERCENTAGE },
    rows: [
      new docx.TableRow({
        tableHeader: true,
        children: headers.map(h => new docx.TableCell({
          width: { size: colWidth, type: docx.WidthType.PERCENTAGE },
          shading: { fill: 'EEEEEE' },
          children: [new docx.Paragraph({
            alignment: docx.AlignmentType.CENTER,
            children: [new docx.TextRun({ text: h, bold: true, size: 18, font: '맑은 고딕', color: '333333' })],
          })],
          verticalAlign: docx.VerticalAlign.CENTER,
        })),
      }),
      ...rows.map(row => new docx.TableRow({
        children: row.map((cell, i) => new docx.TableCell({
          width: { size: colWidth, type: docx.WidthType.PERCENTAGE },
          children: [new docx.Paragraph({
            alignment: i === 0 ? docx.AlignmentType.LEFT : docx.AlignmentType.CENTER,
            children: [new docx.TextRun({ text: cell, size: 18, font: '맑은 고딕' })],
          })],
          verticalAlign: docx.VerticalAlign.CENTER,
        })),
      })),
    ],
  });
}

export default router;
