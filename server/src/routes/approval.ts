import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';
import { createNotification } from './notifications';

const router = Router({ mergeParams: true });
router.use(authenticate);

// 기본 승인 임계값
const DEFAULT_THRESHOLDS: Record<string, number> = {
  '작성완료': 80, 'PL승인': 90, 'QA승인': 95, 'PMO승인': 98, 'Customer승인': 100,
};

// depth → 역할명 매핑 (기본값, approvalLine 없을 때 폴백용)
const DEPTH_ROLE: Record<number, string> = { 1: 'PL', 2: 'QA', 3: 'PMO', 4: 'Customer' };
const DEPTH_LABEL: Record<number, string> = { 1: 'PL승인', 2: 'QA승인', 3: 'PMO승인', 4: 'Customer승인' };

// 프로젝트 결재라인 기반: 최대 depth 조회
async function getMaxDepth(projectId: bigint): Promise<number> {
  const line = await getApprovalLine(projectId);
  const maxDepth = line.filter(s => s.depth > 0).reduce((m, s) => Math.max(m, s.depth), 0);
  return maxDepth || 4; // 최소 안전값
}

// 프로젝트 결재라인 기반: depth별 role/label 조회
async function getDepthInfo(projectId: bigint, depth: number): Promise<{ role: string; label: string }> {
  const line = await getApprovalLine(projectId);
  const step = line.find(s => s.depth === depth);
  if (step) return { role: step.role, label: step.label };
  return { role: DEPTH_ROLE[depth] || `Depth${depth}`, label: DEPTH_LABEL[depth] || `Depth${depth}승인` };
}

// 프로젝트 승인 임계값 조회
async function getThresholds(projectId: bigint): Promise<Record<string, number>> {
  const project = await prisma.project.findUnique({ where: { projectId }, select: { approvalThresholds: true } });
  return { ...DEFAULT_THRESHOLDS, ...((project?.approvalThresholds as any) || {}) };
}

// 프로젝트의 결재라인 조회
async function getApprovalLine(projectId: bigint): Promise<{ depth: number; role: string; label: string; threshold: number }[]> {
  const project = await prisma.project.findUnique({ where: { projectId }, select: { approvalLine: true, approvalThresholds: true } });
  const line = project?.approvalLine as any[];
  if (line && Array.isArray(line) && line.length > 0) return line;
  // 기존 호환
  const t = { ...DEFAULT_THRESHOLDS, ...((project?.approvalThresholds as any) || {}) };
  return [
    { depth: 0, role: 'TM', label: '산출물 작성 완료', threshold: t['작성완료'] || 80 },
    { depth: 1, role: 'PL', label: 'PL 승인', threshold: t['PL승인'] || 90 },
    { depth: 2, role: 'QA', label: 'QA 승인', threshold: t['QA승인'] || 95 },
    { depth: 3, role: 'PMO', label: 'PMO 승인', threshold: t['PMO승인'] || 98 },
    { depth: 4, role: 'Customer', label: 'Customer 승인', threshold: t['Customer승인'] || 100 },
  ];
}

// 태스크의 산출물 최소 승인 depth로 실적 상한 계산
async function getMaxActualRate(taskId: bigint, projectId: bigint): Promise<number> {
  const project = await prisma.project.findUnique({ where: { projectId }, select: { approvalEnabled: true } });
  if (!project?.approvalEnabled) return 100;

  const deliverables = await prisma.deliverable.findMany({
    where: { taskId },
    select: { approvalDepth: true, status: true },
  });
  if (deliverables.length === 0) return 100;

  const minDepth = Math.min(...deliverables.map(d => d.approvalDepth));
  const line = await getApprovalLine(projectId);

  // minDepth에 해당하는 단계의 threshold 반환
  const step = line.find(s => s.depth === minDepth);
  return step?.threshold || 80;
}

// GET /api/v1/projects/:projectId/approval/max-rate/:taskId — 태스크 실적 상한 조회
router.get('/max-rate/:taskId', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const taskId = BigInt(req.params.taskId);
    const maxRate = await getMaxActualRate(taskId, projectId);
    res.json({ success: true, data: { maxRate } });
  } catch (err) {
    console.error('Max rate error:', err);
    res.status(500).json({ success: false, message: '상한 조회 중 오류' });
  }
});

