import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';

const router = Router({ mergeParams: true });
router.use(authenticate);

function pid(req: Request): bigint { return BigInt(req.params.projectId as string); }
function serialize(r: any) { return JSON.parse(JSON.stringify(r, (_k, v) => typeof v === 'bigint' ? Number(v) : v)); }

// GET / — 회의실 목록
router.get('/', async (req: Request, res: Response) => {
  try {
    const rooms = await prisma.meetingRoom.findMany({ where: { projectId: pid(req) }, orderBy: { roomId: 'asc' } });
    res.json({ success: true, data: rooms.map(serialize) });
  } catch (err) { res.status(500).json({ success: false, message: '회의실 조회 오류' }); }
});

// POST / — 회의실 등록
router.post('/', async (req: Request, res: Response) => {
  try {
    const { roomName, location, capacity, description } = req.body;
    const room = await prisma.meetingRoom.create({ data: { projectId: pid(req), roomName, location, capacity: capacity || 10, description } });
    res.status(201).json({ success: true, data: serialize(room) });
  } catch (err) { res.status(500).json({ success: false, message: '회의실 등록 오류' }); }
});

// DELETE /:roomId
router.delete('/:roomId', async (req: Request, res: Response) => {
  try {
    await prisma.meetingRoom.delete({ where: { roomId: BigInt(req.params.roomId as string) } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: '회의실 삭제 오류' }); }
});

// GET /bookings — 예약 목록 (월 기준)
router.get('/bookings', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const { year, month } = req.query;
    const y = parseInt(year as string) || new Date().getFullYear();
    const m = parseInt(month as string) || new Date().getMonth() + 1;
    const startDate = new Date(y, m - 1, 1);
    const endDate = new Date(y, m, 0);

    const bookings = await prisma.roomBooking.findMany({
      where: { room: { projectId }, bookingDate: { gte: startDate, lte: endDate } },
      include: { room: { select: { roomName: true } } },
      orderBy: [{ bookingDate: 'asc' }, { startTime: 'asc' }],
    });
    res.json({ success: true, data: bookings.map(serialize) });
  } catch (err) { res.status(500).json({ success: false, message: '예약 조회 오류' }); }
});

// POST /bookings — 예약 등록
router.post('/bookings', async (req: Request, res: Response) => {
  try {
    const cu = (req as any).user as JwtPayload;
    const { roomId, bookingDate, startTime, endTime, title, attendees, recurrenceType } = req.body;
    if (!roomId || !bookingDate || !startTime || !endTime || !title) {
      res.status(400).json({ success: false, message: '필수 항목을 입력하세요.' }); return;
    }
    if (endTime <= startTime) {
      res.status(400).json({ success: false, message: '종료 시간은 시작 시간보다 이후여야 합니다.' }); return;
    }

    // 반복 예약: 사업기간 내에서 주간/월간 생성
    const recurrence = (recurrenceType === 'weekly' || recurrenceType === 'monthly') ? recurrenceType : null;
    const projectId = pid(req);
    const startDateObj = new Date(bookingDate);

    // 반복 예약 생성 대상 날짜 계산
    let targetDates: Date[] = [startDateObj];
    if (recurrence) {
      const project = await prisma.project.findUnique({ where: { projectId }, select: { endDate: true } });
      if (!project) { res.status(404).json({ success: false, message: '프로젝트 정보를 찾을 수 없습니다.' }); return; }
      const projectEnd = new Date(project.endDate); projectEnd.setHours(0, 0, 0, 0);
      targetDates = [];
      const cur = new Date(startDateObj);
      while (cur <= projectEnd) {
        targetDates.push(new Date(cur));
        if (recurrence === 'weekly') cur.setDate(cur.getDate() + 7);
        else cur.setMonth(cur.getMonth() + 1);
        if (targetDates.length > 200) break; // 안전장치
      }
      if (targetDates.length === 0) {
        res.status(400).json({ success: false, message: '사업기간 내에 생성할 예약이 없습니다.' }); return;
      }
    }

    // 중복 체크 (모든 대상 날짜)
    const conflicts: string[] = [];
    for (const d of targetDates) {
      const overlap = await prisma.roomBooking.findFirst({
        where: {
          roomId: BigInt(roomId),
          bookingDate: d,
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      });
      if (overlap) conflicts.push(d.toISOString().substring(0, 10));
    }
    if (conflicts.length > 0) {
      res.status(409).json({ success: false, message: `다음 날짜에 이미 예약이 있습니다: ${conflicts.slice(0, 5).join(', ')}${conflicts.length > 5 ? ` 외 ${conflicts.length - 5}건` : ''}` });
      return;
    }

    // 반복 그룹 ID (반복 시만)
    const recurrenceGroupId = recurrence ? `rec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}` : null;

    // 일괄 생성
    await prisma.roomBooking.createMany({
      data: targetDates.map(d => ({
        roomId: BigInt(roomId),
        bookingDate: d,
        startTime, endTime, title,
        bookerId: cu.userId, bookerName: cu.userName || null,
        attendees: attendees || null,
        recurrenceGroupId,
        recurrenceType: recurrence,
      })),
    });

    const msg = recurrence
      ? `${targetDates.length}건의 ${recurrence === 'weekly' ? '주간' : '월간'} 반복 예약이 등록되었습니다.`
      : '예약되었습니다.';
    res.status(201).json({ success: true, data: { count: targetDates.length, recurrenceGroupId }, message: msg });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: '예약 등록 오류' }); }
});

