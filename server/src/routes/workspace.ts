import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { getProjectRole } from '../utils/projectRole';
import { writeAuditLog } from '../utils/auditLog';
import { createNotification } from './notifications';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router({ mergeParams: true });
router.use(authenticate);

// ── Upload 설정 ──
const uploadDir = path.join(process.cwd(), 'uploads', 'workspace');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `ws_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

function pid(req: Request): bigint { return BigInt(req.params.projectId); }
function ser(r: any) { return JSON.parse(JSON.stringify(r, (_k, v) => typeof v === 'bigint' ? Number(v) : v)); }

// 현재 사용자의 팀(부서) 조회
async function getUserDept(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { userId }, select: { department: true } });
  return u?.department || '';
}

// 프로젝트 내 팀(부서) 목록 조회
async function getTeamDepts(projectId: bigint): Promise<string[]> {
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { department: true } } },
  });
  const set = new Set<string>();
  for (const m of members) {
    if (m.user?.department) set.add(m.user.department);
  }
  return Array.from(set).sort();
}

// PMS관리자 여부 확인
async function isWsAdmin(userId: string, projectId: bigint, systemRole: string): Promise<boolean> {
  if (systemRole === 'PMO') return true;
  const role = await getProjectRole(userId, projectId, systemRole);
  return role.isPmsAdmin;
}

// 팀 접근 권한 확인: 해당 팀 소속이거나 관리자
async function checkTeamAccess(userId: string, projectId: bigint, systemRole: string, teamDept: string): Promise<boolean> {
  if (await isWsAdmin(userId, projectId, systemRole)) return true;
  const dept = await getUserDept(userId);
  return dept === teamDept;
}

// ════════════════════════════════════════════════════════
//  팀 목록 (부서 목록) — 관리자: 전체, 일반: 본인 팀만
// ════════════════════════════════════════════════════════
router.get('/teams', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = pid(req);
    const admin = await isWsAdmin(currentUser.userId, projectId, currentUser.systemRole || '');
    if (admin) {
      const teams = await getTeamDepts(projectId);
      res.json({ success: true, data: teams });
    } else {
      const dept = await getUserDept(currentUser.userId);
      res.json({ success: true, data: dept ? [dept] : [] });
    }
  } catch (err) {
    console.error('WS teams error:', err);
    res.status(500).json({ success: false, message: '팀 목록 조회 실패' });
  }
});

// ════════════════════════════════════════════════════════
//  1. 팀 웹폴더
// ════════════════════════════════════════════════════════

// GET /folders?teamDept=xxx — 폴더 트리
router.get('/folders', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = pid(req);
    const teamDept = (req.query.teamDept as string) || '';
    if (!teamDept) { res.json({ success: true, data: [] }); return; }
    if (!(await checkTeamAccess(currentUser.userId, projectId, currentUser.systemRole || '', teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }

    const folders = await prisma.wsFolder.findMany({
      where: { projectId, teamDept },
      include: { files: { orderBy: { createdAt: 'desc' } } },
      orderBy: [{ sortOrder: 'asc' }, { wsFolderId: 'asc' }],
    });

    // 트리 빌드
    const map = new Map<number, any>();
    const roots: any[] = [];
    for (const f of folders) {
      const s = ser(f);
      s.children = [];
      map.set(s.wsFolderId, s);
    }
    for (const f of map.values()) {
      if (f.parentId && map.has(f.parentId)) map.get(f.parentId).children.push(f);
      else roots.push(f);
    }
    res.json({ success: true, data: roots });
  } catch (err) {
    console.error('WS folders error:', err);
    res.status(500).json({ success: false, message: '폴더 조회 실패' });
  }
});

// POST /folders — 폴더 생성
router.post('/folders', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const { teamDept, folderName, parentId } = req.body;
    if (!teamDept || !folderName) { res.status(400).json({ success: false, message: '팀과 폴더명은 필수입니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }

    const folder = await prisma.wsFolder.create({
      data: {
        projectId: pid(req), teamDept, folderName,
        parentId: parentId ? BigInt(parentId) : null,
        createdBy: currentUser.userId,
      },
    });
    res.status(201).json({ success: true, data: ser(folder), message: '폴더가 생성되었습니다.' });
  } catch (err) {
    console.error('WS folder create error:', err);
    res.status(500).json({ success: false, message: '폴더 생성 실패' });
  }
});

// PUT /folders/:folderId — 폴더명 변경
router.put('/folders/:folderId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const folderId = BigInt(req.params.folderId);
    const folder = await prisma.wsFolder.findUnique({ where: { wsFolderId: folderId } });
    if (!folder) { res.status(404).json({ success: false, message: '폴더를 찾을 수 없습니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', folder.teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }
    const { folderName } = req.body;
    const updated = await prisma.wsFolder.update({ where: { wsFolderId: folderId }, data: { folderName } });
    res.json({ success: true, data: ser(updated) });
  } catch (err) {
    console.error('WS folder update error:', err);
    res.status(500).json({ success: false, message: '폴더 수정 실패' });
  }
});

// DELETE /folders/:folderId — 폴더 삭제 (하위 파일/폴더 포함)
router.delete('/folders/:folderId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const folderId = BigInt(req.params.folderId);
    const folder = await prisma.wsFolder.findUnique({ where: { wsFolderId: folderId } });
    if (!folder) { res.status(404).json({ success: false, message: '폴더를 찾을 수 없습니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', folder.teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }
    // 하위 폴더 재귀 삭제
    async function deleteRecursive(id: bigint) {
      const children = await prisma.wsFolder.findMany({ where: { parentId: id } });
      for (const c of children) await deleteRecursive(c.wsFolderId);
      // 파일 삭제
      const files = await prisma.wsFile.findMany({ where: { wsFolderId: id } });
      for (const f of files) {
        const fp = path.join(process.cwd(), f.filePath);
        if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
      }
      await prisma.wsFile.deleteMany({ where: { wsFolderId: id } });
      await prisma.wsFolder.delete({ where: { wsFolderId: id } });
    }
    await deleteRecursive(folderId);
    res.json({ success: true, message: '폴더가 삭제되었습니다.' });
  } catch (err) {
    console.error('WS folder delete error:', err);
    res.status(500).json({ success: false, message: '폴더 삭제 실패' });
  }
});

// POST /folders/:folderId/files — 파일 업로드
router.post('/folders/:folderId/files', upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const folderId = BigInt(req.params.folderId);
    const folder = await prisma.wsFolder.findUnique({ where: { wsFolderId: folderId } });
    if (!folder) { res.status(404).json({ success: false, message: '폴더를 찾을 수 없습니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', folder.teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }
    const files = req.files as Express.Multer.File[];
    if (!files?.length) { res.status(400).json({ success: false, message: '파일이 없습니다.' }); return; }

    const created = [];
    for (const f of files) {
      const fileName = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const file = await prisma.wsFile.create({
        data: {
          wsFolderId: folderId, fileName,
          filePath: `/uploads/workspace/${f.filename}`,
          fileSize: f.size, mimeType: f.mimetype,
          uploaderId: currentUser.userId,
          uploaderName: currentUser.userName || currentUser.userId,
        },
      });
      created.push(ser(file));
    }
    res.status(201).json({ success: true, data: created, message: `${created.length}개 파일이 업로드되었습니다.` });
  } catch (err) {
    console.error('WS file upload error:', err);
    res.status(500).json({ success: false, message: '파일 업로드 실패' });
  }
});

// DELETE /files/:fileId — 파일 삭제
router.delete('/files/:fileId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const fileId = BigInt(req.params.fileId);
    const file = await prisma.wsFile.findUnique({ where: { wsFileId: fileId }, include: { folder: { select: { teamDept: true } } } });
    if (!file) { res.status(404).json({ success: false, message: '파일을 찾을 수 없습니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', file.folder.teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }
    const fp = path.join(process.cwd(), file.filePath);
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
    await prisma.wsFile.delete({ where: { wsFileId: fileId } });
    res.json({ success: true, message: '파일이 삭제되었습니다.' });
  } catch (err) {
    console.error('WS file delete error:', err);
    res.status(500).json({ success: false, message: '파일 삭제 실패' });
  }
});

// ════════════════════════════════════════════════════════
//  2. 팀 게시판
// ════════════════════════════════════════════════════════

// GET /posts?teamDept=xxx
router.get('/posts', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = pid(req);
    const teamDept = (req.query.teamDept as string) || '';
    if (teamDept && !(await checkTeamAccess(currentUser.userId, projectId, currentUser.systemRole || '', teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size as string) || 20));

    const where: any = { projectId };
    if (teamDept) where.teamDept = teamDept;

    const [items, totalCount] = await Promise.all([
      prisma.wsPost.findMany({
        where,
        include: { attachments: true },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.wsPost.count({ where }),
    ]);
    res.json({
      success: true,
      data: items.map(ser),
      pagination: { page, size, totalCount, totalPages: Math.ceil(totalCount / size) },
    });
  } catch (err) {
    console.error('WS posts error:', err);
    res.status(500).json({ success: false, message: '게시글 조회 실패' });
  }
});

// POST /posts — 게시글 등록
router.post('/posts', upload.array('files', 5), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const { teamDept, title, content, isPinned } = req.body;
    if (!teamDept || !title) { res.status(400).json({ success: false, message: '팀과 제목은 필수입니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }

    const post = await prisma.wsPost.create({
      data: {
        projectId: pid(req), teamDept, title, content: content || '',
        isPinned: isPinned === 'true' || isPinned === true,
        writerId: currentUser.userId,
        writerName: currentUser.userName || currentUser.userId,
      },
    });

    const files = req.files as Express.Multer.File[];
    if (files?.length) {
      for (const f of files) {
        await prisma.wsPostAttachment.create({
          data: {
            wsPostId: post.wsPostId,
            fileName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
            filePath: `/uploads/workspace/${f.filename}`,
            fileSize: f.size, mimeType: f.mimetype,
          },
        });
      }
    }

    const result = await prisma.wsPost.findUnique({
      where: { wsPostId: post.wsPostId },
      include: { attachments: true },
    });
    res.status(201).json({ success: true, data: ser(result), message: '게시글이 등록되었습니다.' });
  } catch (err) {
    console.error('WS post create error:', err);
    res.status(500).json({ success: false, message: '게시글 등록 실패' });
  }
});

// PUT /posts/:postId
router.put('/posts/:postId', upload.array('files', 5), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const postId = BigInt(req.params.postId);
    const { title, content, isPinned, removeAttachIds } = req.body;

    const existing = await prisma.wsPost.findUnique({ where: { wsPostId: postId } });
    if (!existing) { res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', existing.teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (isPinned !== undefined) data.isPinned = isPinned === 'true' || isPinned === true;

    await prisma.wsPost.update({ where: { wsPostId: postId }, data });

    // 삭제할 첨부
    if (removeAttachIds) {
      const ids = JSON.parse(removeAttachIds);
      for (const aid of ids) {
        const att = await prisma.wsPostAttachment.findUnique({ where: { wsAttachId: BigInt(aid) } });
        if (att) {
          const fp = path.join(process.cwd(), att.filePath);
          if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
          await prisma.wsPostAttachment.delete({ where: { wsAttachId: BigInt(aid) } });
        }
      }
    }

    // 새 첨부
    const files = req.files as Express.Multer.File[];
    if (files?.length) {
      for (const f of files) {
        await prisma.wsPostAttachment.create({
          data: {
            wsPostId: postId,
            fileName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
            filePath: `/uploads/workspace/${f.filename}`,
            fileSize: f.size, mimeType: f.mimetype,
          },
        });
      }
    }

    const result = await prisma.wsPost.findUnique({ where: { wsPostId: postId }, include: { attachments: true } });
    res.json({ success: true, data: ser(result), message: '게시글이 수정되었습니다.' });
  } catch (err) {
    console.error('WS post update error:', err);
    res.status(500).json({ success: false, message: '게시글 수정 실패' });
  }
});

// DELETE /posts/:postId
router.delete('/posts/:postId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const postId = BigInt(req.params.postId);
    const post = await prisma.wsPost.findUnique({ where: { wsPostId: postId }, include: { attachments: true } });
    if (!post) { res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', post.teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }

    for (const att of post.attachments) {
      const fp = path.join(process.cwd(), att.filePath);
      if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
    }
    await prisma.wsPost.delete({ where: { wsPostId: postId } });
    res.json({ success: true, message: '게시글이 삭제되었습니다.' });
  } catch (err) {
    console.error('WS post delete error:', err);
    res.status(500).json({ success: false, message: '게시글 삭제 실패' });
  }
});

// ════════════════════════════════════════════════════════
//  3. 팀 할일 (To-Do)
// ════════════════════════════════════════════════════════

// GET /todos?teamDept=xxx&status=xxx
router.get('/todos', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = pid(req);
    const teamDept = (req.query.teamDept as string) || '';
    if (teamDept && !(await checkTeamAccess(currentUser.userId, projectId, currentUser.systemRole || '', teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }
    const status = (req.query.status as string) || '';

    const where: any = { projectId };
    if (teamDept) where.teamDept = teamDept;
    if (status) where.status = status;

    const items = await prisma.wsTodo.findMany({
      where,
      orderBy: [{ status: 'asc' }, { priority: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ success: true, data: items.map(ser) });
  } catch (err) {
    console.error('WS todos error:', err);
    res.status(500).json({ success: false, message: '할일 조회 실패' });
  }
});

// POST /todos
router.post('/todos', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const { teamDept, title, description, priority, dueDate, assigneeId, assigneeName } = req.body;
    if (!teamDept || !title) { res.status(400).json({ success: false, message: '팀과 제목은 필수입니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }

    const todo = await prisma.wsTodo.create({
      data: {
        projectId: pid(req), teamDept, title,
        description: description || null,
        priority: priority || '보통',
        dueDate: dueDate ? new Date(dueDate) : null,
        assigneeId: assigneeId || null,
        assigneeName: assigneeName || null,
        createdBy: currentUser.userId,
      },
    });

    // 담당자에게 알림 발송 (본인이 본인에게 할당한 경우 제외)
    if (assigneeId && assigneeId !== currentUser.userId) {
      const creator = await prisma.user.findUnique({ where: { userId: currentUser.userId }, select: { userName: true } });
      const dueStr = dueDate ? ` (기한: ${new Date(dueDate).toISOString().substring(0, 10)})` : '';
      createNotification({
        userId: assigneeId, projectId: pid(req),
        type: 'todo_assign',
        title: `[할일] ${title}`,
        message: `${creator?.userName || currentUser.userId}님이 할일을 지시했습니다.${dueStr}`,
        link: `/projects/${Number(pid(req))}/workspace?team=${encodeURIComponent(teamDept)}`,
      }).catch(() => {});
    }

    res.status(201).json({ success: true, data: ser(todo), message: '할일이 등록되었습니다.' });
  } catch (err) {
    console.error('WS todo create error:', err);
    res.status(500).json({ success: false, message: '할일 등록 실패' });
  }
});

// PUT /todos/:todoId
router.put('/todos/:todoId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const todoId = BigInt(req.params.todoId);
    const existing = await prisma.wsTodo.findUnique({ where: { wsTodoId: todoId } });
    if (!existing) { res.status(404).json({ success: false, message: '할일을 찾을 수 없습니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', existing.teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }
    const { title, description, status, priority, dueDate, assigneeId, assigneeName } = req.body;

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (status !== undefined) {
      data.status = status;
      if (status === '완료') data.completedAt = new Date();
      else data.completedAt = null;
    }
    if (priority !== undefined) data.priority = priority;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (assigneeId !== undefined) data.assigneeId = assigneeId || null;
    if (assigneeName !== undefined) data.assigneeName = assigneeName || null;

    const todo = await prisma.wsTodo.update({ where: { wsTodoId: todoId }, data });
    res.json({ success: true, data: ser(todo), message: '할일이 수정되었습니다.' });
  } catch (err) {
    console.error('WS todo update error:', err);
    res.status(500).json({ success: false, message: '할일 수정 실패' });
  }
});

// DELETE /todos/:todoId
router.delete('/todos/:todoId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const todoId = BigInt(req.params.todoId);
    const existing = await prisma.wsTodo.findUnique({ where: { wsTodoId: todoId } });
    if (!existing) { res.status(404).json({ success: false, message: '할일을 찾을 수 없습니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', existing.teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }
    await prisma.wsTodo.delete({ where: { wsTodoId: todoId } });
    res.json({ success: true, message: '할일이 삭제되었습니다.' });
  } catch (err) {
    console.error('WS todo delete error:', err);
    res.status(500).json({ success: false, message: '할일 삭제 실패' });
  }
});

// ════════════════════════════════════════════════════════
//  4. 팀 메모/위키
// ════════════════════════════════════════════════════════

// GET /memos?teamDept=xxx&category=xxx
router.get('/memos', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = pid(req);
    const teamDept = (req.query.teamDept as string) || '';
    if (teamDept && !(await checkTeamAccess(currentUser.userId, projectId, currentUser.systemRole || '', teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }
    const category = (req.query.category as string) || '';

    const where: any = { projectId };
    if (teamDept) where.teamDept = teamDept;
    if (category) where.category = category;

    const items = await prisma.wsMemo.findMany({
      where,
      orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
    });
    res.json({ success: true, data: items.map(ser) });
  } catch (err) {
    console.error('WS memos error:', err);
    res.status(500).json({ success: false, message: '메모 조회 실패' });
  }
});

// GET /memos/:memoId — 단건 조회
router.get('/memos/:memoId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const memoId = BigInt(req.params.memoId);
    const memo = await prisma.wsMemo.findUnique({ where: { wsMemoId: memoId } });
    if (!memo) { res.status(404).json({ success: false, message: '메모를 찾을 수 없습니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', memo.teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }
    res.json({ success: true, data: ser(memo) });
  } catch (err) {
    console.error('WS memo detail error:', err);
    res.status(500).json({ success: false, message: '메모 조회 실패' });
  }
});

// POST /memos
router.post('/memos', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const { teamDept, title, content, category, isPinned } = req.body;
    if (!teamDept || !title) { res.status(400).json({ success: false, message: '팀과 제목은 필수입니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }

    const memo = await prisma.wsMemo.create({
      data: {
        projectId: pid(req), teamDept, title,
        content: content || '',
        category: category || '일반',
        isPinned: isPinned === true || isPinned === 'true',
        writerId: currentUser.userId,
        writerName: currentUser.userName || currentUser.userId,
      },
    });
    res.status(201).json({ success: true, data: ser(memo), message: '메모가 등록되었습니다.' });
  } catch (err) {
    console.error('WS memo create error:', err);
    res.status(500).json({ success: false, message: '메모 등록 실패' });
  }
});

// PUT /memos/:memoId
router.put('/memos/:memoId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const memoId = BigInt(req.params.memoId);
    const existing = await prisma.wsMemo.findUnique({ where: { wsMemoId: memoId } });
    if (!existing) { res.status(404).json({ success: false, message: '메모를 찾을 수 없습니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', existing.teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }
    const { title, content, category, isPinned } = req.body;

    const data: any = {
      lastEditorId: currentUser.userId,
      lastEditorName: currentUser.userName || currentUser.userId,
    };
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (category !== undefined) data.category = category;
    if (isPinned !== undefined) data.isPinned = isPinned === true || isPinned === 'true';

    const memo = await prisma.wsMemo.update({ where: { wsMemoId: memoId }, data });
    res.json({ success: true, data: ser(memo), message: '메모가 수정되었습니다.' });
  } catch (err) {
    console.error('WS memo update error:', err);
    res.status(500).json({ success: false, message: '메모 수정 실패' });
  }
});

// DELETE /memos/:memoId
router.delete('/memos/:memoId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const memoId = BigInt(req.params.memoId);
    const existing = await prisma.wsMemo.findUnique({ where: { wsMemoId: memoId } });
    if (!existing) { res.status(404).json({ success: false, message: '메모를 찾을 수 없습니다.' }); return; }
    if (!(await checkTeamAccess(currentUser.userId, pid(req), currentUser.systemRole || '', existing.teamDept))) {
      res.status(403).json({ success: false, message: '해당 팀의 워크스페이스에 접근할 수 없습니다.' }); return;
    }
    await prisma.wsMemo.delete({ where: { wsMemoId: memoId } });
    res.json({ success: true, message: '메모가 삭제되었습니다.' });
  } catch (err) {
    console.error('WS memo delete error:', err);
    res.status(500).json({ success: false, message: '메모 삭제 실패' });
  }
});

export default router;
