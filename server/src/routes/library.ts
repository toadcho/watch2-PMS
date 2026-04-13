import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router({ mergeParams: true });
router.use(authenticate);

// 1GB 제한
const uploadDir = path.join(process.cwd(), 'uploads', 'library');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `lib_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB

function pid(req: Request): bigint { return BigInt(req.params.projectId); }
function ser(r: any) { return JSON.parse(JSON.stringify(r, (_k, v) => typeof v === 'bigint' ? Number(v) : v)); }

// GET / — 파일 목록
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const { category, keyword, page = '1', size = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const pageSize = Math.min(100, Math.max(1, parseInt(size as string)));

    const where: any = { projectId };
    if (category) where.category = category;
    if (keyword) where.OR = [
      { title: { contains: keyword as string, mode: 'insensitive' } },
      { fileName: { contains: keyword as string, mode: 'insensitive' } },
      { description: { contains: keyword as string, mode: 'insensitive' } },
    ];

    const [items, totalCount] = await Promise.all([
      prisma.libraryFile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      prisma.libraryFile.count({ where }),
    ]);

    res.json({
      success: true,
      data: items.map(ser),
      pagination: { page: pageNum, size: pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
    });
  } catch (err) {
    console.error('Library list error:', err);
    res.status(500).json({ success: false, message: '자료 조회 중 오류가 발생했습니다.' });
  }
});

// POST / — 파일 업로드
router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const file = req.file;
    if (!file) { res.status(400).json({ success: false, message: '파일이 없습니다.' }); return; }

    const { title, description, category } = req.body;
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    const item = await prisma.libraryFile.create({
      data: {
        projectId: pid(req),
        category: category || '일반',
        title: title || fileName,
        description: description || null,
        fileName,
        filePath: `/uploads/library/${file.filename}`,
        fileSize: BigInt(file.size),
        mimeType: file.mimetype,
        uploaderId: currentUser.userId,
        uploaderName: currentUser.userName || currentUser.userId,
      },
    });

    await writeAuditLog({
      userId: currentUser.userId, ipAddress: req.ip,
      action: 'CREATE', targetType: 'library_file', targetId: item.fileId,
    });

    res.status(201).json({ success: true, data: ser(item), message: '자료가 등록되었습니다.' });
  } catch (err) {
    console.error('Library upload error:', err);
    res.status(500).json({ success: false, message: '자료 등록 중 오류가 발생했습니다.' });
  }
});

// PUT /:fileId — 정보 수정 (제목/설명/분류)
router.put('/:fileId', async (req: Request, res: Response) => {
  try {
    const fileId = BigInt(req.params.fileId);
    const { title, description, category } = req.body;
    const data: any = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (category !== undefined) data.category = category;

    const updated = await prisma.libraryFile.update({ where: { fileId }, data });
    res.json({ success: true, data: ser(updated), message: '자료가 수정되었습니다.' });
  } catch (err) {
    console.error('Library update error:', err);
    res.status(500).json({ success: false, message: '자료 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /:fileId — 파일 삭제
router.delete('/:fileId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const fileId = BigInt(req.params.fileId);
    const item = await prisma.libraryFile.findUnique({ where: { fileId } });
    if (!item) { res.status(404).json({ success: false, message: '자료를 찾을 수 없습니다.' }); return; }

    // 파일 삭제
    const fullPath = path.join(process.cwd(), item.filePath);
    if (fs.existsSync(fullPath)) try { fs.unlinkSync(fullPath); } catch {}

    await prisma.libraryFile.delete({ where: { fileId } });

    await writeAuditLog({
      userId: currentUser.userId, ipAddress: req.ip,
      action: 'DELETE', targetType: 'library_file', targetId: fileId,
    });

    res.json({ success: true, message: '자료가 삭제되었습니다.' });
  } catch (err) {
    console.error('Library delete error:', err);
    res.status(500).json({ success: false, message: '자료 삭제 중 오류가 발생했습니다.' });
  }
});

// GET /:fileId/download — 다운로드 (다운로드 카운트 증가)
router.get('/:fileId/download', async (req: Request, res: Response) => {
  try {
    const fileId = BigInt(req.params.fileId);
    const item = await prisma.libraryFile.findUnique({ where: { fileId } });
    if (!item) { res.status(404).json({ success: false, message: '자료를 찾을 수 없습니다.' }); return; }

    await prisma.libraryFile.update({ where: { fileId }, data: { downloadCount: { increment: 1 } } });

    const fullPath = path.join(process.cwd(), item.filePath);
    if (!fs.existsSync(fullPath)) { res.status(404).json({ success: false, message: '파일이 존재하지 않습니다.' }); return; }

    res.download(fullPath, item.fileName);
  } catch (err) {
    console.error('Library download error:', err);
    res.status(500).json({ success: false, message: '다운로드 실패' });
  }
});

export default router;