// GET /api/v1/projects/:projectId/approval/deliverable/:docId — 산출물 승인 현황 조회
router.get('/deliverable/:docId', async (req: Request, res: Response) => {
  try {
    const docId = BigInt(req.params.docId);
    const deliverable = await prisma.deliverable.findUnique({
      where: { docId },
      include: {
        approvals: {
          include: { approver: { select: { userId: true, userName: true, department: true } } },
          orderBy: { depth: 'asc' },
        },
        task: { select: { taskId: true, taskName: true, wbsCode: true, projectId: true } },
        uploader: { select: { userId: true, userName: true } },
      },
    });
    if (!deliverable) { res.status(404).json({ success: false, message: '산출물을 찾을 수 없습니다.' }); return; }

    const projectId = deliverable.task.projectId;
    const thresholds = await getThresholds(projectId);

    res.json({
      success: true,
      data: {
        ...deliverable,
        docId: Number(deliverable.docId),
        taskId: Number(deliverable.taskId),
        approvals: deliverable.approvals.map(a => ({
          ...a,
          approvalId: Number(a.approvalId),
          docId: Number(a.docId),
        })),
        thresholds,
      },
    });
  } catch (err) {
    console.error('Deliverable approval status error:', err);
    res.status(500).json({ success: false, message: '승인 현황 조회 중 오류' });
  }
});

// POST /api/v1/projects/:projectId/approval/complete/:docId — 산출물 작성 완료
router.post('/complete/:docId', async (req: Request, res: Response) => {
  try {
    const docId = BigInt(req.params.docId);
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId as string);

    await prisma.deliverable.update({
      where: { docId },
      data: { status: '작성완료' },
    });

    // 프로젝트 결재라인 기반 승인 단계 자동 생성 — 모두 대기 상태
    const maxDepth = await getMaxDepth(projectId);
    for (let depth = 1; depth <= maxDepth; depth++) {
      const info = await getDepthInfo(projectId, depth);
      await prisma.deliverableApproval.upsert({
        where: { docId_depth: { docId, depth } },
        update: {},
        create: { docId, depth, approverRole: info.role, status: '대기' },
      });
    }

    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'deliverable', targetId: docId, changeDetail: { action: '작성완료' } });
    res.json({ success: true, message: '산출물이 작성완료 처리되었습니다.' });
  } catch (err) {
    console.error('Complete error:', err);
    res.status(500).json({ success: false, message: '작성완료 처리 중 오류' });
  }
});

// POST /api/v1/projects/:projectId/approval/request/:docId — 승인 요청 (다음 단계)
router.post('/request/:docId', async (req: Request, res: Response) => {
  try {
    const docId = BigInt(req.params.docId);
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId as string);

    const deliverable = await prisma.deliverable.findUnique({
      where: { docId },
      select: { approvalDepth: true, status: true },
    });
    if (!deliverable) { res.status(404).json({ success: false, message: '산출물을 찾을 수 없습니다.' }); return; }

    const nextDepth = deliverable.approvalDepth + 1;
    const maxDepth = await getMaxDepth(projectId);
    if (nextDepth > maxDepth) { res.status(400).json({ success: false, message: '모든 승인이 완료되었습니다.' }); return; }

    // 승인 단계 상태 업데이트
    await prisma.deliverableApproval.update({
      where: { docId_depth: { docId, depth: nextDepth } },
      data: { status: '승인요청', requestedAt: new Date() },
    });

    await prisma.deliverable.update({
      where: { docId },
      data: { status: '승인요청' },
    });

    // 승인자에게 알림
    const approvalRecord = await prisma.deliverableApproval.findUnique({ where: { docId_depth: { docId, depth: nextDepth } } });
    if (approvalRecord?.approverId) {
      const doc = await prisma.deliverable.findUnique({ where: { docId }, select: { docName: true, taskId: true } });
      const task = doc?.taskId ? await prisma.wbsTask.findUnique({ where: { taskId: doc.taskId }, select: { taskName: true } }) : null;
      const requester = await prisma.user.findUnique({ where: { userId: currentUser.userId }, select: { userName: true } });
      const info = await getDepthInfo(projectId, nextDepth);
      await createNotification({
        userId: approvalRecord.approverId, projectId,
        type: 'approval_request',
        title: `[산출물 승인요청] ${doc?.docName || ''}`,
        message: `${requester?.userName || currentUser.userId}님이 ${info.label} 승인을 요청합니다. (${task?.taskName || ''})`,
        link: `/projects/${Number(projectId)}/wbs?task=${doc?.taskId ? Number(doc.taskId) : ''}`,
      });
    }

    const depthInfo = await getDepthInfo(projectId, nextDepth);
    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'deliverable_approval', targetId: docId, changeDetail: { action: '승인요청', depth: nextDepth, role: depthInfo.role } });
    res.json({ success: true, message: `${depthInfo.label} 승인 요청하였습니다.` });
  } catch (err) {
    console.error('Request error:', err);
    res.status(500).json({ success: false, message: '승인 요청 중 오류' });
  }
});

