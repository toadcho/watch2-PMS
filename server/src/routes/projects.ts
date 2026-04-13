import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, authorize, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';
import { createChannel, addMemberToChannel, updateRcBranding, deleteChannel, renameChannel, resetRcSiteName } from '../utils/rocketchat';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const catchphraseDir = path.join(process.cwd(), 'uploads', 'catchphrase');
if (!fs.existsSync(catchphraseDir)) fs.mkdirSync(catchphraseDir, { recursive: true });
const catchphraseStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, catchphraseDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `cp_${Date.now()}${ext}`);
  },
});
const catchphraseUpload = multer({ storage: catchphraseStorage, limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

// 사업관리번호 자동채번: PMS-YYYY-NNNN
async function generateBusinessNo(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PMS-${year}-`;

  const last = await prisma.project.findFirst({
    where: { businessNo: { startsWith: prefix } },
    orderBy: { businessNo: 'desc' },
    select: { businessNo: true },
  });

  let seq = 1;
  if (last) {
    const lastSeq = parseInt(last.businessNo.replace(prefix, ''), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// BigInt → Number 직렬화 헬퍼
function serializeProject(p: any) {
  return {
    ...p,
    projectId: Number(p.projectId),
    members: p.members?.map((m: any) => ({
      ...m,
      memberId: Number(m.memberId),
      projectId: Number(m.projectId),
      manMonth: Number(m.manMonth),
    })),
    risks: p.risks?.map((r: any) => ({
      ...r,
      riskId: Number(r.riskId),
      projectId: Number(r.projectId),
    })),
    _count: p._count,
  };
}

// GET /api/v1/projects — 프로젝트 목록
router.get('/', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const { page = '1', size = '20', keyword, status } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const pageSize = Math.min(100, Math.max(1, parseInt(size as string)));
    const skip = (pageNum - 1) * pageSize;

    const isAdmin = currentUser.systemRole === 'ADMIN' || currentUser.systemRole === 'SYS_ADMIN';

    const where: any = {};

    // 일반 사용자: 투입된 프로젝트만 조회
    if (!isAdmin) {
      const memberships = await prisma.projectMember.findMany({
        where: { userId: currentUser.userId },
        select: { projectId: true },
      });
      where.projectId = { in: memberships.map(m => m.projectId) };
    }

    if (keyword) {
      where.OR = [
        { projectName: { contains: keyword as string, mode: 'insensitive' } },
        { businessNo: { contains: keyword as string, mode: 'insensitive' } },
        { clientOrg: { contains: keyword as string, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;

    const [projects, totalCount] = await Promise.all([
      prisma.project.findMany({
        where,
        include: {
          pm: { select: { userId: true, userName: true } },
          _count: { select: { members: true, tasks: true, defects: true, risks: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.project.count({ where }),
    ]);

    res.json({
      success: true,
      data: projects.map(p => ({
        ...serializeProject(p),
        pmUserName: p.pm?.userName || null,
      })),
      pagination: { page: pageNum, size: pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
    });
  } catch (err) {
    console.error('Project list error:', err);
    res.status(500).json({ success: false, message: '프로젝트 목록 조회 중 오류가 발생했습니다.' });
  }
});

// GET /api/v1/projects/:id — 프로젝트 상세
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.id);
    const project = await prisma.project.findUnique({
      where: { projectId },
      include: {
        pm: { select: { userId: true, userName: true } },
        members: {
          include: { user: { select: { userId: true, userName: true, department: true, position: true } } },
          orderBy: { joinDate: 'asc' },
        },
        risks: { orderBy: { createdAt: 'desc' } },
        projectFiles: { orderBy: { createdAt: 'desc' } },
        _count: { select: { tasks: true, defects: true, issues: true } },
      },
    });

    if (!project) {
      res.status(404).json({ success: false, message: '프로젝트를 찾을 수 없습니다.' });
      return;
    }

    // 현재 날짜 기준 진행 중인 단계 산출
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const phases = ['분석', '설계', '구현', '시험', '이행'];
    const currentPhases: string[] = [];

    for (const phase of phases) {
      const phaseTasks = await prisma.wbsTask.findMany({
        where: { projectId, phase },
        select: { planStart: true, planEnd: true },
      });
      if (phaseTasks.length === 0) continue;

      const starts = phaseTasks.filter(t => t.planStart).map(t => new Date(t.planStart!));
      const ends = phaseTasks.filter(t => t.planEnd).map(t => new Date(t.planEnd!));
      if (starts.length === 0 || ends.length === 0) continue;

      const phaseStart = new Date(Math.min(...starts.map(d => d.getTime())));
      const phaseEnd = new Date(Math.max(...ends.map(d => d.getTime())));

      if (today >= phaseStart && today <= phaseEnd) {
        currentPhases.push(phase);
      }
    }

    res.json({
      success: true,
      data: {
        ...serializeProject(project),
        pmUserName: project.pm?.userName || null,
        currentPhases,
      },
    });
  } catch (err) {
    console.error('Project detail error:', err);
    res.status(500).json({ success: false, message: '프로젝트 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/projects — 프로젝트 생성
router.post('/', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const { projectName, startDate, endDate, description, pmsAdminUserId, clientOrg, contractors } = req.body;

    if (!projectName || !startDate || !endDate) {
      res.status(400).json({ success: false, message: '프로젝트명, 시작일, 종료일은 필수입니다.' });
      return;
    }

    const businessNo = await generateBusinessNo();

    const project = await prisma.project.create({
      data: {
        projectName,
        businessNo,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: '계획',
        phaseWeights: { '분석': 20, '설계': 20, '구현': 40, '시험': 10, '이행': 10 },
        description: description || null,
        clientOrg: clientOrg || null,
        contractors: contractors || [],
      },
    });

    // PMSAdmin 프로젝트 멤버로 자동 등록 + 자동 승인
    if (pmsAdminUserId) {
      await prisma.projectMember.create({
        data: {
          projectId: project.projectId,
          userId: pmsAdminUserId,
          role: 'PMSAdmin',
          joinDate: new Date(),
        },
      });
      // PMSAdmin 자동 승인 (isActive: true)
      await prisma.user.update({
        where: { userId: pmsAdminUserId },
        data: { isActive: true },
      });
    }

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'CREATE',
      targetType: 'project',
      targetId: project.projectId,
      changeDetail: { businessNo, projectName, pmsAdminUserId },
    });

    // Rocket.Chat 프로젝트 채널 자동 생성
    try {
      // 채널명: 프로젝트명 기반 (한글 허용), 중복 방지를 위해 projectId 접미사
      const safeName = `${project.projectName}-${Number(project.projectId)}`;
      const channelName = safeName;
      const memberUsernames: string[] = [];
      if (pmsAdminUserId) memberUsernames.push(pmsAdminUserId);
      const channel = await createChannel(channelName, memberUsernames);
      if (channel) {
        await prisma.project.update({
          where: { projectId: project.projectId },
          data: { rcChannelId: channel._id, rcChannelName: channelName },
        });
      }
    } catch {}

    res.status(201).json({
      success: true,
      data: serializeProject(project),
      message: '프로젝트가 등록되었습니다.',
    });
  } catch (err) {
    console.error('Project create error:', err);
    res.status(500).json({ success: false, message: '프로젝트 생성 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/projects/:id — 프로젝트 수정
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.id);
    const { projectName, startDate, endDate, status, clientOrg, pmUserId, description,
            phaseWeights, methodologyId, approvalEnabled, approvalThresholds } = req.body;

    const existing = await prisma.project.findUnique({ where: { projectId } });
    if (!existing) {
      res.status(404).json({ success: false, message: '프로젝트를 찾을 수 없습니다.' });
      return;
    }

    const data: any = {};
    if (projectName !== undefined) data.projectName = projectName;
    if (startDate !== undefined) data.startDate = new Date(startDate);
    if (endDate !== undefined) data.endDate = new Date(endDate);
    if (status !== undefined) data.status = status;
    if (phaseWeights !== undefined) data.phaseWeights = phaseWeights;
    if (clientOrg !== undefined) data.clientOrg = clientOrg;
    if (pmUserId !== undefined) data.pmUserId = pmUserId || null;
    if (description !== undefined) data.description = description;
    // 기본정보 확장 필드
    if (req.body.contractors !== undefined) data.contractors = req.body.contractors;
    if (req.body.projectType !== undefined) data.projectType = req.body.projectType;
    if (req.body.contractAmount !== undefined) data.contractAmount = req.body.contractAmount ? BigInt(req.body.contractAmount) : null;
    if (req.body.inspectionDate !== undefined) data.inspectionDate = req.body.inspectionDate ? new Date(req.body.inspectionDate) : null;
    if (req.body.clientManager !== undefined) data.clientManager = req.body.clientManager;
    if (req.body.qaManager !== undefined) data.qaManager = req.body.qaManager;
    if (req.body.auditFirm !== undefined) data.auditFirm = req.body.auditFirm;
    if (req.body.techStack !== undefined) data.techStack = req.body.techStack;
    if (req.body.note !== undefined) data.note = req.body.note;
    if (approvalEnabled !== undefined) data.approvalEnabled = approvalEnabled;
    if (approvalThresholds !== undefined) data.approvalThresholds = approvalThresholds;
    if (req.body.approvalLine !== undefined) data.approvalLine = req.body.approvalLine;
    if (methodologyId !== undefined) data.methodologyId = methodologyId ? BigInt(methodologyId) : null;
    if (req.body.devProgressEnabled !== undefined) data.devProgressEnabled = req.body.devProgressEnabled;
    if (req.body.docFolderLockEnabled !== undefined) data.docFolderLockEnabled = req.body.docFolderLockEnabled;
    if (req.body.themeConfig !== undefined) data.themeConfig = req.body.themeConfig;

    const updated = await prisma.project.update({
      where: { projectId },
      data,
      include: { pm: { select: { userId: true, userName: true } } },
    });

    // 테마 변경 시 RC 브랜딩 동기화
    if (req.body.themeConfig !== undefined && req.body.themeConfig) {
      const tc = req.body.themeConfig;
      updateRcBranding({
        primaryColor: tc.primaryColor,
        headerColor: tc.headerColor,
        siteName: `PMS - ${updated.projectName}`,
      }).catch(() => {});
    }

    // 프로젝트명 변경 시 RC 채널명도 동기화
    if (projectName !== undefined && updated.rcChannelId) {
      const newChannelName = `${updated.projectName}-${Number(updated.projectId)}`;
      try {
        const ok = await renameChannel(updated.rcChannelId, newChannelName);
        if (ok) {
          await prisma.project.update({
            where: { projectId },
            data: { rcChannelName: newChannelName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9가-힣_-]/g, '') },
          });
        }
      } catch {}
    }

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'UPDATE',
      targetType: 'project',
      targetId: projectId,
      changeDetail: { fields: Object.keys(data) },
    });

    res.json({
      success: true,
      data: { ...serializeProject(updated), pmUserName: updated.pm?.userName || null },
      message: '프로젝트가 수정되었습니다.',
    });
  } catch (err) {
    console.error('Project update error:', err);
    res.status(500).json({ success: false, message: '프로젝트 수정 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/projects/:id/files — 프로젝트 첨부파일 업로드
const projFileDir = path.join(process.cwd(), 'uploads', 'project-files');
if (!fs.existsSync(projFileDir)) fs.mkdirSync(projFileDir, { recursive: true });
const projFileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, projFileDir),
  filename: (_req, file, cb) => cb(null, `pf_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});
const projFileUpload = multer({ storage: projFileStorage, limits: { fileSize: 100 * 1024 * 1024 } });

router.post('/:id/files', projFileUpload.single('file'), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.id);
    const file = req.file;
    if (!file) { res.status(400).json({ success: false, message: '파일이 없습니다.' }); return; }
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const pf = await prisma.projectFile.create({
      data: {
        projectId, fileName,
        filePath: `/uploads/project-files/${file.filename}`,
        fileSize: BigInt(file.size),
        fileType: req.body.fileType || '기타',
        uploaderId: currentUser.userId,
      },
    });
    res.status(201).json({ success: true, data: JSON.parse(JSON.stringify(pf, (_k, v) => typeof v === 'bigint' ? Number(v) : v)) });
  } catch (err) {
    console.error('Project file upload error:', err);
    res.status(500).json({ success: false, message: '파일 업로드 실패' });
  }
});

