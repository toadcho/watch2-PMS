import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router({ mergeParams: true });
router.use(authenticate);

const uploadDir = path.join(process.cwd(), 'uploads', 'deliverables');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB

function pid(req: Request): bigint { return BigInt(req.params.projectId as string); }
function serialize(r: any) {
  return JSON.parse(JSON.stringify(r, (_k, v) => typeof v === 'bigint' ? Number(v) : v));
}

// ====================================================================
// GET / — 폴더 트리 조회
// ====================================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const folders = await prisma.docFolder.findMany({
      where: { projectId },
      include: { files: { orderBy: { version: 'desc' } } },
      orderBy: [{ sortOrder: 'asc' }, { folderId: 'asc' }],
    });

    // 정렬 순서 정의
    const PHASE_ORDER: Record<string, number> = { '분석': 1, '설계': 2, '구현': 3, '시험': 4, '이행': 5 };
    const CAT_ORDER: Record<string, number> = { '기본정보': 1, '프로젝트 목표 및 관리정책': 2, '프로젝트 표준': 3, '프로젝트 계획': 4, '프로젝트 실행 및 통제': 5, '프로젝트 종료': 6 };

    function getRootOrder(f: any): number {
      if (f.folderType === 'methodology' && f.phase) return PHASE_ORDER[f.phase] || 99;
      if (f.folderType === 'management') return CAT_ORDER[f.folderName] || 99;
      return f.sortOrder || 99;
    }

    // 트리 구성
    const map = new Map<number, any>();
    const roots: any[] = [];
    for (const f of folders) {
      const s = serialize(f);
      s.children = [];
      map.set(s.folderId, s);
    }
    for (const f of map.values()) {
      if (f.parentId && map.has(f.parentId)) {
        map.get(f.parentId).children.push(f);
      } else {
        roots.push(f);
      }
    }

    // 루트 정렬 (단계/카테고리 순서)
    roots.sort((a, b) => getRootOrder(a) - getRootOrder(b));
    // 자식 정렬 (sortOrder → folderId)
    for (const r of roots) {
      r.children.sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.folderId - b.folderId);
    }

    res.json({ success: true, data: roots });
  } catch (err) {
    console.error('DocStorage list error:', err);
    res.status(500).json({ success: false, message: '산출물 폴더 조회 중 오류' });
  }
});

// ====================================================================
// POST /init — 테일러링 기반 폴더 자동 생성
// ====================================================================
router.post('/init', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);

    const targetType = req.body.type as string | undefined; // 'methodology' | 'management' | undefined(both)

    // force 시 해당 유형만 삭제 후 재생성
    if (req.body.force) {
      const delWhere = targetType ? { projectId, folderType: targetType } : { projectId };
      const folderIds = (await prisma.docFolder.findMany({ where: delWhere, select: { folderId: true } })).map(f => f.folderId);
      if (folderIds.length) {
        await prisma.docFile.deleteMany({ where: { folderId: { in: folderIds } } });
        await prisma.docFolder.deleteMany({ where: { folderId: { in: folderIds } } });
      }
    }

    // 테일러링에서 적용 산출물 조회
    const tailored = await prisma.projectDeliverable.findMany({
      where: { projectId, applied: true },
      include: { master: true },
      orderBy: [{ master: { phase: 'asc' } }, { master: { sortOrder: 'asc' } }],
    });

    const phases = ['분석', '설계', '구현', '시험', '이행'];
    let order = 0;

    // 방법론 산출물 폴더 생성
    const createMethodology = !targetType || targetType === 'methodology';
    const existingMethodology = await prisma.docFolder.count({ where: { projectId, folderType: 'methodology' } });
    if (createMethodology && existingMethodology === 0) {
    for (const phase of phases) {
      const phaseDocs = tailored.filter(t => t.master.phase === phase);
      if (!phaseDocs.length) continue;

      // 단계 폴더 (Parent)
      const phaseFolder = await prisma.docFolder.create({
        data: {
          projectId,
          folderName: phase,
          folderType: 'methodology',
          phase,
          sortOrder: order++,
        },
      });

      // 산출물 폴더 (Child)
      for (const td of phaseDocs) {
        await prisma.docFolder.create({
          data: {
            projectId,
            parentId: phaseFolder.folderId,
            folderName: td.projectDocName || td.master.docName,
            folderType: 'methodology',
            projDelId: td.projDelId,
            sortOrder: td.master.sortOrder || order++,
          },
        });
      }
    }

    } // end methodology

    // ── 관리 산출물 폴더 생성 ──
    const createMgmt = !targetType || targetType === 'management';
    const existingMgmt = await prisma.docFolder.count({ where: { projectId, folderType: 'management' } });
    const mgmtItems = await prisma.managementDeliverable.findMany({
      where: { projectId, applied: true },
      orderBy: { sortOrder: 'asc' },
    });

    const mgmtCategories = [...new Set(mgmtItems.map(m => m.category))];
    if (createMgmt && existingMgmt === 0) {
    for (const cat of mgmtCategories) {
      const catDocs = mgmtItems.filter(m => m.category === cat);
      if (!catDocs.length) continue;

      const catFolder = await prisma.docFolder.create({
        data: { projectId, folderName: cat, folderType: 'management', sortOrder: order++ },
      });

      for (const md of catDocs) {
        await prisma.docFolder.create({
          data: {
            projectId,
            parentId: catFolder.folderId,
            folderName: md.docName,
            folderType: 'management',
            sortOrder: md.sortOrder || order++,
          },
        });
      }
    }

    } // end if existingMgmt === 0

    const totalFolders = await prisma.docFolder.count({ where: { projectId } });
    const newMethodology = existingMethodology === 0 ? await prisma.docFolder.count({ where: { projectId, folderType: 'methodology' } }) : 0;
    const newMgmt = existingMgmt === 0 ? await prisma.docFolder.count({ where: { projectId, folderType: 'management' } }) : 0;

    let msg = `총 ${totalFolders}개 폴더.`;
    if (newMethodology) msg += ` 방법론 산출물 ${newMethodology}개 생성.`;
    if (newMgmt) msg += ` 관리 산출물 ${newMgmt}개 생성.`;
    if (!newMethodology && !newMgmt) msg = '모든 폴더가 이미 생성되어 있습니다.';

    res.json({ success: true, message: msg, data: { count: totalFolders } });
  } catch (err) {
    console.error('DocStorage init error:', err);
    res.status(500).json({ success: false, message: '폴더 초기화 중 오류' });
  }
});