// PUT /bookings/:bookingId — 예약 수정
router.put('/bookings/:bookingId', async (req: Request, res: Response) => {
  try {
    const cu = (req as any).user as JwtPayload;
    const bookingId = BigInt(req.params.bookingId as string);
    const { roomId, bookingDate, startTime, endTime, title, attendees } = req.body;

    const existing = await prisma.roomBooking.findUnique({ where: { bookingId } });
    if (!existing) { res.status(404).json({ success: false, message: '예약을 찾을 수 없습니다.' }); return; }

    // 권한: 예약자 본인 또는 PMSAdmin
    const isPmsAdmin = cu.systemRole === 'ADMIN' || cu.systemRole === 'SYS_ADMIN';
    if (!isPmsAdmin && existing.bookerId !== cu.userId) {
      const member = await prisma.projectMember.findFirst({ where: { userId: cu.userId, role: 'PMSAdmin' }, select: { memberId: true } });
      if (!member) { res.status(403).json({ success: false, message: '예약자 본인 또는 PMSAdmin만 수정 가능합니다.' }); return; }
    }

    if (!roomId || !bookingDate || !startTime || !endTime || !title) {
      res.status(400).json({ success: false, message: '필수 항목을 입력하세요.' }); return;
    }
    if (endTime <= startTime) {
      res.status(400).json({ success: false, message: '종료 시간은 시작 시간보다 이후여야 합니다.' }); return;
    }

    // 중복 체크 (자기 자신 제외)
    const overlap = await prisma.roomBooking.findFirst({
      where: {
        roomId: BigInt(roomId),
        bookingDate: new Date(bookingDate),
        bookingId: { not: bookingId },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
    });
    if (overlap) { res.status(409).json({ success: false, message: '해당 시간에 이미 예약이 있습니다.' }); return; }

    const updated = await prisma.roomBooking.update({
      where: { bookingId },
      data: {
        roomId: BigInt(roomId),
        bookingDate: new Date(bookingDate),
        startTime, endTime, title,
        attendees: attendees || null,
      },
      include: { room: { select: { roomName: true } } },
    });
    res.json({ success: true, data: serialize(updated), message: '예약이 수정되었습니다.' });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: '예약 수정 오류' }); }
});

// DELETE /bookings/:bookingId
router.delete('/bookings/:bookingId', async (req: Request, res: Response) => {
  try {
    const { deleteSeries } = req.query;
    const bookingId = BigInt(req.params.bookingId as string);
    if (deleteSeries === 'true') {
      // 반복 시리즈 전체 삭제
      const target = await prisma.roomBooking.findUnique({ where: { bookingId } });
      if (target?.recurrenceGroupId) {
        const result = await prisma.roomBooking.deleteMany({ where: { recurrenceGroupId: target.recurrenceGroupId } });
        res.json({ success: true, data: { count: result.count }, message: `${result.count}건의 반복 예약이 모두 삭제되었습니다.` });
        return;
      }
    }
    await prisma.roomBooking.delete({ where: { bookingId } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: '예약 삭제 오류' }); }
});

export default router;
