import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';
import { getProjectRole } from '../utils/projectRole';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
router.use(authenticate);

// 파일 업로드 설정
const uploadDir = path.join(process.cwd(), 'uploads', 'notices');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `notice_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB

function serialize(n: any) {
  return {
    ...n,
    noticeId: Number(n.noticeId),
    projectId: n.projectId ? Number(n.projectId) : null,
    boardId: n.boardId ? Number(n.boardId) : null,
    writerName: n.writer?.userName || null,
    attachments: n.attachments?.map((a: any) => ({
      attachId: Number(a.attachId),
      fileName: a.fileName,
      filePath: a.filePath,
      fileSize: Number(a.fileSize),
      mimeType: a.mimeType,
    })) || [],
  };
}

// ═══ 게시판 관리 ═══

// GET /api/v1/notices/boards?projectId=N — 게시판 목록
router.get('/boards', async (req: Request, res: Response) => {
  try {
    const { projectId, category } = req.query;
    if (!projectId) { res.status(400).json({ success: false, message: 'projectId 필수' }); return; }
    const where: any = { projectId: BigInt(projectId as string) };
    if (category) where.category = category;
    const boards = await prisma.noticeBoard.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: boards.map(b => ({ ...b, boardId: Number(b.boardId), projectId: Number(b.projectId) })) });
  } catch (err) {
    console.error('Board list error:', err);
    res.status(500).json({ success: false, message: '게시판 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/notices/boards — 게시판 생성
router.post('/boards', async (req: Request, res: Response) => {
  try {
    const { projectId, boardName, description, category } = req.body;
    if (!projectId || !boardName) { res.status(400).json({ success: false, message: '프로젝트와 게시판명은 필수입니다.' }); return; }
    const maxOrder = await prisma.noticeBoard.aggregate({ where: { projectId: BigInt(projectId) }, _max: { sortOrder: true } });
    const board = await prisma.noticeBoard.create({
      data: { projectId: BigInt(projectId), category: category || 'notice', boardName, description: description || null, sortOrder: (maxOrder._max.sortOrder || 0) + 1 },
    });
    res.status(201).json({ success: true, data: { ...board, boardId: Number(board.boardId), projectId: Number(board.projectId) }, message: '게시판이 생성되었습니다.' });
  } catch (err) {
    console.error('Board create error:', err);
    res.status(500).json({ success: false, message: '게시판 생성 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/notices/boards/:boardId
router.put('/boards/:boardId', async (req: Request, res: Response) => {
  try {
    const boardId = BigInt(req.params.boardId);
    const { boardName, description } = req.body;
    const data: any = {};
    if (boardName !== undefined) data.boardName = boardName;
    if (description !== undefined) data.description = description;
    const updated = await prisma.noticeBoard.update({ where: { boardId }, data });
    res.json({ success: true, data: { ...updated, boardId: Number(updated.boardId), projectId: Number(updated.projectId) }, message: '게시판이 수정되었습니다.' });
  } catch (err) {
    console.error('Board update error:', err);
    res.status(500).json({ success: false, message: '게시판 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/v1/notices/boards/:boardId
router.delete('/boards/:boardId', async (req: Request, res: Response) => {
  try {
    const boardId = BigInt(req.params.boardId);
    const count = await prisma.notice.count({ where: { boardId } });
    if (count > 0) {
      // 게시판 내 공지를 전체(boardId=null)로 이동
      await prisma.notice.updateMany({ where: { boardId }, data: { boardId: null } });
    }
    await prisma.noticeBoard.delete({ where: { boardId } });
    res.json({ success: true, message: '게시판이 삭제되었습니다. 공지는 전체 게시판으로 이동되었습니다.' });
  } catch (err) {
    console.error('Board delete error:', err);
    res.status(500).json({ success: false, message: '게시판 삭제 중 오류가 발생했습니다.' });
  }
});

// ═══ 이미지 업로드 (에디터용) ═══

// POST /api/v1/notices/upload-image — 인라인 이미지 업로드 (에디터 붙여넣기/드롭)
router.post('/upload-image', upload.single('image'), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ success: false, message: '이미지 파일이 없습니다.' }); return; }
    const url = `/uploads/notices/${req.file.filename}`;
    res.json({ success: true, data: { url } });
  } catch (err) {
    console.error('Image upload error:', err);
    res.status(500).json({ success: false, message: '이미지 업로드 중 오류가 발생했습니다.' });
  }
});

// ═══ 공지사항 CRUD ═══

// GET /api/v1/notices
router.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', size = '20', projectId, boardId, category } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const pageSize = Math.min(100, Math.max(1, parseInt(size as string)));

    const where: any = {};
    if (category) where.category = category;
    if (projectId) where.projectId = BigInt(projectId as string);
    if (boardId === 'all') {
      // 전체 게시판: 필터 없음
    } else if (boardId && boardId !== 'null') {
      where.boardId = BigInt(boardId as string);
    } else if (boardId === 'null') {
      where.boardId = null; // 미분류
    }

    const [items, totalCount] = await Promise.all([
      prisma.notice.findMany({
        where,
        include: {
          writer: { select: { userId: true, userName: true } },
          board: { select: { boardName: true } },
          attachments: true,
        },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notice.count({ where }),
    ]);

    res.json({
      success: true,
      data: items.map(serialize),
      pagination: { page: pageNum, size: pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
    });
  } catch (err) {
    console.error('Notice list error:', err);
    res.status(500).json({ success: false, message: '공지 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/notices — 공지 등록 (첨부파일 포함)
router.post('/', upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const { projectId, boardId, title, content, isPinned, category } = req.body;

    if (!title || !content) {
      res.status(400).json({ success: false, message: '제목과 내용은 필수입니다.' });
      return;
    }

    // 전체 게시판(boardId 없음)은 관리자만 등록 가능
    if (!boardId && projectId) {
      const role = await getProjectRole(currentUser.userId, BigInt(projectId), currentUser.systemRole || '');
      const isAdmin = currentUser.systemRole === 'SYS_ADMIN' || currentUser.systemRole === 'PMO' || role?.isPmsAdmin;
      if (!isAdmin) {
        res.status(403).json({ success: false, message: '전체 게시판에는 관리자만 등록할 수 있습니다.' });
        return;
      }
    }

    const item = await prisma.notice.create({
      data: {
        projectId: projectId ? BigInt(projectId) : null,
        boardId: boardId ? BigInt(boardId) : null,
        category: category || 'notice',
        title, content,
        isPinned: isPinned === 'true' || isPinned === true,
        writerId: currentUser.userId,
      },
      include: { writer: { select: { userId: true, userName: true } }, attachments: true, board: { select: { boardName: true } } },
    });

    // 첨부파일 등록
    const files = req.files as Express.Multer.File[];
    if (files?.length) {
      for (const f of files) {
        await prisma.noticeAttachment.create({
          data: {
            noticeId: item.noticeId,
            fileName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
            filePath: `/uploads/notices/${f.filename}`,
            fileSize: f.size,
            mimeType: f.mimetype,
          },
        });
      }
    }

    // 첨부 포함 재조회
    const result = await prisma.notice.findUnique({
      where: { noticeId: item.noticeId },
      include: { writer: { select: { userId: true, userName: true } }, attachments: true, board: { select: { boardName: true } } },
    });

    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'CREATE', targetType: 'notice', targetId: item.noticeId });
    res.status(201).json({ success: true, data: serialize(result), message: '공지가 등록되었습니다.' });
  } catch (err) {
    console.error('Notice create error:', err);
    res.status(500).json({ success: false, message: '공지 등록 중 오류가 발생했습니다.' });
  }
});

// PUT /api/v1/notices/:noticeId
router.put('/:noticeId', upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const noticeId = BigInt(req.params.noticeId);
    const { title, content, isPinned, boardId, removeAttachIds } = req.body;

    // 작성자 또는 관리자만 수정 가능
    const existing = await prisma.notice.findUnique({ where: { noticeId } });
    if (!existing) { res.status(404).json({ success: false, message: '공지를 찾을 수 없습니다.' }); return; }
    const isAdmin = currentUser.systemRole === 'SYS_ADMIN' || currentUser.systemRole === 'PMO';
    if (existing.writerId !== currentUser.userId && !isAdmin) {
      if (existing.projectId) {
        const role = await getProjectRole(currentUser.userId, existing.projectId, currentUser.systemRole || '');
        if (!role?.isPmsAdmin) {
          res.status(403).json({ success: false, message: '본인 작성 글만 수정할 수 있습니다.' }); return;
        }
      } else {
        res.status(403).json({ success: false, message: '본인 작성 글만 수정할 수 있습니다.' }); return;
      }
    }

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (isPinned !== undefined) data.isPinned = isPinned === 'true' || isPinned === true;
    if (boardId !== undefined) data.boardId = boardId ? BigInt(boardId) : null;

    await prisma.notice.update({ where: { noticeId }, data });

    // 삭제할 첨부파일
    if (removeAttachIds) {
      const ids = JSON.parse(removeAttachIds);
      for (const aid of ids) {
        const att = await prisma.noticeAttachment.findUnique({ where: { attachId: BigInt(aid) } });
        if (att) {
          const fullPath = path.join(process.cwd(), att.filePath);
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          await prisma.noticeAttachment.delete({ where: { attachId: BigInt(aid) } });
        }
      }
    }

    // 새 첨부파일
    const files = req.files as Express.Multer.File[];
    if (files?.length) {
      for (const f of files) {
        await prisma.noticeAttachment.create({
          data: {
            noticeId,
            fileName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
            filePath: `/uploads/notices/${f.filename}`,
            fileSize: f.size,
            mimeType: f.mimetype,
          },
        });
      }
    }

    const result = await prisma.notice.findUnique({
      where: { noticeId },
      include: { writer: { select: { userId: true, userName: true } }, attachments: true, board: { select: { boardName: true } } },
    });

    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'UPDATE', targetType: 'notice', targetId: noticeId });
    res.json({ success: true, data: serialize(result), message: '공지가 수정되었습니다.' });
  } catch (err) {
    console.error('Notice update error:', err);
    res.status(500).json({ success: false, message: '공지 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/v1/notices/:noticeId
router.delete('/:noticeId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const noticeId = BigInt(req.params.noticeId);

    // 작성자 또는 관리자만 삭제 가능
    const existing = await prisma.notice.findUnique({ where: { noticeId } });
    if (!existing) { res.status(404).json({ success: false, message: '공지를 찾을 수 없습니다.' }); return; }
    const isAdmin = currentUser.systemRole === 'SYS_ADMIN' || currentUser.systemRole === 'PMO';
    if (existing.writerId !== currentUser.userId && !isAdmin) {
      if (existing.projectId) {
        const role = await getProjectRole(currentUser.userId, existing.projectId, currentUser.systemRole || '');
        if (!role?.isPmsAdmin) {
          res.status(403).json({ success: false, message: '본인 작성 글만 삭제할 수 있습니다.' }); return;
        }
      } else {
        res.status(403).json({ success: false, message: '본인 작성 글만 삭제할 수 있습니다.' }); return;
      }
    }

    // 첨부파일 삭제
    const attachments = await prisma.noticeAttachment.findMany({ where: { noticeId } });
    for (const att of attachments) {
      const fullPath = path.join(process.cwd(), att.filePath);
      if (fs.existsSync(fullPath)) try { fs.unlinkSync(fullPath); } catch {}
    }

    await prisma.notice.delete({ where: { noticeId } });
    await writeAuditLog({ userId: currentUser.userId, ipAddress: req.ip, action: 'DELETE', targetType: 'notice', targetId: noticeId });
    res.json({ success: true, data: null, message: '공지가 삭제되었습니다.' });
  } catch (err) {
    console.error('Notice delete error:', err);
    res.status(500).json({ success: false, message: '공지 삭제 중 오류가 발생했습니다.' });
  }
});

export default router;