// POST /api/v1/projects/:projectId/approval/request-next/:taskId — 태스크 단위 다음 단계 승인요청
router.post('/request-next/:taskId', async (req: Request, res: Response) => {
  try {
    const taskId = BigInt(req.params.taskId);
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId as string);

    // 태스크 담당자만 승인요청 가능 (PMSAdmin은 예외)
    const task = await prisma.wbsTask.findUnique({ where: { taskId }, select: { assigneeId: true } });
    const member = await prisma.projectMember.findFirst({ where: { projectId, userId: currentUser.userId }, select: { role: true } });
    const isPmsAdmin = member?.role === 'PMSAdmin';
    if (!isPmsAdmin && task?.assigneeId !== currentUser.userId) {
      res.status(403).json({ success: false, message: '승인요청은 태스크 담당자만 할 수 있습니다.' });
      return;
    }

    // 태스크의 모든 산출물 조회
    const deliverables = await prisma.deliverable.findMany({
      where: { taskId },
      select: { docId: true, approvalDepth: true, status: true },
    });
    if (!deliverables.length) { res.status(400).json({ success: false, message: '산출물이 없습니다.' }); return; }

    // 반려 건 확인
    const rejectedDocs = deliverables.filter(d => d.status === '반려');
    if (rejectedDocs.length > 0) {
      res.status(400).json({ success: false, message: `반려된 산출물 ${rejectedDocs.length}건이 있습니다. 반려 건을 재요청한 후 진행해주세요.` });
      return;
    }

    // 모든 산출물이 동일 depth까지 승인 완료인지 확인
    const depths = deliverables.map(d => d.approvalDepth);
    const minDepth = Math.min(...depths);
    const maxDepthOfDocs = Math.max(...depths);
    const nextDepth = minDepth + 1;
    const projectMaxDepth = await getMaxDepth(projectId);

    if (nextDepth > projectMaxDepth) { res.status(400).json({ success: false, message: '모든 승인이 완료되었습니다.' }); return; }

    if (minDepth !== maxDepthOfDocs) {
      res.status(400).json({ success: false, message: '모든 산출물이 동일 단계까지 승인 완료되어야 합니다.' });
      return;
    }

    // depth >= 2: approverId 필수, depth 1 (PL): 소속 부서 팀장 자동
    let { approverId } = req.body;
    if (nextDepth >= 2 && !approverId) {
      res.status(400).json({ success: false, message: '승인 대상자를 선택해주세요.' });
      return;
    }

    // depth 1: 태스크 담당자의 소속 부서 팀장 자동 지정
    if (nextDepth === 1) {
      const pid = BigInt(req.params.projectId as string);
      const taskForLeader = await prisma.wbsTask.findUnique({ where: { taskId }, select: { assigneeId: true } });
      if (taskForLeader?.assigneeId) {
        const assignee = await prisma.user.findUnique({ where: { userId: taskForLeader.assigneeId }, select: { department: true } });
        if (assignee?.department) {
          // 같은 부서 팀장 조회
          const leaders = await prisma.projectMember.findMany({
            where: { projectId: pid, role: 'PL' },
            include: { user: { select: { userId: true, department: true } } },
          });
          const deptLeader = leaders.find(l => l.user.department === assignee.department);
          if (deptLeader) approverId = deptLeader.userId;
        }
      }
    }

    // 모든 산출물에 대해 다음 단계 승인요청
    for (const d of deliverables) {
      if (d.approvalDepth === minDepth) {
        await prisma.deliverableApproval.update({
          where: { docId_depth: { docId: d.docId, depth: nextDepth } },
          data: { status: '승인요청', requestedAt: new Date(), approverId: approverId || null },
        });
        await prisma.deliverable.update({
          where: { docId: d.docId },
          data: { status: '승인요청' },
        });
      }
    }

    const nextDepthInfo = await getDepthInfo(projectId, nextDepth);
    const approverName = approverId ? (await prisma.user.findUnique({ where: { userId: approverId }, select: { userName: true } }))?.userName : nextDepthInfo.role;

    // 승인자에게 알림
    if (approverId) {
      const taskInfo = await prisma.wbsTask.findUnique({ where: { taskId }, select: { taskName: true } });
      const requester = await prisma.user.findUnique({ where: { userId: currentUser.userId }, select: { userName: true } });
      await createNotification({
        userId: approverId, projectId,
        type: 'approval_request',
        title: `[산출물 승인요청] ${taskInfo?.taskName || ''} (${deliverables.length}건)`,
        message: `${requester?.userName || currentUser.userId}님이 ${nextDepthInfo.label} 승인을 요청합니다.`,
        link: `/projects/${Number(projectId)}/wbs?task=${Number(taskId)}`,
      });
    }

    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'deliverable_approval', changeDetail: { action: '일괄승인요청', taskId: Number(taskId), depth: nextDepth, approverId } });
    res.json({ success: true, message: `${approverName}에게 승인 요청하였습니다.` });
  } catch (err) {
    console.error('Request next error:', err);
    res.status(500).json({ success: false, message: '승인 요청 중 오류' });
  }
});

