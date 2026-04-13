import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { getRcPublicUrl, isRcAvailable, createRcUser, createChannel, addMemberToChannel, deleteRcUser } from '../utils/rocketchat';

const router = Router();
router.use(authenticate);

// GET /api/v1/messenger/info — RC 연결 정보 조회
router.get('/info', async (req: Request, res: Response) => {
  try {
    const cu = (req as any).user as JwtPayload;
    const dbUser = await prisma.user.findUnique({
      where: { userId: cu.userId },
      select: { rcUserId: true, rcUsername: true },
    });
    const available = await isRcAvailable();
    res.json({
      success: true,
      data: {
        url: getRcPublicUrl(),
        available,
        rcUsername: dbUser?.rcUsername || null,
        rcUserId: dbUser?.rcUserId || null,
      },
    });
  } catch (err) {
    console.error('Messenger info error:', err);
    res.status(500).json({ success: false, message: '메신저 정보 조회 실패' });
  }
});

// POST /api/v1/messenger/sync-users — 기존 사용자 일괄 동기화 (PMSAdmin 전용)
router.post('/sync-users', async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true, rcUserId: null },
      select: { userId: true, userName: true, email: true },
    });

    let synced = 0;
    for (const u of users) {
      const rcUser = await createRcUser({
        username: u.userId,
        name: u.userName,
        email: u.email || `${u.userId}@pms.local`,
        password: `Pms${u.userId}!`,
      });
      if (rcUser) {
        await prisma.user.update({
          where: { userId: u.userId },
          data: { rcUserId: rcUser._id, rcUsername: u.userId },
        });
        synced++;
      }
    }

    res.json({ success: true, message: `${synced}명 동기화 완료 (총 ${users.length}명 중)`, data: { synced, total: users.length } });
  } catch (err) {
    console.error('Messenger sync users error:', err);
    res.status(500).json({ success: false, message: '사용자 동기화 실패' });
  }
});

// POST /api/v1/messenger/sync-projects — 기존 프로젝트 채널 일괄 동기화
router.post('/sync-projects', async (req: Request, res: Response) => {
  try {
    const projects = await prisma.project.findMany({
      where: { rcChannelId: null, status: { notIn: ['종료'] } },
      select: { projectId: true, projectName: true },
    });

    let synced = 0;
    for (const p of projects) {
      const channelName = `${p.projectName}-${Number(p.projectId)}`;
      // 프로젝트 멤버 조회
      const members = await prisma.projectMember.findMany({
        where: { projectId: p.projectId },
        include: { user: { select: { rcUsername: true } } },
      });
      const memberUsernames = members.filter(m => m.user.rcUsername).map(m => m.user.rcUsername!);

      const channel = await createChannel(channelName, memberUsernames);
      if (channel) {
        await prisma.project.update({
          where: { projectId: p.projectId },
          data: { rcChannelId: channel._id, rcChannelName: channelName },
        });
        synced++;
      }
    }

    res.json({ success: true, message: `${synced}개 프로젝트 채널 동기화 완료`, data: { synced, total: projects.length } });
  } catch (err) {
    console.error('Messenger sync projects error:', err);
    res.status(500).json({ success: false, message: '프로젝트 채널 동기화 실패' });
  }
});

// POST /api/v1/messenger/cleanup-inactive — 비활성화된 사용자 및 그 DM 일괄 삭제
router.post('/cleanup-inactive', async (_req: Request, res: Response) => {
  try {
    // 1. PMS에서 비활성(삭제된) 사용자 조회
    const inactiveUsers = await prisma.user.findMany({
      where: { isActive: false, rcUserId: { not: null } },
      select: { userId: true, userName: true, rcUserId: true, rcUsername: true },
    });

    let deletedUsers = 0;
    for (const u of inactiveUsers) {
      if (u.rcUserId) {
        const ok = await deleteRcUser(u.rcUserId);
        if (ok) {
          // 삭제 성공 시 DB에서 RC 매핑 제거
          await prisma.user.update({
            where: { userId: u.userId },
            data: { rcUserId: null, rcUsername: null },
          });
          deletedUsers++;
        }
      }
    }

    res.json({
      success: true,
      message: `${deletedUsers}명의 비활성 사용자 RC 계정이 삭제되었습니다. (관련 DM 이력도 함께 삭제됨)`,
      data: { deleted: deletedUsers, total: inactiveUsers.length },
    });
  } catch (err: any) {
    console.error('Cleanup error:', err);
    res.status(500).json({ success: false, message: '정리 실패: ' + err.message });
  }
});

export default router;
