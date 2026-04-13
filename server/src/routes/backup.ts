import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const router = Router();
router.use(authenticate);
router.use(authorize('ADMIN'));

const backupDir = path.join(process.cwd(), 'backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

// 백업 디렉토리 내 폴더 크기 재귀 계산
function dirSize(dirpath: string): number {
  let total = 0;
  try {
    for (const f of fs.readdirSync(dirpath)) {
      const stat = fs.statSync(path.join(dirpath, f));
      total += stat.isDirectory() ? dirSize(path.join(dirpath, f)) : stat.size;
    }
  } catch {}
  return total;
}

// GET /api/v1/backup/list — 백업 목록
router.get('/list', async (_req: Request, res: Response) => {
  try {
    const items = fs.readdirSync(backupDir)
      .filter(f => {
        const full = path.join(backupDir, f);
        return fs.statSync(full).isDirectory() && f.startsWith('pms_');
      })
      .map(f => {
        const full = path.join(backupDir, f);
        const stat = fs.statSync(full);
        // 세부 파일 존재 여부
        const hasDb = fs.existsSync(path.join(full, 'db.dump'));
        const hasUploads = fs.existsSync(path.join(full, 'uploads.tar.gz'));
        return {
          name: f,
          size: dirSize(full),
          createdAt: stat.mtime.toISOString(),
          hasDb,
          hasUploads,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json({ success: true, data: items });
  } catch (err) {
    console.error('Backup list error:', err);
    res.status(500).json({ success: false, message: '백업 목록 조회 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/backup/export — 전체 백업 실행 (SSE 스트리밍으로 진행상황 전송)
router.post('/export', async (req: Request, res: Response) => {
  const includeUploads = req.body.includeUploads !== false;

  // SSE 헤더 설정
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const backupName = `pms_${timestamp}`;
    const bkpPath = path.join(backupDir, backupName);
    fs.mkdirSync(bkpPath, { recursive: true });

    // 단계 1: DB 백업
    send('progress', { stage: 'db', percent: 10, message: 'DB 덤프 준비 중...' });
    const dbFile = path.join(bkpPath, 'db.dump');
    const dbHost = process.env.DB_HOST || 'db';
    const dbUser = process.env.DB_USER || 'pms_user';
    const dbName = process.env.DB_NAME || 'pms';
    const dbPwd = process.env.DB_PASSWORD || 'pms_password';
    send('progress', { stage: 'db', percent: 20, message: 'DB 덤프 실행 중...' });
    execSync(`pg_dump -h ${dbHost} -U ${dbUser} -Fc -f "${dbFile}" ${dbName}`, {
      timeout: 300000,
      env: { ...process.env, PGPASSWORD: dbPwd },
    });
    send('progress', { stage: 'db', percent: 50, message: 'DB 백업 완료' });

    // 단계 2: 업로드 파일 (옵션)
    let uploadsSize = 0;
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (includeUploads && fs.existsSync(uploadsDir)) {
      send('progress', { stage: 'uploads', percent: 55, message: '업로드 파일 압축 중... (크기에 따라 시간이 소요됩니다)' });
      const uploadsFile = path.join(bkpPath, 'uploads.tar.gz');
      execSync(`tar -czf "${uploadsFile}" -C "${path.dirname(uploadsDir)}" "${path.basename(uploadsDir)}"`, { timeout: 600000 });
      uploadsSize = fs.statSync(uploadsFile).size;
      send('progress', { stage: 'uploads', percent: 90, message: '업로드 파일 압축 완료' });
    } else {
      send('progress', { stage: 'uploads', percent: 90, message: '업로드 파일 생략' });
    }

    // 단계 3: 매니페스트
    send('progress', { stage: 'manifest', percent: 95, message: '매니페스트 생성 중...' });
    const manifest = {
      name: backupName,
      createdAt: new Date().toISOString(),
      version: '1.0',
      hasDb: true,
      hasUploads: includeUploads && uploadsSize > 0,
      dbSize: fs.statSync(dbFile).size,
      uploadsSize,
    };
    fs.writeFileSync(path.join(bkpPath, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 완료
    send('complete', { ...manifest, size: dirSize(bkpPath), message: '백업이 완료되었습니다.' });
    res.end();
  } catch (err: any) {
    console.error('Backup export error:', err.message);
    send('error', { message: `백업 실패: ${err.message}` });
    res.end();
  }
});

// GET /api/v1/backup/:name/download/:type — 백업 파일 다운로드 (db 또는 uploads)
router.get('/:name/download/:type', async (req: Request, res: Response) => {
  try {
    const { name, type } = req.params;
    if (!['db', 'uploads'].includes(type)) {
      res.status(400).json({ success: false, message: '잘못된 다운로드 타입' });
      return;
    }
    const filename = type === 'db' ? 'db.dump' : 'uploads.tar.gz';
    const filepath = path.join(backupDir, name, filename);
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ success: false, message: '파일을 찾을 수 없습니다.' });
      return;
    }
    res.download(filepath, `${name}_${filename}`);
  } catch (err) {
    console.error('Backup download error:', err);
    res.status(500).json({ success: false, message: '다운로드 중 오류가 발생했습니다.' });
  }
});

// POST /api/v1/backup/import — 백업 복원
router.post('/import', async (req: Request, res: Response) => {
  try {
    const { name, restoreUploads = false } = req.body;
    if (!name) {
      res.status(400).json({ success: false, message: '백업명은 필수입니다.' });
      return;
    }

    const bkpPath = path.join(backupDir, name);
    if (!fs.existsSync(bkpPath)) {
      res.status(404).json({ success: false, message: '백업을 찾을 수 없습니다.' });
      return;
    }

    const dbFile = path.join(bkpPath, 'db.dump');
    if (!fs.existsSync(dbFile)) {
      res.status(404).json({ success: false, message: 'DB 백업 파일이 없습니다.' });
      return;
    }

    // DB 복원
    const dbUrl = process.env.DATABASE_URL || '';
    execSync(`pg_restore "${dbUrl}" --clean --if-exists "${dbFile}"`, { timeout: 600000 });

    // 업로드 복원 (옵션)
    if (restoreUploads) {
      const uploadsFile = path.join(bkpPath, 'uploads.tar.gz');
      if (fs.existsSync(uploadsFile)) {
        execSync(`tar -xzf "${uploadsFile}" -C "${process.cwd()}"`, { timeout: 600000 });
      }
    }

    res.json({ success: true, message: '복원이 완료되었습니다. 서버를 재시작해주세요.' });
  } catch (err: any) {
    console.error('Backup import error:', err.message);
    res.status(500).json({ success: false, message: `복원 실패: ${err.message}` });
  }
});

// DELETE /api/v1/backup/:name — 백업 삭제
router.delete('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!name.startsWith('pms_')) {
      res.status(400).json({ success: false, message: '잘못된 백업명' });
      return;
    }
    const bkpPath = path.join(backupDir, name);
    if (fs.existsSync(bkpPath)) {
      fs.rmSync(bkpPath, { recursive: true, force: true });
    }
    res.json({ success: true, message: '백업이 삭제되었습니다.' });
  } catch (err) {
    console.error('Backup delete error:', err);
    res.status(500).json({ success: false, message: '삭제 중 오류가 발생했습니다.' });
  }
});

export default router;
