import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';

const router = Router();
router.use(authenticate);

// GET /api/v1/dashboard — 대시보드
// 시스템 관리자: 전체 프로젝트 통합 현황
// 일반 사용자: 자신이 투입된 프로젝트 현황
router.get('/', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const isAdmin = currentUser.systemRole === 'ADMIN' || currentUser.systemRole === 'SYS_ADMIN';

    // 일반 사용자: 투입된 프로젝트 ID 조회
    let myProjectIds: bigint[] = [];
    let myProject: any = null;
    if (!isAdmin) {
      const memberships = await prisma.projectMember.findMany({
        where: { userId: currentUser.userId },
        select: { projectId: true, role: true },
      });
      myProjectIds = memberships.map(m => m.projectId);

      // 투입된 프로젝트가 없으면 빈 대시보드
      if (myProjectIds.length === 0) {
        res.json({
          success: true,
          data: {
            mode: 'no-project',
            message: '투입된 프로젝트가 없습니다.',
          },
        });
        return;
      }

      // 첫 번째 프로젝트 상세 (일반 사용자는 보통 1개 프로젝트)
      myProject = await prisma.project.findUnique({
        where: { projectId: myProjectIds[0] },
        select: { projectId: true, projectName: true, businessNo: true, status: true, startDate: true, endDate: true, catchphraseImage: true },
      });
    }

    // 프로젝트 조건
    const projectWhere = isAdmin ? {} : { projectId: { in: myProjectIds } };

    // 프로젝트 현황
    const projects = await prisma.project.findMany({
      where: projectWhere,
      select: { projectId: true, projectName: true, businessNo: true, status: true },
    });
    const totalProjects = projects.length;
    const activeProjects = projects.filter(p => p.status === '진행').length;

    // 인력 현황
    const totalMembers = await prisma.projectMember.count({
      where: isAdmin ? {} : { projectId: { in: myProjectIds } },
    });

    // 결함 현황
    const defectsByStatus = await prisma.defect.groupBy({
      by: ['status'],
      where: isAdmin ? {} : { projectId: { in: myProjectIds } },
      _count: true,
    });
    const openDefects = defectsByStatus
      .filter(d => !['종료', '검증'].includes(d.status))
      .reduce((sum, d) => sum + d._count, 0);

    // 이슈 현황
    const issuesByStatus = await prisma.issue.groupBy({
      by: ['status'],
      where: isAdmin ? {} : { projectId: { in: myProjectIds } },
      _count: true,
    });
    const openIssues = issuesByStatus
      .filter(i => !['해결', '종료'].includes(i.status))
      .reduce((sum, i) => sum + i._count, 0);

    // 산출물 현황
    const deliverableWhere = isAdmin
      ? {}
      : { task: { projectId: { in: myProjectIds } } };
    const deliverables = await prisma.deliverable.groupBy({
      by: ['status'],
      where: deliverableWhere,
      _count: true,
    });
    const totalDocs = deliverables.reduce((s, d) => s + d._count, 0);
    const approvedDocs = deliverables.find(d => d.status === '승인')?._count || 0;

    // 위험 현황
    const risks = await prisma.risk.findMany({
      where: {
        status: { notIn: ['해결', '수용'] },
        ...(isAdmin ? {} : { projectId: { in: myProjectIds } }),
      },
      select: { riskId: true, riskName: true, impactLevel: true, probability: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    // 프로젝트별 진척률
    const targetProjects = isAdmin ? projects.filter(pp => pp.status === '진행') : projects;
    const projectProgress: { projectId: number; projectName: string; businessNo: string; progress: number }[] = [];
    for (const p of targetProjects) {
      const rootTasks = await prisma.wbsTask.findMany({
        where: { projectId: p.projectId, parentTaskId: null },
        select: { progressRate: true },
      });
      const avg = rootTasks.length
        ? rootTasks.reduce((s, t) => s + Number(t.progressRate), 0) / rootTasks.length
        : 0;
      projectProgress.push({
        projectId: Number(p.projectId),
        projectName: p.projectName,
        businessNo: p.businessNo,
        progress: Math.round(avg * 10) / 10,
      });
    }

    // 일반 사용자용: 전체/업무별 진척률, 내 태스크
    let businessProgress: any[] = [];
    let totalPlanProgress = 0;
    let totalActualProgress = 0;
    let myTasks: any[] = [];
    let milestones: any[] = [];
    let upcomingEvents: any[] = [];
    let notices: any[] = [];
    let pendingApprovals: any[] = [];
    let myApprovalStatus: any[] = [];
    if (!isAdmin && myProjectIds.length > 0) {
      const pid = myProjectIds[0];
      const project = await prisma.project.findUnique({ where: { projectId: pid }, select: { progressCalcMode: true } });

      // 전체 태스크 조회
      const allTasks = await prisma.wbsTask.findMany({
        where: { projectId: pid },
        select: { taskId: true, parentTaskId: true, depth: true, phase: true, planStart: true, planEnd: true, actualRate: true, assigneeId: true, wbsCode: true, taskName: true, weight: true, bizWeight: true, excludeWeight: true },
      });

      // 리프 판별
      const parentIds = new Set<number>();
      for (const t of allTasks) {
        if (t.parentTaskId) parentIds.add(Number(t.parentTaskId));
      }
      const leafTasks = allTasks.filter(t => !parentIds.has(Number(t.taskId)));

      function calcPlanProg(ps: any, pe: any): number {
        if (!ps || !pe) return 0;
        const start = new Date(ps); start.setHours(0,0,0,0);
        const end = new Date(pe); end.setHours(0,0,0,0);
        const now = new Date(); now.setHours(0,0,0,0);
        if (now < start) return 0;
        if (now >= end) return 100;
        const total = end.getTime() - start.getTime();
        if (total <= 0) return 100;
        return Math.round((now.getTime() - start.getTime()) / total * 1000) / 10;
      }

      // WBS calcAllProgress와 동일한 결과 사용 (wbs.ts의 GET /wbs?flat=true와 동일 로직)
      const { calcAllProgress } = await import('./wbs');
      const progressMap = calcAllProgress(allTasks);

      // 업무별 진행률 (depth-2)
      const depth2Tasks = allTasks.filter(t => t.depth === 2);
      for (const biz of depth2Tasks) {
        const id = Number(biz.taskId);
        const pr = progressMap.get(id);
        businessProgress.push({
          wbsCode: biz.wbsCode,
          taskName: biz.taskName,
          bizWeight: Number(biz.bizWeight || 0),
          excluded: !!(biz as any).excludeWeight,
          progress: pr?.progressRate || 0,
          actualProgress: pr?.actualRate || 0,
        });
      }

      // 전체 진척률 = 루트 태스크의 값
      const rootTask = allTasks.find(t => t.depth === 1);
      if (rootTask) {
        const rr = progressMap.get(Number(rootTask.taskId));
        if (rr) { totalPlanProgress = rr.progressRate; totalActualProgress = rr.actualRate; }
      }

      // 내 태스크: 기준일 포함 + 본인 담당 + 실적 100% 미만
      const today = new Date(); today.setHours(0,0,0,0);
      myTasks = leafTasks
        .filter(t => {
          if (t.assigneeId !== currentUser.userId) return false;
          if (Number(t.actualRate || 0) >= 100) return false;
          if (!t.planStart || !t.planEnd) return false;
          const ps = new Date(t.planStart); ps.setHours(0,0,0,0);
          const pe = new Date(t.planEnd); pe.setHours(0,0,0,0);
          return today >= ps && today <= pe;
        })
        .sort((a, b) => {
          const ae = a.planEnd ? new Date(a.planEnd).getTime() : Infinity;
          const be = b.planEnd ? new Date(b.planEnd).getTime() : Infinity;
          return ae - be;
        })
        .map(t => ({
          taskId: Number(t.taskId),
          taskName: t.taskName,
          wbsCode: t.wbsCode,
          phase: t.phase,
          planStart: t.planStart,
          planEnd: t.planEnd,
          progressRate: calcPlanProg(t.planStart, t.planEnd),
          actualRate: Number(t.actualRate || 0),
        }));

      // 마일스톤
      milestones = (await prisma.milestone.findMany({
        where: { projectId: pid },
        select: { milestoneId: true, milestoneName: true, dueDate: true, milestoneType: true, status: true },
        orderBy: { dueDate: 'asc' },
        take: 5,
      })).map(m => ({ ...m, milestoneId: Number(m.milestoneId) }));

      // 예정 이벤트 (오늘 이후, 최근 10건)
      const nowDate = new Date(); nowDate.setHours(0, 0, 0, 0);
      upcomingEvents = (await prisma.projectEvent.findMany({
        where: { projectId: pid, eventDate: { gte: nowDate } },
        orderBy: { eventDate: 'asc' },
        take: 10,
      })).map(e => ({
        eventId: Number(e.eventId),
        title: e.title,
        eventType: e.eventType,
        eventDate: e.eventDate,
        color: e.color,
        description: e.description,
      }));

      // 공지사항 (최근 5건)
      notices = (await prisma.notice.findMany({
        where: { projectId: pid },
        include: { writer: { select: { userName: true } }, board: { select: { boardName: true } } },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      })).map(n => ({
        noticeId: Number(n.noticeId),
        title: n.title,
        isPinned: n.isPinned,
        writerName: n.writer?.userName || null,
        boardId: n.boardId ? Number(n.boardId) : null,
        boardName: n.board?.boardName || null,
        createdAt: n.createdAt,
      }));

      // 승인 대기 건수
      const roleDepthMap: Record<string, number> = { 'PL': 1, 'QA': 2, 'PMO': 3, 'Customer': 4 };
      const member = await prisma.projectMember.findFirst({ where: { projectId: pid, userId: currentUser.userId }, select: { role: true } });
      const myDepth = roleDepthMap[member?.role || ''];
      if (myDepth) {
        // approverId 매칭 또는 미지정(null)
        const approvalWhere: any = { depth: myDepth, status: '승인요청', doc: { task: { projectId: pid } }, OR: [{ approverId: currentUser.userId }, { approverId: null }] };
        const rawApprovals = await prisma.deliverableApproval.findMany({
          where: approvalWhere,
          include: {
            doc: {
              include: {
                task: { select: { taskName: true, wbsCode: true, assigneeId: true } },
                uploader: { select: { userName: true } },
                approvals: {
                  orderBy: { depth: 'asc' },
                  include: { approver: { select: { userName: true } } },
                },
              },
            },
          },
          orderBy: { requestedAt: 'asc' },
          take: 10,
        });

        // 담당자 이름 조회
        const assigneeIds = [...new Set(rawApprovals.map(a => a.doc.task.assigneeId).filter(Boolean))];
        const assignees = assigneeIds.length ? await prisma.user.findMany({
          where: { userId: { in: assigneeIds as string[] } },
          select: { userId: true, userName: true },
        }) : [];
        const assigneeMap = new Map(assignees.map(u => [u.userId, u.userName]));

        pendingApprovals = rawApprovals.map(a => ({
          approvalId: Number(a.approvalId),
          docId: Number(a.docId),
          depth: a.depth,
          docName: a.doc.docName,
          taskName: a.doc.task.taskName,
          wbsCode: a.doc.task.wbsCode,
          uploaderName: a.doc.uploader?.userName || '',
          assigneeName: assigneeMap.get(a.doc.task.assigneeId || '') || '',
          approverRole: a.approverRole,
          requestedAt: a.requestedAt,
          history: a.doc.approvals.filter(h => h.depth < myDepth).map(h => ({
            depth: h.depth,
            approverRole: h.approverRole,
            status: h.status,
            approverName: h.approver?.userName || null,
            processedAt: h.processedAt,
          })),
        }));
      }

      // 내 태스크의 산출물 승인 진행 현황 (실적 100% + 종료일 완료된 태스크 제외)
      const myDeliverables = await prisma.deliverable.findMany({
        where: {
          task: {
            projectId: pid,
            assigneeId: currentUser.userId,
            NOT: { actualRate: { gte: 100 }, actualEnd: { not: null } },
          },
          status: { notIn: ['등록', '작성중'] },
        },
        include: {
          approvals: { orderBy: { depth: 'asc' }, include: { approver: { select: { userName: true } } } },
          task: { select: { taskName: true, wbsCode: true } },
        },
        orderBy: { uploadedAt: 'desc' },
        take: 10,
      });
      // 역할별 프로젝트 멤버 조회 (승인 대상자 이름 표시용)
      const roleMembers = await prisma.projectMember.findMany({
        where: { projectId: pid, role: { in: ['PL', 'QA', 'PMO', 'Customer'] } },
        include: { user: { select: { userName: true } } },
      });
      const roleMemberMap: Record<string, string[]> = {};
      for (const rm of roleMembers) {
        if (!roleMemberMap[rm.role]) roleMemberMap[rm.role] = [];
        roleMemberMap[rm.role].push(rm.user.userName);
      }

      // 사용자 부서 조회
      const currentUserInfo = await prisma.user.findUnique({ where: { userId: currentUser.userId }, select: { department: true } });
      const myDept = currentUserInfo?.department;

      // 부서별 팀장 조회
      const allLeaders = await prisma.projectMember.findMany({
        where: { projectId: pid, role: 'PL' },
        include: { user: { select: { userName: true, department: true } } },
      });
      const deptLeaderNames = allLeaders.filter(l => l.user.department === myDept).map(l => l.user.userName);

      for (const d of myDeliverables) {
        const pendingApproval = d.approvals.find(a => a.status === '승인요청');
        let pendingApproverNames: string | null = null;
        if (pendingApproval) {
          if (pendingApproval.approverRole === 'PL') {
            pendingApproverNames = deptLeaderNames.join(', ') || null;
          } else if (pendingApproval.approverId) {
            const approver = await prisma.user.findUnique({ where: { userId: pendingApproval.approverId }, select: { userName: true } });
            pendingApproverNames = approver?.userName || null;
          } else {
            pendingApproverNames = (roleMemberMap[pendingApproval.approverRole] || []).join(', ');
          }
        }

        myApprovalStatus.push({
          docId: Number(d.docId),
          docName: d.docName,
          status: d.status,
          approvalDepth: d.approvalDepth,
          taskName: d.task.taskName,
          wbsCode: d.task.wbsCode,
          pendingApproverRole: pendingApproval?.approverRole || null,
          pendingApproverNames,
          approvals: d.approvals.map(a => ({
            depth: a.depth,
            approverRole: a.approverRole,
            status: a.status,
            approverName: a.approver?.userName || null,
            processedAt: a.processedAt,
          })),
        })
      }
    }

    // 이슈/리스크 최근 항목 (프로젝트 사용자용)
    let recentIssues: any[] = [];
    let recentRisks: any[] = [];
    let myBusinessProgress: any = null;

    if (myProject) {
      const pid = myProject.projectId;
      recentIssues = (await prisma.issue.findMany({
        where: { projectId: pid, status: { notIn: ['Solved', 'Cancelled'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { issueId: true, issueTitle: true, category: true, status: true, importance: true, urgency: true, assigneeName: true, identifiedAt: true, createdAt: true },
      })).map(i => ({ ...i, issueId: Number(i.issueId) }));

      recentRisks = (await prisma.risk.findMany({
        where: { projectId: pid, status: { notIn: ['Resolved', 'Closed'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { riskId: true, riskName: true, category: true, status: true, impactLevel: true, probability: true, assigneeName: true, identifiedAt: true, createdAt: true },
      })).map(r => ({ ...r, riskId: Number(r.riskId) }));

      // 내 업무(depth=2) 진척률 — 로그인 사용자가 소속된 팀의 업무
      if (currentUser && businessProgress?.length) {
        const user = await prisma.user.findUnique({ where: { userId: currentUser.userId }, select: { department: true } });
        if (user?.department) {
          // 해당 팀의 멤버가 담당하는 태스크의 업무 찾기
          const myBiz = businessProgress.filter((b: any) => {
            // businessProgress에서 내 부서 관련 업무 찾기 (간단히 전체에서 필터)
            return true; // 모든 업무 표시, 프론트에서 선택 가능
          });
          myBusinessProgress = {
            department: user.department,
            businesses: businessProgress,
          };
        }
      }
    }

    res.json({
      success: true,
      data: {
        mode: isAdmin ? 'admin' : 'project',
        project: myProject ? {
          ...myProject,
          projectId: Number(myProject.projectId),
        } : null,
        totalProjects,
        activeProjects,
        totalMembers,
        openDefects,
        openIssues,
        deliverables: { total: totalDocs, approved: approvedDocs },
        risks: risks.map(r => ({ ...r, riskId: Number(r.riskId) })),
        projectProgress,
        defectsByStatus: defectsByStatus.map(d => ({ status: d.status, count: d._count })),
        issuesByStatus: issuesByStatus.map(i => ({ status: i.status, count: i._count })),
        // 일반 사용자 전용
        totalPlanProgress,
        totalActualProgress,
        businessProgress,
        myBusinessProgress,
        myTasks,
        milestones,
        upcomingEvents,
        notices,
        noticeBoards: await (async () => {
          try {
            const projId = myProject?.projectId;
            if (!projId) return [];
            const bs = await prisma.noticeBoard.findMany({
              where: { projectId: projId, category: 'notice' },
              orderBy: { sortOrder: 'asc' },
            });
            return bs.map(b => ({ boardId: Number(b.boardId), boardName: b.boardName }));
          } catch { return []; }
        })(),
        pendingApprovals,
        myApprovalStatus,
        recentIssues,
        recentRisks,
        todayBookings: await (async () => {
          // KST 기준 오늘 날짜(YYYY-MM-DD)
          const now = new Date();
          const tzOffset = 9 * 60 * 60 * 1000; // KST = UTC+9
          const kst = new Date(now.getTime() + tzOffset);
          const yyyy = kst.getUTCFullYear();
          const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(kst.getUTCDate()).padStart(2, '0');
          const todayStr = `${yyyy}-${mm}-${dd}`;
          // 관리자: 전체 / 일반: 투입된 모든 프로젝트의 회의실
          const roomWhere = isAdmin ? {} : { projectId: { in: myProjectIds } };
          // Raw SQL로 date 비교 (timezone 이슈 회피)
          const bookings = await prisma.$queryRawUnsafe<any[]>(
            `SELECT rb.booking_id, rb.start_time, rb.end_time, rb.title, rb.booker_name, mr.room_name, mr.project_id
             FROM room_booking rb JOIN meeting_room mr ON rb.room_id = mr.room_id
             WHERE rb.booking_date::text = $1
             ${isAdmin ? '' : `AND mr.project_id IN (${myProjectIds.map(p => p.toString()).join(',') || '0'})`}
             ORDER BY rb.start_time ASC`,
            todayStr
          );
          return bookings.map(b => ({
            bookingId: Number(b.booking_id), roomName: b.room_name,
            startTime: b.start_time, endTime: b.end_time, title: b.title, bookerName: b.booker_name,
          }));
        })(),
        unreadNotifications: await prisma.notification.findMany({
          where: { userId: currentUser.userId, isRead: false },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }).then(items => items.map(n => ({ ...n, notifId: Number(n.notifId), projectId: n.projectId ? Number(n.projectId) : null }))),
      },
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, message: '대시보드 조회 중 오류가 발생했습니다.' });
  }
});

export default router;