// ====================================================================
// POST /reset — 폴더 초기화 (전체 삭제)
// ====================================================================
router.post('/reset', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const targetType = req.body.type as string | undefined;

    const where: any = targetType ? { projectId, folderType: targetType } : { projectId };
    const folderIds = (await prisma.docFolder.findMany({ where, select: { folderId: true } })).map(f => f.folderId);

    let deletedFiles = 0, deletedFolders = 0;
    if (folderIds.length) {
      const fileResult = await prisma.docFile.deleteMany({ where: { folderId: { in: folderIds } } });
      deletedFiles = fileResult.count;
      // 자식 폴더 먼저 삭제 (FK 제약)
      await prisma.docFolder.deleteMany({ where: { folderId: { in: folderIds }, parentId: { not: null } } });
      await prisma.docFolder.deleteMany({ where: { folderId: { in: folderIds } } });
      deletedFolders = folderIds.length;
    }

    const typeLabel = targetType === 'management' ? '관리 산출물' : targetType === 'methodology' ? '방법론 산출물' : '전체';
    res.json({ success: true, message: `${typeLabel} 초기화 완료. 폴더 ${deletedFolders}건, 파일 ${deletedFiles}건 삭제.` });
  } catch (err) {
    console.error('DocStorage reset error:', err);
    res.status(500).json({ success: false, message: '초기화 중 오류' });
  }
});

