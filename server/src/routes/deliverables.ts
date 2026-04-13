import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';
import { getProjectRole } from '../utils/projectRole';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router({ mergeParams: true });
router.use(authenticate);

// 파일 업로드 설정
const uploadDir = path.join(process.cwd(), 'uploads', 'deliverables');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function serialize(d: any) {
  return {
    ...d,
    docId: Number(d.docId),
    taskId: Number(d.taskId),
    fileSize: Number(d.fileSize),
    uploaderName: d.uploader?.userName || null,
    taskName: d.task?.taskName || null,
    versions: d.versions?.map((v: any) => ({ ...v, versionId: Number(v.versionId), docId: Number(v.docId), fileSize: Number(v.fileSize) })),
    reviews: d.reviews?.map((r: any) => ({ ...r, reviewId: Number(r.reviewId), docId: Number(r.docId), reviewerName: r.reviewer?.userName || null })),
  };
}

// GET /api/v1/projects/:projectId/deliverables — 산출물 목록
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const { page = '1', size = '20', docType, status, auditorCheck } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const pageSize = Math.min(100, Math.max(1, parseInt(size as string)));

    // 해당 프로젝트의 task들에 속한 산출물
    const taskIds = await prisma.wbsTask.findMany({
      where: { projectId },
      select: { taskId: true },
    });
    const ids = taskIds.map(t => t.taskId);

    const where: any = { taskId: { in: ids } };
    if (docType) where.docType = docType;
    if (status) where.status = status;
    if (auditorCheck) where.auditorCheck = auditorCheck;

    const [docs, totalCount] = await Promise.all([
      prisma.deliverable.findMany({
        where,
        include: {
          uploader: { select: { userId: true, userName: true } },
          task: { select: { taskId: true, taskName: true, phase: true } },
        },
        orderBy: { uploadedAt: 'desc' },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      prisma.deliverable.count({ where }),
    ]);

    res.json({
      success: true,
      data: docs.map(serialize),
      pagination: { page: pageNum, size: pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
    });
  } catch (err) {
    console.error('Deliverable list error:', err);
    res.status(500).json({ success: false, message: '산출물 목록 조회 중 오류가 발생했습니다.' });
  }
});