// POST /api/v1/projects/:projectId/approval/approve/:docId — 승인 처리
router.post('/approve/:docId', async (req: Request, res: Response) => {
  try {
    const docId = BigInt(req.params.docId);
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId as string);
    const { comment } = req.body;

    const deliverable = await prisma.deliverable.findUnique({
      where: { docId },
      select: { approvalDepth: true },
    });
    if (!deliverable) { res.status(404).json({ success: false, message: '산출물을 찾을 수 없습니다.' }); return; }

    const targetDepth = deliverable.approvalDepth + 1;
    const maxDepth = await getMaxDepth(projectId);
    const approval = await prisma.deliverableApproval.findUnique({
      where: { docId_depth: { docId, depth: targetDepth } },
    });
    if (!approval || approval.status !== '승인요청') {
      res.status(400).json({ success: false, message: '승인 요청 상태가 아닙니다.' }); return;
    }

    await prisma.deliverableApproval.update({
      where: { docId_depth: { docId, depth: targetDepth } },
      data: { status: '승인', approverId: currentUser.userId, comment: comment || null, processedAt: new Date() },
    });

    // 최종 depth까지 도달하면 승인완료, 아니면 승인완료(단계)
    await prisma.deliverable.update({
      where: { docId },
      data: { approvalDepth: targetDepth, status: targetDepth >= maxDepth ? '승인완료' : '승인완료(단계)' },
    });

    // 태스크의 모든 산출물이 이 단계까지 승인 완료되었는지 확인 → 제안 상한값 반환
    const fullDoc = await prisma.deliverable.findUnique({ where: { docId }, select: { taskId: true } });
    let suggestedRate: number | null = null;
    if (fullDoc) {
      const allDocs = await prisma.deliverable.findMany({
        where: { taskId: fullDoc.taskId },
        select: { approvalDepth: true },
      });
      const allAtThisDepth = allDocs.every(d => d.approvalDepth >= targetDepth);
      if (allAtThisDepth) {
        const line = await getApprovalLine(projectId);
        const step = line.find(s => s.depth === targetDepth);
        suggestedRate = step?.threshold || (targetDepth >= maxDepth ? 100 : 80);
      }
    }

    const depthInfo = await getDepthInfo(projectId, targetDepth);
    const label = depthInfo.label;

    // 태스크 담당자에게 승인 완료 + 다음 단계 요청 안내 알림
    if (fullDoc?.taskId) {
      const task = await prisma.wbsTask.findUnique({ where: { taskId: fullDoc.taskId }, select: { assigneeId: true, taskName: true } });
      const doc = await prisma.deliverable.findUnique({ where: { docId }, select: { docName: true } });
      if (task?.assigneeId && task.assigneeId !== currentUser.userId) {
        const nextLabel = targetDepth < maxDepth ? (await getDepthInfo(projectId, targetDepth + 1)).label : null;
        const msg = nextLabel
          ? `${task.taskName} — ${label} 승인되었습니다. 다음 단계(${nextLabel}) 승인요청을 진행해주세요.`
          : `${task.taskName} — ${label} 승인되었습니다. 모든 승인이 완료되었습니다.`;
        await createNotification({
          userId: task.assigneeId, projectId,
          type: 'approval_done',
          title: `[승인완료] ${doc?.docName || ''}`,
          message: msg,
          link: `/projects/${Number(projectId)}/wbs?task=${Number(fullDoc.taskId)}&fromApproval=1`,
        });
      }
    }

    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'deliverable_approval', targetId: docId, changeDetail: { action: '승인', depth: targetDepth, label } });
    res.json({ success: true, message: `${label} 처리가 완료되었습니다.`, suggestedRate });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ success: false, message: '승인 처리 중 오류' });
  }
});

