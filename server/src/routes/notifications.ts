import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { sendDirectMessage } from '../utils/rocketchat';

const router = Router();
router.use(authenticate);

function serialize(r: any) {
  return JSON.parse(JSON.stringify(r, (_k, v) => typeof v === 'bigint' ? Number(v) : v));
}

// GET / — 내 알림 목록
router.get('/', async (req: Request, res: Response) => {
  try {
    const cu = (req as any).user as JwtPayload;
    const { unreadOnly, size } = req.query;
    const take = Math.min(50, parseInt(size as string) || 20);

    const where: any = { userId: cu.userId };
    if (unreadOnly === 'true') where.isRead = false;

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
      }),
      prisma.notification.count({ where: { userId: cu.userId, isRead: false } }),
    ]);

    res.json({ success: true, data: items.map(serialize), unreadCount });
  } catch (err) {
    console.error('Notification list error:', err);
    res.status(500).json({ success: false, message: '알림 조회 중 오류' });
  }
});

// GET /unread-count — 미읽음 건수만
router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const cu = (req as any).user as JwtPayload;
    const count = await prisma.notification.count({ where: { userId: cu.userId, isRead: false } });
    res.json({ success: true, data: { count } });
  } catch (err) {
    res.status(500).json({ success: false, message: '조회 오류' });
  }
});

// PUT /:notifId/read — 읽음 처리
router.put('/:notifId/read', async (req: Request, res: Response) => {
  try {
    const notifId = BigInt(req.params.notifId as string);
    await prisma.notification.update({ where: { notifId }, data: { isRead: true } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: '읽음 처리 오류' });
  }
});

// PUT /read-all — 전체 읽음
router.put('/read-all', async (req: Request, res: Response) => {
  try {
    const cu = (req as any).user as JwtPayload;
    await prisma.notification.updateMany({ where: { userId: cu.userId, isRead: false }, data: { isRead: true } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: '전체 읽음 처리 오류' });
  }
});

export default router;

// ── 알림 생성 유틸 (다른 라우트에서 호출) ──
export async function createNotification(params: {
  userId: string;
  projectId?: bigint | number;
  type: string;
  title: string;
  message?: string;
  link?: string;
}) {
  try {
    await prisma.notification.create({
      data: {
        userId: params.userId,
        projectId: params.projectId ? BigInt(params.projectId) : null,
        type: params.type,
        title: params.title,
        message: params.message || null,
        link: params.link || null,
      },
    });

    // Rocket.Chat DM 동시 발송 (비동기, 실패 무시)
    const rcUser = await prisma.user.findUnique({ where: { userId: params.userId }, select: { rcUsername: true } });
    if (rcUser?.rcUsername) {
      const rcPublicUrl = process.env.ROCKETCHAT_PUBLIC_URL?.replace(/\/+$/, '') || '';
      const pmsUrl = 'http://localhost:5174';
      const linkText = params.link ? `\n[바로가기](${pmsUrl}${params.link})` : '';
      sendDirectMessage(rcUser.rcUsername, `**${params.title}**\n${params.message || ''}${linkText}`).catch(() => {});
    }
  } catch (err) {
    console.error('Notification create failed:', err);
  }
}

export async function createNotificationBulk(userIds: string[], params: {
  projectId?: bigint | number;
  type: string;
  title: string;
  message?: string;
  link?: string;
}) {
  try {
    await prisma.notification.createMany({
      data: userIds.map(userId => ({
        userId,
        projectId: params.projectId ? BigInt(params.projectId) : null,
        type: params.type,
        title: params.title,
        message: params.message || null,
        link: params.link || null,
      })),
    });
  } catch (err) {
    console.error('Notification bulk create failed:', err);
  }
}