// GET /api/v1/projects/:projectId/deliverables/:docId — 산출물 상세
router.get('/:docId', async (req: Request, res: Response) => {
  try {
    const docId = BigInt(req.params.docId);
    const doc = await prisma.deliverable.findUnique({
      where: { docId },
      include: {
        uploader: { select: { userId: true, userName: true } },
        task: { select: { taskId: true, taskName: true, phase: true } },
        versions: { orderBy: { versionNo: 'desc' }, include: { creator: { select: { userId: true, userName: true } } } },
        reviews: { orderBy: { reviewedAt: 'desc' }, include: { reviewer: { select: { userId: true, userName: true } } } },
      },
    });

    if (!doc) {
      res.status(404).json({ success: false, message: '산출물을 찾을 수 없습니다.' });
      return;
    }

    res.json({ success: true, data: serialize(doc) });
  } catch (err) {
    console.error('Deliverable detail error:', err);
    res.status(500).json({ success: false, message: '산출물 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/projects/:projectId/deliverables — 산출물 등록 (파일 업로드)
router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin && !roleInfo.isLeader && !roleInfo.isMember) {
      res.status(403).json({ success: false, message: '산출물 등록은 PMSAdmin, PL, TM만 가능합니다.' });
      return;
    }
    const { taskId, docType, docName } = req.body;

    if (!taskId || !docType || !docName) {
      res.status(400).json({ success: false, message: '태스크, 산출물 유형, 산출물명은 필수입니다.' });
      return;
    }

    const file = req.file;

    const doc = await prisma.deliverable.create({
      data: {
        taskId: BigInt(taskId),
        docType,
        docName,
        filePath: file ? `/uploads/deliverables/${file.filename}` : null,
        fileSize: file ? BigInt(file.size) : BigInt(0),
        uploaderId: currentUser.userId,
      },
      include: {
        uploader: { select: { userId: true, userName: true } },
        task: { select: { taskId: true, taskName: true } },
      },
    });

    // 초기 버전 v1 자동 생성
    if (file) {
      await prisma.docVersion.create({
        data: {
          docId: doc.docId,
          versionNo: 1,
          filePath: `/uploads/deliverables/${file.filename}`,
          fileSize: BigInt(file.size),
          changeDesc: '최초 등록',
          createdBy: currentUser.userId,
        },
      });
    }

    await writeAuditLog({
      userId: currentUser.userId, ipAddress: req.ip,
      action: 'CREATE', targetType: 'deliverable', targetId: doc.docId,
      changeDetail: { docName, docType },
    });

    // BigInt → Number 변환 후 응답
    const result = serialize(doc);
    res.status(201).json({ success: true, data: result, message: '산출물이 등록되었습니다.' });
  } catch (err) {
    console.error('Deliverable create error:', err);
    res.status(500).json({ success: false, message: '산출물 등록 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/projects/:projectId/deliverables/:docId — 산출물 수정 (새 버전 업로드)
router.put('/:docId', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin && !roleInfo.isLeader && !roleInfo.isMember) {
      res.status(403).json({ success: false, message: '산출물 수정은 PMSAdmin, PL, TM만 가능합니다.' });
      return;
    }
    const docId = BigInt(req.params.docId);
    const { docName, docType, status, auditorCheck, changeDesc } = req.body;
    const file = req.file;

    const existing = await prisma.deliverable.findUnique({ where: { docId } });
    if (!existing) {
      res.status(404).json({ success: false, message: '산출물을 찾을 수 없습니다.' });
      return;
    }

    const data: any = {};
    if (docName !== undefined) data.docName = docName;
    if (docType !== undefined) data.docType = docType;
    if (status !== undefined) data.status = status;
    if (auditorCheck !== undefined) data.auditorCheck = auditorCheck;

    // 새 파일 → 새 버전 자동 생성
    if (file) {
      data.filePath = `/uploads/deliverables/${file.filename}`;
      data.fileSize = BigInt(file.size);

      const lastVersion = await prisma.docVersion.findFirst({
        where: { docId },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const newVersionNo = (lastVersion?.versionNo || 0) + 1;

      await prisma.docVersion.create({
        data: {
          docId,
          versionNo: newVersionNo,
          filePath: data.filePath,
          fileSize: data.fileSize,
          changeDesc: changeDesc || `v${newVersionNo} 업로드`,
          createdBy: currentUser.userId,
        },
      });
    }

    const updated = await prisma.deliverable.update({
      where: { docId },
      data,
      include: {
        uploader: { select: { userId: true, userName: true } },
        task: { select: { taskId: true, taskName: true } },
      },
    });

    await writeAuditLog({
      userId: currentUser.userId, ipAddress: req.ip,
      action: 'UPDATE', targetType: 'deliverable', targetId: docId,
      changeDetail: { fields: Object.keys(data), hasNewFile: !!file },
    });

    res.json({ success: true, data: serialize(updated), message: '산출물이 수정되었습니다.' });
  } catch (err) {
    console.error('Deliverable update error:', err);
    res.status(500).json({ success: false, message: '산출물 수정 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/projects/:projectId/deliverables/:docId/review — 검토 등록
router.post('/:docId/review', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin && !roleInfo.isLeader) {
      res.status(403).json({ success: false, message: '산출물 검토/승인은 PMSAdmin, PL만 가능합니다.' });
      return;
    }
    const docId = BigInt(req.params.docId);
    const { result, comment } = req.body;

    if (!result) {
      res.status(400).json({ success: false, message: '검토 결과는 필수입니다.' });
      return;
    }

    const review = await prisma.review.create({
      data: {
        docId,
        reviewerId: currentUser.userId,
        result,
        comment: comment || null,
      },
      include: { reviewer: { select: { userId: true, userName: true } } },
    });

    // 승인/반려 시 산출물 상태 자동 변경
    if (result === '승인') {
      await prisma.deliverable.update({ where: { docId }, data: { status: '승인' } });
    } else if (result === '반려') {
      await prisma.deliverable.update({ where: { docId }, data: { status: '반려' } });
    }

    await writeAuditLog({
      userId: currentUser.userId, ipAddress: req.ip,
      action: 'CREATE', targetType: 'review', targetId: review.reviewId,
      changeDetail: { docId: Number(docId), result },
    });

    res.status(201).json({
      success: true,
      data: { ...review, reviewId: Number(review.reviewId), docId: Number(review.docId), reviewerName: review.reviewer.userName },
      message: '검토가 등록되었습니다.',
    });
  } catch (err) {
    console.error('Review create error:', err);
    res.status(500).json({ success: false, message: '검토 등록 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/v1/projects/:projectId/deliverables/:docId — 산출물 삭제
router.delete('/:docId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin) {
      res.status(403).json({ success: false, message: '산출물 삭제는 PMS관리자만 가능합니다.' });
      return;
    }
    const docId = BigInt(req.params.docId);

    // 관련 데이터 삭제 (버전, 검토)
    await prisma.review.deleteMany({ where: { docId } });
    await prisma.docVersion.deleteMany({ where: { docId } });
    await prisma.deliverable.delete({ where: { docId } });

    await writeAuditLog({
      userId: currentUser.userId, ipAddress: req.ip,
      action: 'DELETE', targetType: 'deliverable', targetId: docId,
    });

    res.json({ success: true, data: null, message: '산출물이 삭제되었습니다.' });
  } catch (err) {
    console.error('Deliverable delete error:', err);
    res.status(500).json({ success: false, message: '산출물 삭제 중 오류가 발생했습니다.' });
  }
});

export default router;