router.delete('/:id/files/:fileId', async (req: Request, res: Response) => {
  try {
    const fileId = BigInt(req.params.fileId);
    const pf = await prisma.projectFile.findUnique({ where: { pfId: fileId } });
    if (!pf) { res.status(404).json({ success: false, message: '파일을 찾을 수 없습니다.' }); return; }
    const fp = path.join(process.cwd(), pf.filePath);
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
    await prisma.projectFile.delete({ where: { pfId: fileId } });
    res.json({ success: true, message: '파일이 삭제되었습니다.' });
  } catch (err) {
    console.error('Project file delete error:', err);
    res.status(500).json({ success: false, message: '파일 삭제 실패' });
  }
});

// POST /api/v1/projects/:id/catchphrase — 캐치프레이즈 이미지 업로드
router.post('/:id/catchphrase', catchphraseUpload.single('image'), async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.id);
    const file = req.file;
    if (!file) { res.status(400).json({ success: false, message: '이미지 파일이 없습니다.' }); return; }

    // 기존 이미지 삭제
    const existing = await prisma.project.findUnique({ where: { projectId }, select: { catchphraseImage: true } });
    if (existing?.catchphraseImage) {
      const oldPath = path.join(process.cwd(), existing.catchphraseImage);
      if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch {}
    }

    const imagePath = `/uploads/catchphrase/${file.filename}`;
    await prisma.project.update({ where: { projectId }, data: { catchphraseImage: imagePath } });
    res.json({ success: true, data: { catchphraseImage: imagePath }, message: '캐치프레이즈 이미지가 등록되었습니다.' });
  } catch (err) {
    console.error('Catchphrase upload error:', err);
    res.status(500).json({ success: false, message: '이미지 업로드 실패' });
  }
});