// ====================================================================
// POST /refresh — 폴더 갱신 (파일 없는 폴더 삭제 + 신규 추가)
// ====================================================================
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const projectId = pid(req);
    const targetType = req.body.type as string | undefined;

    let deleted = 0, added = 0;

    // ── 방법론 산출물 갱신 ──
    if (!targetType || targetType === 'methodology') {
      const tailored = await prisma.projectDeliverable.findMany({
        where: { projectId, applied: true },
        include: { master: true },
      });
      const appliedNames = new Set(tailored.map(t => t.projectDocName || t.master.docName));

      // 파일 없는 기존 폴더 중 더 이상 적용 산출물에 없는 것 삭제
      const existingChildFolders = await prisma.docFolder.findMany({
        where: { projectId, folderType: 'methodology', parentId: { not: null } },
        include: { files: { select: { fileId: true } } },
      });
      for (const f of existingChildFolders) {
        if (f.files.length === 0 && !appliedNames.has(f.folderName)) {
          await prisma.docFolder.delete({ where: { folderId: f.folderId } });
          deleted++;
        }
      }

      // 빈 단계 폴더 삭제
      const phaseFolders = await prisma.docFolder.findMany({
        where: { projectId, folderType: 'methodology', parentId: null },
        include: { children: { select: { folderId: true } } },
      });
      for (const pf of phaseFolders) {
        if (pf.children.length === 0) { await prisma.docFolder.delete({ where: { folderId: pf.folderId } }); deleted++; }
      }

      // 신규 산출물 폴더 추가
      const phases = ['분석', '설계', '구현', '시험', '이행'];
      for (const phase of phases) {
        const phaseDocs = tailored.filter(t => t.master.phase === phase);
        if (!phaseDocs.length) continue;

        let phaseFolder = await prisma.docFolder.findFirst({ where: { projectId, folderType: 'methodology', phase, parentId: null } });
        if (!phaseFolder) {
          phaseFolder = await prisma.docFolder.create({ data: { projectId, folderName: phase, folderType: 'methodology', phase, sortOrder: 0 } });
          added++;
        }

        for (const td of phaseDocs) {
          const name = td.projectDocName || td.master.docName;
          const exists = await prisma.docFolder.findFirst({ where: { projectId, parentId: phaseFolder.folderId, folderName: name } });
          if (!exists) {
            await prisma.docFolder.create({ data: { projectId, parentId: phaseFolder.folderId, folderName: name, folderType: 'methodology', projDelId: td.projDelId, sortOrder: td.master.sortOrder || 0 } });
            added++;
          }
        }
      }
    }

    // ── 관리 산출물 갱신 ──
    if (!targetType || targetType === 'management') {
      const mgmtItems = await prisma.managementDeliverable.findMany({ where: { projectId, applied: true } });
      const mgmtNames = new Set(mgmtItems.map(m => m.docName));

      const existingMgmtChildren = await prisma.docFolder.findMany({
        where: { projectId, folderType: 'management', parentId: { not: null } },
        include: { files: { select: { fileId: true } } },
      });
      for (const f of existingMgmtChildren) {
        if (f.files.length === 0 && !mgmtNames.has(f.folderName)) {
          await prisma.docFolder.delete({ where: { folderId: f.folderId } });
          deleted++;
        }
      }

      // 빈 카테고리 폴더 삭제
      const catFolders = await prisma.docFolder.findMany({
        where: { projectId, folderType: 'management', parentId: null },
        include: { children: { select: { folderId: true } } },
      });
      for (const cf of catFolders) {
        if (cf.children.length === 0) { await prisma.docFolder.delete({ where: { folderId: cf.folderId } }); deleted++; }
      }

      // 신규 추가
      const mgmtCategories = [...new Set(mgmtItems.map(m => m.category))];
      for (const cat of mgmtCategories) {
        const catDocs = mgmtItems.filter(m => m.category === cat);
        if (!catDocs.length) continue;

        let catFolder = await prisma.docFolder.findFirst({ where: { projectId, folderType: 'management', folderName: cat, parentId: null } });
        if (!catFolder) {
          catFolder = await prisma.docFolder.create({ data: { projectId, folderName: cat, folderType: 'management', sortOrder: 0 } });
          added++;
        }

        for (const md of catDocs) {
          const exists = await prisma.docFolder.findFirst({ where: { projectId, parentId: catFolder.folderId, folderName: md.docName } });
          if (!exists) {
            await prisma.docFolder.create({ data: { projectId, parentId: catFolder.folderId, folderName: md.docName, folderType: 'management', sortOrder: md.sortOrder || 0 } });
            added++;
          }
        }
      }
    }

    res.json({ success: true, message: `갱신 완료. 삭제 ${deleted}건, 추가 ${added}건.` });
  } catch (err) {
    console.error('DocStorage refresh error:', err);
    res.status(500).json({ success: false, message: '폴더 갱신 중 오류' });
  }
});