// POST /api/v1/projects/:projectId/approval/reject/:docId — 반려 처리
router.post('/reject/:docId', async (req: Request, res: Response) => {
  try {
    const docId = BigInt(req.params.docId);
    const currentUser = (req as any).user as JwtPayload;
    const { comment } = req.body;

    const deliverable = await prisma.deliverable.findUnique({
      where: { docId },
      select: { approvalDepth: true },
    });
    if (!deliverable) { res.status(404).json({ success: false, message: '산출물을 찾을 수 없습니다.' }); return; }

    const targetDepth = deliverable.approvalDepth + 1;
    const projectId = BigInt(req.params.projectId as string);

    // 기존 하위 단계 승인자 수집 (PL 승인 후 QA 반려 시 PL에게 알림용)
    const prevApprovers = await prisma.deliverableApproval.findMany({
      where: { docId, depth: { lt: targetDepth }, status: '승인', approverId: { not: null } },
      select: { approverId: true, depth: true },
    });

    // 반려 이력 기록 (사유 포함)
    await prisma.deliverableApproval.update({
      where: { docId_depth: { docId, depth: targetDepth } },
      data: { status: '반려', approverId: currentUser.userId, comment: comment || null, processedAt: new Date() },
    });

    // 반려 시: 모든 승인 단계 초기화, 산출물 처음부터 다시 작성 (approvalDepth = 0)
    // 단 반려 이력은 위에서 기록됨
    await prisma.deliverableApproval.updateMany({
      where: { docId, depth: { not: targetDepth } },
      data: { status: '대기', requestedAt: null, approverId: null, processedAt: null, comment: null },
    });
    await prisma.deliverable.update({
      where: { docId },
      data: { status: '반려', approvalDepth: 0 },
    });

    // 태스크 실적 진행률을 depth 0 기준 상한(작성완료 임계값)으로 하향 조정
    const docForTask = await prisma.deliverable.findUnique({ where: { docId }, select: { taskId: true } });
    if (docForTask?.taskId) {
      const line = await getApprovalLine(projectId);
      const baseStep = line.find(s => s.depth === 0);
      const baseThreshold = baseStep?.threshold || 80;
      const currentTask = await prisma.wbsTask.findUnique({ where: { taskId: docForTask.taskId }, select: { actualRate: true } });
      if (currentTask && Number(currentTask.actualRate) > baseThreshold) {
        await prisma.wbsTask.update({
          where: { taskId: docForTask.taskId },
          data: { actualRate: baseThreshold },
        });
      }
    }

    // 알림 대상 수집: 태스크 담당자 + 기존 하위 단계 승인자
    const fullDoc = await prisma.deliverable.findUnique({ where: { docId }, select: { docName: true, taskId: true } });
    const notifyIds = new Set<string>();
    if (fullDoc?.taskId) {
      const task = await prisma.wbsTask.findUnique({ where: { taskId: fullDoc.taskId }, select: { assigneeId: true, taskName: true } });
      if (task?.assigneeId && task.assigneeId !== currentUser.userId) notifyIds.add(task.assigneeId);
      for (const p of prevApprovers) {
        if (p.approverId && p.approverId !== currentUser.userId) notifyIds.add(p.approverId);
      }

      if (notifyIds.size > 0) {
        const depthInfo = await getDepthInfo(projectId, targetDepth);
        const taskName = task?.taskName || '';
        for (const uid of notifyIds) {
          const isAssignee = uid === task?.assigneeId;
          const msg = isAssignee
            ? `${taskName} — ${depthInfo.label} 반려되었습니다.${comment ? ' 사유: ' + comment : ''}`
            : `${taskName} — ${depthInfo.label}이(가) 반려했습니다. 담당자가 재작성 후 다시 승인요청이 들어올 수 있습니다.${comment ? ' 사유: ' + comment : ''}`;
          await createNotification({
            userId: uid, projectId,
            type: 'approval_rejected',
            title: `[반려] ${fullDoc.docName || ''}`,
            message: msg,
            link: `/projects/${Number(projectId)}/wbs?task=${Number(fullDoc.taskId)}${isAssignee ? '&fromApproval=1' : ''}`,
          });
        }
      }
    }

    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'deliverable_approval', targetId: docId, changeDetail: { action: '반려', depth: targetDepth } });
    res.json({ success: true, message: '반려 처리되었습니다.' });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ success: false, message: '반려 처리 중 오류' });
  }
});