// DELETE /api/v1/projects/:id/catchphrase — 캐치프레이즈 이미지 삭제
router.delete('/:id/catchphrase', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.id);
    const existing = await prisma.project.findUnique({ where: { projectId }, select: { catchphraseImage: true } });
    if (existing?.catchphraseImage) {
      const oldPath = path.join(process.cwd(), existing.catchphraseImage);
      if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch {}
    }
    await prisma.project.update({ where: { projectId }, data: { catchphraseImage: null } });
    res.json({ success: true, message: '캐치프레이즈 이미지가 삭제되었습니다.' });
  } catch (err) {
    console.error('Catchphrase delete error:', err);
    res.status(500).json({ success: false, message: '이미지 삭제 실패' });
  }
});

// DELETE /api/v1/projects/:id — 프로젝트 완전 삭제 (cascade)
router.delete('/:id', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.id);

    const project = await prisma.project.findUnique({ where: { projectId }, select: { projectName: true, businessNo: true, rcChannelId: true } });
    if (!project) {
      res.status(404).json({ success: false, message: '프로젝트를 찾을 수 없습니다.' });
      return;
    }

    // Rocket.Chat 채널 삭제 (best-effort)
    if (project.rcChannelId) {
      try { await deleteChannel(project.rcChannelId); } catch {}
    }
    // Rocket.Chat Site_Name 초기화 (이 프로젝트가 현재 Site_Name으로 설정된 경우)
    try { await resetRcSiteName(project.projectName); } catch {}

    // Prisma schema의 onDelete: Cascade로 하위 모든 관계가 자동 삭제됨
    await prisma.project.delete({ where: { projectId } });

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'DELETE',
      targetType: 'project',
      targetId: projectId,
      changeDetail: { projectName: project.projectName, businessNo: project.businessNo },
    });

    res.json({ success: true, data: null, message: `프로젝트 "${project.projectName}"이(가) 완전히 삭제되었습니다.` });
  } catch (err) {
    console.error('Project delete error:', err);
    res.status(500).json({ success: false, message: '프로젝트 삭제 중 오류가 발생했습니다.' });
  }
});

export default router;
