import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';

const router = Router({ mergeParams: true });
router.use(authenticate);

function pid(req: Request): bigint { return BigInt(req.params.projectId as string); }

function serialize(r: any) {
  return JSON.parse(JSON.stringify(r, (_k, v) => typeof v === 'bigint' ? Number(v) : v));
}

// ====================================================================
// GET / — 캘린더 데이터 (이벤트 + 마일스톤 + WBS 태스크)
// ====================================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const { year, month } = req.query;

    // 기간 필터 (year/month 파라미터)
    let startDate: Date | undefined;
    let endDate: Date | undefined;
    if (year && month) {
      const y = parseInt(year as string);
      const m = parseInt(month as string) - 1;
      startDate = new Date(y, m, 1);
      endDate = new Date(y, m + 1, 0); // 해당 월의 마지막 날
    } else if (year) {
      startDate = new Date(parseInt(year as string), 0, 1);
      endDate = new Date(parseInt(year as string), 11, 31);
    }

    // 1. 프로젝트 이벤트
    const eventWhere: any = { projectId };
    if (startDate && endDate) {
      eventWhere.eventDate = { gte: startDate, lte: endDate };
    }
    const events = await prisma.projectEvent.findMany({
      where: eventWhere,
      orderBy: { eventDate: 'asc' },
    });

    // 2. 마일스톤 (해당 월)
    const msWhere: any = { projectId };
    if (startDate && endDate) {
      msWhere.dueDate = { gte: startDate, lte: endDate };
    }
    const milestones = await prisma.milestone.findMany({
      where: msWhere,
      orderBy: { dueDate: 'asc' },
    });

    // 3. 전체 마일스톤 (타임라인용)
    const allMilestones = await prisma.milestone.findMany({
      where: { projectId },
      orderBy: { dueDate: 'asc' },
    });

    // 4. 프로젝트 기본 정보 (기간)
    const project = await prisma.project.findUnique({
      where: { projectId },
      select: { startDate: true, endDate: true, projectName: true },
    });

    res.json({
      success: true,
      data: {
        events: events.map(serialize),
        milestones: milestones.map(serialize),
        allMilestones: allMilestones.map(serialize),
        project: project ? serialize(project) : null,
      },
    });
  } catch (err) {
    console.error('Calendar data error:', err);
    res.status(500).json({ success: false, message: '캘린더 데이터 조회 중 오류' });
  }
});

// ====================================================================
// GET /events — 이벤트 목록
// ====================================================================
router.get('/events', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const events = await prisma.projectEvent.findMany({
      where: { projectId },
      orderBy: { eventDate: 'asc' },
    });
    res.json({ success: true, data: events.map(serialize) });
  } catch (err) {
    console.error('Event list error:', err);
    res.status(500).json({ success: false, message: '이벤트 조회 중 오류' });
  }
});

// ====================================================================
// POST /events — 이벤트 등록
// ====================================================================
router.post('/events', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const cu = (req as any).user as JwtPayload;
    const { title, eventType, eventDate, endDate, color, description } = req.body;

    if (!title || !eventType || !eventDate) {
      res.status(400).json({ success: false, message: 'title, eventType, eventDate는 필수입니다.' });
      return;
    }

    const event = await prisma.projectEvent.create({
      data: {
        projectId,
        title,
        eventType,
        eventDate: new Date(eventDate),
        endDate: endDate ? new Date(endDate) : null,
        color: color || null,
        description: description || null,
        createdBy: cu.userId,
      },
    });

    await writeAuditLog({
      userId: cu.userId, ipAddress: req.ip, action: 'CREATE',
      targetType: 'project_event', targetId: event.eventId,
    });

    res.status(201).json({ success: true, data: serialize(event) });
  } catch (err) {
    console.error('Event create error:', err);
    res.status(500).json({ success: false, message: '이벤트 등록 중 오류' });
  }
});

// ====================================================================
// PUT /events/:eventId — 이벤트 수정
// ====================================================================
router.put('/events/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = BigInt(req.params.eventId as string);
    const cu = (req as any).user as JwtPayload;
    const { title, eventType, eventDate, endDate, color, description } = req.body;

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (eventType !== undefined) data.eventType = eventType;
    if (eventDate !== undefined) data.eventDate = new Date(eventDate);
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
    if (color !== undefined) data.color = color;
    if (description !== undefined) data.description = description;

    const event = await prisma.projectEvent.update({ where: { eventId }, data });

    await writeAuditLog({
      userId: cu.userId, ipAddress: req.ip, action: 'UPDATE',
      targetType: 'project_event', targetId: eventId,
    });

    res.json({ success: true, data: serialize(event) });
  } catch (err) {
    console.error('Event update error:', err);
    res.status(500).json({ success: false, message: '이벤트 수정 중 오류' });
  }
});

// ====================================================================
// DELETE /events/:eventId — 이벤트 삭제
// ====================================================================
router.delete('/events/:eventId', async (req: Request, res: Response) => {
  try {
    const eventId = BigInt(req.params.eventId as string);
    const cu = (req as any).user as JwtPayload;

    await prisma.projectEvent.delete({ where: { eventId } });

    await writeAuditLog({
      userId: cu.userId, ipAddress: req.ip, action: 'DELETE',
      targetType: 'project_event', targetId: eventId,
    });

    res.json({ success: true, message: '이벤트가 삭제되었습니다.' });
  } catch (err) {
    console.error('Event delete error:', err);
    res.status(500).json({ success: false, message: '이벤트 삭제 중 오류' });
  }
});

export default router;