// ====================================================================
// POST /:folderId/files — 파일 업로드 (다중)
// ====================================================================
router.post('/:folderId/files', upload.array('files', 20), async (req: Request, res: Response) => {
  try {
    const folderId = BigInt(req.params.folderId as string);
    const cu = (req as any).user as JwtPayload;
    const files = (req as any).files as Express.Multer.File[];
    const { description } = req.body;

    // 잠금 확인
    const folder = await prisma.docFolder.findUnique({ where: { folderId } });
    if (!folder) { res.status(404).json({ success: false, message: '폴더를 찾을 수 없습니다.' }); return; }
    if (folder.isLocked) { res.status(403).json({ success: false, message: '잠금된 폴더입니다. 파일을 업로드할 수 없습니다.' }); return; }

    if (!files?.length) { res.status(400).json({ success: false, message: '파일을 첨부하세요.' }); return; }

    const created = [];
    for (const file of files) {
      // multer가 latin1로 인코딩한 파일명을 UTF-8로 복원
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

      // 동일 파일명 존재 시 버전 증가
      const existingMax = await prisma.docFile.findFirst({
        where: { folderId, fileName: originalName },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (existingMax?.version || 0) + 1;

      const docFile = await prisma.docFile.create({
        data: {
          folderId,
          fileName: originalName,
          filePath: `/uploads/deliverables/${file.filename}`,
          fileSize: file.size,
          mimeType: file.mimetype,
          version: nextVersion,
          description: description || null,
          uploaderId: cu.userId,
          uploaderName: cu.userName,
        },
      });
      created.push(docFile);
    }

    await writeAuditLog({ userId: cu.userId, ipAddress: req.ip, action: 'CREATE', targetType: 'doc_file', changeDetail: { folderId: Number(folderId), count: created.length } });
    res.status(201).json({ success: true, data: created.map(serialize), message: `${created.length}개 파일이 업로드되었습니다.` });
  } catch (err) {
    console.error('DocStorage upload error:', err);
    res.status(500).json({ success: false, message: '파일 업로드 중 오류' });
  }
});

// ====================================================================
// DELETE /files/:fileId — 파일 삭제
// ====================================================================
router.delete('/files/:fileId', async (req: Request, res: Response) => {
  try {
    const fileId = BigInt(req.params.fileId as string);
    const cu = (req as any).user as JwtPayload;

    const file = await prisma.docFile.findUnique({ where: { fileId }, include: { folder: true } });
    if (!file) { res.status(404).json({ success: false, message: '파일을 찾을 수 없습니다.' }); return; }
    if (file.folder.isLocked) { res.status(403).json({ success: false, message: '잠금된 폴더의 파일은 삭제할 수 없습니다.' }); return; }

    // 물리 파일 삭제
    const physPath = path.join(process.cwd(), file.filePath);
    if (fs.existsSync(physPath)) fs.unlinkSync(physPath);

    await prisma.docFile.delete({ where: { fileId } });
    await writeAuditLog({ userId: cu.userId, ipAddress: req.ip, action: 'DELETE', targetType: 'doc_file', targetId: fileId });
    res.json({ success: true, message: '파일이 삭제되었습니다.' });
  } catch (err) {
    console.error('DocStorage delete error:', err);
    res.status(500).json({ success: false, message: '파일 삭제 중 오류' });
  }
});

// ====================================================================
// GET /files/:fileId/download — 파일 다운로드 (원본 파일명 유지)
// ====================================================================
router.get('/files/:fileId/download', async (req: Request, res: Response) => {
  try {
    const fileId = BigInt(req.params.fileId as string);
    const file = await prisma.docFile.findUnique({ where: { fileId } });
    if (!file) { res.status(404).json({ success: false, message: '파일을 찾을 수 없습니다.' }); return; }

    const physPath = path.join(process.cwd(), file.filePath);
    if (!fs.existsSync(physPath)) { res.status(404).json({ success: false, message: '물리 파일이 존재하지 않습니다.' }); return; }

    const encodedName = encodeURIComponent(file.fileName).replace(/%20/g, '+');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(physPath).pipe(res);
  } catch (err) {
    console.error('DocStorage download error:', err);
    res.status(500).json({ success: false, message: '파일 다운로드 중 오류' });
  }
});

// ====================================================================
// PUT /:folderId/lock — 폴더 잠금/해제 (PMS관리자)
// ====================================================================
router.put('/:folderId/lock', async (req: Request, res: Response) => {
  try {
    const folderId = BigInt(req.params.folderId as string);
    const { isLocked } = req.body;
    await prisma.docFolder.update({ where: { folderId }, data: { isLocked: !!isLocked } });
    res.json({ success: true, message: isLocked ? '폴더가 잠금되었습니다.' : '폴더 잠금이 해제되었습니다.' });
  } catch (err) {
    console.error('DocStorage lock error:', err);
    res.status(500).json({ success: false, message: '폴더 잠금 처리 중 오류' });
  }
});


export default router;