// POST /api/v1/projects/:projectId/approval/re-request/:taskId — 반려 건 재요청 (같은 단계)
router.post('/re-request/:taskId', async (req: Request, res: Response) => {
  try {
    const taskId = BigInt(req.params.taskId);
    const currentUser = (req as any).user as JwtPayload;

    const projectId = BigInt(req.params.projectId as string);

    // 반려된 산출물 조회
    const rejectedDocs = await prisma.deliverable.findMany({
      where: { taskId, status: '반려' },
      select: { docId: true, approvalDepth: true },
    });
    if (!rejectedDocs.length) { res.status(400).json({ success: false, message: '반려된 산출물이 없습니다.' }); return; }

    // PL(depth 1) 재요청 시 담당자의 소속 부서 팀장 자동 지정
    const task = await prisma.wbsTask.findUnique({ where: { taskId }, select: { assigneeId: true, taskName: true } });
    let defaultApproverId: string | null = null;
    if (task?.assigneeId) {
      const assignee = await prisma.user.findUnique({ where: { userId: task.assigneeId }, select: { department: true } });
      if (assignee?.department) {
        const leaders = await prisma.projectMember.findMany({
          where: { projectId, role: 'PL' },
          include: { user: { select: { userId: true, department: true } } },
        });
        const deptLeader = leaders.find(l => l.user.department === assignee.department);
        if (deptLeader) defaultApproverId = deptLeader.userId;
      }
    }

    // 반려된 단계에 다시 승인요청
    const notifyUserIds = new Set<string>();
    for (const d of rejectedDocs) {
      const reRequestDepth = d.approvalDepth + 1;
      await prisma.deliverableApproval.update({
        where: { docId_depth: { docId: d.docId, depth: reRequestDepth } },
        data: { status: '승인요청', requestedAt: new Date(), comment: null, approverId: reRequestDepth === 1 ? defaultApproverId : null, processedAt: null },
      });
      await prisma.deliverable.update({
        where: { docId: d.docId },
        data: { status: '승인요청' },
      });
      if (reRequestDepth === 1 && defaultApproverId) notifyUserIds.add(defaultApproverId);
    }

    // 승인권자에게 알림
    if (notifyUserIds.size > 0) {
      const requester = await prisma.user.findUnique({ where: { userId: currentUser.userId }, select: { userName: true } });
      for (const uid of notifyUserIds) {
        await createNotification({
          userId: uid, projectId,
          type: 'approval_request',
          title: `[산출물 재승인요청] ${task?.taskName || ''} (${rejectedDocs.length}건)`,
          message: `${requester?.userName || currentUser.userId}님이 반려된 산출물을 수정하여 ${(await getDepthInfo(projectId, 1)).label} 재승인을 요청합니다.`,
          link: `/projects/${Number(projectId)}/wbs?task=${Number(taskId)}`,
        });
      }
    }

    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'deliverable_approval', changeDetail: { action: '반려건 재요청', taskId: Number(taskId), count: rejectedDocs.length } });
    res.json({ success: true, message: `${rejectedDocs.length}건 반려 산출물을 재요청하였습니다.` });
  } catch (err) {
    console.error('Re-request error:', err);
    res.status(500).json({ success: false, message: '재요청 처리 중 오류' });
  }
});

// POST /api/v1/projects/:projectId/approval/withdraw-task/:taskId — 태스크 단위 일괄 회수
router.post('/withdraw-task/:taskId', async (req: Request, res: Response) => {
  try {
    const taskId = BigInt(req.params.taskId as string);
    const currentUser = (req as any).user as JwtPayload;

    // 태스크의 승인요청 중인 산출물 조회
    const deliverables = await prisma.deliverable.findMany({
      where: { taskId, status: '승인요청' },
      select: { docId: true, approvalDepth: true },
    });
    if (!deliverables.length) { res.status(400).json({ success: false, message: '회수할 승인요청이 없습니다.' }); return; }

    let withdrawn = 0;
    const notifyApproverIds = new Set<string>();
    let withdrawDepth = 0;

    for (const d of deliverables) {
      const targetDepth = d.approvalDepth + 1;
      const approval = await prisma.deliverableApproval.findUnique({
        where: { docId_depth: { docId: d.docId, depth: targetDepth } },
      });
      if (approval && approval.status === '승인요청') {
        if (approval.approverId) notifyApproverIds.add(approval.approverId);
        withdrawDepth = targetDepth;
        // 회수: 현재 승인요청 중인 단계만 '대기'로 되돌림 (이전 승인 유지)
        await prisma.deliverableApproval.update({
          where: { docId_depth: { docId: d.docId, depth: targetDepth } },
          data: { status: '대기', requestedAt: null, approverId: null, processedAt: null, comment: null },
        });
        // 산출물 상태: 최초 단계(PL) 회수면 '작성완료', 그 이후는 '승인완료(단계)'
        await prisma.deliverable.update({
          where: { docId: d.docId },
          data: { status: d.approvalDepth === 0 ? '작성완료' : '승인완료(단계)' },
        });
        withdrawn++;
      }
    }

    // 회수된 승인권자에게 알림
    if (notifyApproverIds.size > 0) {
      const projectId = BigInt(req.params.projectId as string);
      const taskInfo = await prisma.wbsTask.findUnique({ where: { taskId }, select: { taskName: true } });
      const label = (await getDepthInfo(projectId, withdrawDepth)).label;
      for (const approverId of notifyApproverIds) {
        if (approverId === currentUser.userId) continue;
        await createNotification({
          userId: approverId, projectId,
          type: 'approval_request',
          title: `[승인회수] ${taskInfo?.taskName || ''}`,
          message: `${label} 승인요청이 담당자에 의해 회수되었습니다. (${withdrawn}건)`,
          link: `/projects/${Number(projectId)}/wbs?task=${Number(taskId)}`,
        });
      }
    }

    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'deliverable_approval', changeDetail: { action: '일괄회수', taskId: Number(taskId), count: withdrawn } });
    res.json({ success: true, message: `${withdrawn}건 승인요청이 회수되었습니다.` });
  } catch (err) {
    console.error('Withdraw task error:', err);
    res.status(500).json({ success: false, message: '회수 처리 중 오류' });
  }
});

// POST /api/v1/projects/:projectId/approval/withdraw/:docId — 승인요청 회수
router.post('/withdraw/:docId', async (req: Request, res: Response) => {
  try {
    const docId = BigInt(req.params.docId);
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId as string);

    const deliverable = await prisma.deliverable.findUnique({
      where: { docId },
      select: { approvalDepth: true, status: true, uploaderId: true },
    });
    if (!deliverable) { res.status(404).json({ success: false, message: '산출물을 찾을 수 없습니다.' }); return; }

    // 현재 승인요청 중인 단계
    const targetDepth = deliverable.approvalDepth + 1;
    const approval = await prisma.deliverableApproval.findUnique({
      where: { docId_depth: { docId, depth: targetDepth } },
    });

    if (!approval || approval.status !== '승인요청') {
      res.status(400).json({ success: false, message: '회수할 수 있는 승인요청이 없습니다.' });
      return;
    }

    // 회수 대상 승인권자 기록
    const withdrawApproverId = approval.approverId;

    // 회수: 현재 승인요청 중인 단계만 '대기'로 되돌림 (이전 승인 유지)
    await prisma.deliverableApproval.update({
      where: { docId_depth: { docId, depth: targetDepth } },
      data: { status: '대기', requestedAt: null, approverId: null, processedAt: null, comment: null },
    });
    // 산출물 상태: 최초 단계(PL) 회수면 '작성완료', 그 이후는 '승인완료(단계)'
    await prisma.deliverable.update({
      where: { docId },
      data: { status: deliverable.approvalDepth === 0 ? '작성완료' : '승인완료(단계)' },
    });

    // 승인권자에게 회수 알림
    if (withdrawApproverId && withdrawApproverId !== currentUser.userId) {
      const doc = await prisma.deliverable.findUnique({ where: { docId }, select: { docName: true, taskId: true } });
      const task = doc?.taskId ? await prisma.wbsTask.findUnique({ where: { taskId: doc.taskId }, select: { taskName: true } }) : null;
      const wInfo = await getDepthInfo(projectId, targetDepth);
      await createNotification({
        userId: withdrawApproverId, projectId,
        type: 'approval_request',
        title: `[승인회수] ${doc?.docName || ''}`,
        message: `${task?.taskName || ''} — ${wInfo.label} 승인요청이 담당자에 의해 회수되었습니다.`,
        link: `/projects/${Number(projectId)}/wbs?task=${doc?.taskId ? Number(doc.taskId) : ''}`,
      });
    }

    const finalInfo = await getDepthInfo(projectId, targetDepth);
    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'deliverable_approval', targetId: docId, changeDetail: { action: '회수', depth: targetDepth } });
    res.json({ success: true, message: `${finalInfo.role} 승인요청이 회수되었습니다.` });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ success: false, message: '회수 처리 중 오류' });
  }
});

// GET /api/v1/projects/:projectId/approval/approvers/:role — 역할별 승인 대상자 목록
router.get('/approvers/:role', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const role = req.params.role;
    const members = await prisma.projectMember.findMany({
      where: { projectId, role },
      include: { user: { select: { userId: true, userName: true, department: true } } },
    });
    res.json({ success: true, data: members.map(m => ({ userId: m.user.userId, userName: m.user.userName, department: m.user.department })) });
  } catch (err) {
    console.error('Approvers list error:', err);
    res.status(500).json({ success: false, message: '승인 대상자 조회 중 오류' });
  }
});

// GET /api/v1/projects/:projectId/approval/pending — 내 승인 대기 목록 (대시보드용)
router.get('/pending', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);

    // 현재 사용자의 프로젝트 역할 확인
    const member = await prisma.projectMember.findFirst({
      where: { projectId, userId: currentUser.userId },
      select: { role: true },
    });
    const role = member?.role || '';

    // 프로젝트 결재라인에서 내 역할의 depth 조회
    const line = await getApprovalLine(projectId);
    const myStep = line.find(s => s.role === role);
    const myDepth = myStep?.depth;

    if (!myDepth || myDepth === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // 해당 depth에서 승인요청 상태인 건 조회
    const pendingApprovals = await prisma.deliverableApproval.findMany({
      where: {
        depth: myDepth,
        status: '승인요청',
        doc: { task: { projectId } },
      },
      include: {
        doc: {
          include: {
            task: { select: { taskId: true, taskName: true, wbsCode: true } },
            uploader: { select: { userName: true } },
          },
        },
      },
      orderBy: { requestedAt: 'asc' },
    });

    // 이전 depth 승인 완료 여부 포함
    const result = pendingApprovals.map(a => ({
      approvalId: Number(a.approvalId),
      docId: Number(a.docId),
      depth: a.depth,
      approverRole: a.approverRole,
      status: a.status,
      requestedAt: a.requestedAt,
      docName: a.doc.docName,
      docType: a.doc.docType,
      taskId: Number(a.doc.task.taskId),
      taskName: a.doc.task.taskName,
      wbsCode: a.doc.task.wbsCode,
      uploaderName: a.doc.uploader?.userName || '',
      currentApprovalDepth: a.doc.approvalDepth,
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Pending approvals error:', err);
    res.status(500).json({ success: false, message: '대기 목록 조회 중 오류' });
  }
});

export { getMaxActualRate };
export default router;
