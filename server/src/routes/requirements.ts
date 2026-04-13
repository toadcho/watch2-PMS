import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, JwtPayload } from '../middlewares/auth';
import { writeAuditLog } from '../utils/auditLog';
import { getProjectRole } from '../utils/projectRole';
import XLSX from 'xlsx';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router({ mergeParams: true });
router.use(authenticate);

function serialize(r: any) {
  return {
    ...r,
    requirementId: Number(r.requirementId),
    projectId: Number(r.projectId),
    histories: r.histories?.map((h: any) => ({
      ...h,
      historyId: Number(h.historyId),
      requirementId: Number(h.requirementId),
    })),
  };
}

// Baseline 후 변경불가 필드
const FROZEN_FIELDS = ['reqCode', 'reqName', 'reqDetail', 'sourceType', 'derivationPhase', 'sourceCategory', 'sourceDesc'];

// 진행상태 변경 시 사유 필수인 상태들
const REASON_REQUIRED_STATUSES = ['대체', '통합', '제외'];

// 엑셀 상수
const TEMPLATE_HEADERS = [
  '요구사항ID *', '요구사항명 *', '요구사항 내용(상세) *',
  '도출유형 *', '도출단계 *', '요구사항유형 *', '진행상태',
  '진행상태 변경사유', '중요도 *', '난이도 *', '완료예정일',
  '적용방안(검토의견)', '업무명', '기능명', '세부기능명',
  '요구사항 출처구분', '요구사항 출처상세',
  '요청자', '요청부서', '담당자', '검토자',
];
const TEMPLATE_DESC = [
  '관리자가 부여하는 고유 ID', '요구사항 제목', '요구사항 상세 설명',
  '신규/개선/현행/기타', '분석/설계/구현', '기능/비기능', '수용/대체/제외/통합 (기본: 수용)',
  '대체,제외,통합 선택 시 사유 기재', '상/중/하', '상/중/하', 'YYYY-MM-DD',
  '적용방안 또는 검토의견 기재', '업무 구분', '기능 구분', '세부 기능 구분',
  '제안요청/기술협상/회의/기타', '출처에 대한 상세 설명',
  '발주기관 요청자', '발주기관 요청부서', '사업자 담당자', '사업자 검토자',
];
const uploadDir = path.join(process.cwd(), 'uploads', 'temp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

// GET /stats — 요구사항 통계 (리스트 필터와 별개로 전체/개인 통계)
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const { userName } = req.query; // 개인 통계용

    // 전체 통계 + 필터 옵션
    const all = await prisma.requirement.findMany({
      where: { projectId },
      select: { progressStatus: true, reqType: true, isBaselined: true, assigneeName: true, business: true },
    });

    const totalCount = all.length;
    const totalByStatus: Record<string, number> = {};
    const totalByType: Record<string, number> = {};
    let totalBaselined = 0;
    let totalUnbaselined = 0;
    const businessSet = new Set<string>();
    const assigneeSet = new Set<string>();

    for (const r of all) {
      totalByStatus[r.progressStatus] = (totalByStatus[r.progressStatus] || 0) + 1;
      if (r.reqType) totalByType[r.reqType] = (totalByType[r.reqType] || 0) + 1;
      if (r.isBaselined) totalBaselined++; else totalUnbaselined++;
      if (r.business) businessSet.add(r.business);
      if (r.assigneeName) assigneeSet.add(r.assigneeName);
    }

    // 개인 통계
    let personal = null;
    if (userName) {
      const my = all.filter(r => r.assigneeName === userName);
      const myCount = my.length;
      const myByStatus: Record<string, number> = {};
      const myByType: Record<string, number> = {};
      let myBaselined = 0;
      let myUnbaselined = 0;

      for (const r of my) {
        myByStatus[r.progressStatus] = (myByStatus[r.progressStatus] || 0) + 1;
        if (r.reqType) myByType[r.reqType] = (myByType[r.reqType] || 0) + 1;
        if (r.isBaselined) myBaselined++; else myUnbaselined++;
      }

      personal = {
        userName,
        count: myCount,
        byStatus: myByStatus,
        byType: myByType,
        baselined: myBaselined,
        unbaselined: myUnbaselined,
      };
    }

    res.json({
      success: true,
      data: {
        total: {
          count: totalCount,
          byStatus: totalByStatus,
          byType: totalByType,
          baselined: totalBaselined,
          unbaselined: totalUnbaselined,
        },
        personal,
        filterOptions: {
          businesses: Array.from(businessSet).sort(),
          assignees: Array.from(assigneeSet).sort(),
        },
      },
    });
  } catch (err) {
    console.error('Requirement stats error:', err);
    res.status(500).json({ success: false, message: '통계 조회 중 오류가 발생했습니다.' });
  }
});

// GET / — 요구사항 목록
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = BigInt(req.params.projectId);
    const { progressStatus, reqType, business, assigneeName, keyword, page, size } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(size as string) || 50));

    const where: any = { projectId };
    if (progressStatus) where.progressStatus = progressStatus;
    if (reqType) where.reqType = reqType;
    if (business) where.business = business;
    if (assigneeName) where.assigneeName = assigneeName;
    if (keyword) {
      where.OR = [
        { reqCode: { contains: keyword as string, mode: 'insensitive' } },
        { reqName: { contains: keyword as string, mode: 'insensitive' } },
        { reqDetail: { contains: keyword as string, mode: 'insensitive' } },
      ];
    }

    const [items, totalCount] = await Promise.all([
      prisma.requirement.findMany({
        where,
        orderBy: { requirementId: 'asc' },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      prisma.requirement.count({ where }),
    ]);

    res.json({
      success: true,
      data: items.map(serialize),
      pagination: { page: pageNum, size: pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
    });
  } catch (err) {
    console.error('Requirement list error:', err);
    res.status(500).json({ success: false, message: '요구사항 조회 중 오류가 발생했습니다.' });
  }
});

// GET /import-template — 임포트 템플릿 다운로드 (정적 라우트, /:requirementId 앞에 위치해야 함)
router.get('/import-template', async (_req: Request, res: Response) => {
  try {
    const example = [
      'REQ-001', '사용자 인증 기능', '사용자 로그인/로그아웃 및 세션 관리 기능',
      '신규', '분석', '기능', '수용',
      '', '상', '중', '2026-06-30',
      'Spring Security 기반 구현', '인증', '로그인', '사용자 인증',
      '제안요청', '제안요청서 3.2절', '김발주', '정보화팀', '이개발', '박검토',
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      TEMPLATE_HEADERS, TEMPLATE_DESC, example, [],
      ['※ * 표시 항목은 필수 입력'],
      ['※ 도출유형: 신규, 개선, 현행, 기타'],
      ['※ 도출단계: 분석, 설계, 구현'],
      ['※ 요구사항유형: 기능, 비기능'],
      ['※ 진행상태: 수용(기본), 대체, 제외, 통합'],
      ['※ 중요도/난이도: 상, 중, 하'],
      ['※ 출처구분: 제안요청, 기술협상, 회의, 기타'],
      ['※ 날짜형식: YYYY-MM-DD'],
    ]);
    ws['!cols'] = [
      { wch: 14 }, { wch: 30 }, { wch: 50 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
      { wch: 25 }, { wch: 8 }, { wch: 8 }, { wch: 12 },
      { wch: 40 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 30 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, '요구사항');
    const dir = path.join(process.cwd(), 'uploads', 'temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, `req_template_${Date.now()}.xlsx`);
    XLSX.writeFile(wb, filepath);
    res.download(filepath, '요구사항_임포트_템플릿.xlsx', () => { try { fs.unlinkSync(filepath); } catch {} });
  } catch (err) {
    console.error('Template error:', err);
    res.status(500).json({ success: false, message: '템플릿 생성 중 오류가 발생했습니다.' });
  }
});

// GET /export — 엑셀 익스포트 (정적 라우트)
router.get('/export', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin) {
      res.status(403).json({ success: false, message: 'PMS관리자만 내보낼 수 있습니다.' });
      return;
    }
    const items = await prisma.requirement.findMany({ where: { projectId }, orderBy: { requirementId: 'asc' } });
    const fmt = (d: Date | null) => d ? d.toISOString().substring(0, 10) : '';
    const rows: any[][] = [TEMPLATE_HEADERS];
    for (const r of items) {
      rows.push([
        r.reqCode, r.reqName, r.reqDetail || '',
        r.sourceType || '', r.derivationPhase || '', r.reqType || '', r.progressStatus || '',
        r.statusChangeReason || '', r.importance || '', r.difficulty || '', fmt(r.plannedEndDate),
        r.reviewOpinion || '', r.business || '', r.funcName || '', r.subFuncName || '',
        r.sourceCategory || '', r.sourceDesc || '',
        r.requesterName || '', r.requesterDept || '', r.assigneeName || '', r.reviewerName || '',
      ]);
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 14 }, { wch: 30 }, { wch: 50 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
      { wch: 25 }, { wch: 8 }, { wch: 8 }, { wch: 12 },
      { wch: 40 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 30 },
      { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, '요구사항');
    const dir = path.join(process.cwd(), 'uploads', 'temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, `req_export_${Date.now()}.xlsx`);
    XLSX.writeFile(wb, filepath);
    res.download(filepath, `요구사항_${projectId}.xlsx`, () => { try { fs.unlinkSync(filepath); } catch {} });
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ success: false, message: '엑셀 내보내기 중 오류가 발생했습니다.' });
  }
});

// GET /:requirementId — 요구사항 상세 (이력 포함)
router.get('/:requirementId', async (req: Request, res: Response) => {
  try {
    const requirementId = BigInt(req.params.requirementId);
    const item = await prisma.requirement.findUnique({
      where: { requirementId },
      include: {
        histories: { orderBy: { changedAt: 'desc' } },
      },
    });
    if (!item) {
      res.status(404).json({ success: false, message: '요구사항을 찾을 수 없습니다.' });
      return;
    }

    // 변경이력의 changedBy → userName 매핑
    const serialized = serialize(item);
    if (serialized.histories?.length) {
      const userIds = [...new Set(serialized.histories.map((h: any) => h.changedBy))];
      const users = await prisma.user.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, userName: true },
      });
      const userMap = new Map(users.map(u => [u.userId, u.userName]));
      serialized.histories = serialized.histories.map((h: any) => ({
        ...h,
        changedByName: userMap.get(h.changedBy) || h.changedBy,
      }));
    }

    res.json({ success: true, data: serialized });
  } catch (err) {
    console.error('Requirement detail error:', err);
    res.status(500).json({ success: false, message: '요구사항 조회 중 오류가 발생했습니다.' });
  }
});

// POST / — 요구사항 등록
router.post('/', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin) {
      res.status(403).json({ success: false, message: 'PMS관리자만 등록할 수 있습니다.' });
      return;
    }

    const body = req.body;

    if (!body.reqCode || !body.reqName) {
      res.status(400).json({ success: false, message: '요구사항ID와 요구사항명은 필수입니다.' });
      return;
    }

    // 요구사항ID 중복 체크
    const existing = await prisma.requirement.findUnique({
      where: { projectId_reqCode: { projectId, reqCode: body.reqCode } },
    });
    if (existing) {
      res.status(409).json({ success: false, message: `요구사항ID '${body.reqCode}'가 이미 존재합니다.` });
      return;
    }

    // 진행상태 사유 검증
    if (REASON_REQUIRED_STATUSES.includes(body.progressStatus) && !body.statusChangeReason) {
      res.status(400).json({ success: false, message: `진행상태 '${body.progressStatus}'인 경우 변경 사유를 입력해야 합니다.` });
      return;
    }

    const item = await prisma.requirement.create({
      data: {
        projectId,
        reqCode: body.reqCode,
        reqName: body.reqName,
        reqDetail: body.reqDetail || null,
        sourceType: body.sourceType || null,
        reqType: body.reqType || null,
        progressStatus: body.progressStatus || '미분류',
        statusChangeReason: body.statusChangeReason || null,
        derivationPhase: body.derivationPhase || null,
        sourceCategory: body.sourceCategory || null,
        sourceDesc: body.sourceDesc || null,
        business: body.business || null,
        funcName: body.funcName || null,
        subFuncName: body.subFuncName || null,
        reviewOpinion: body.reviewOpinion || null,
        requesterName: body.requesterName || null,
        requesterDept: body.requesterDept || null,
        assigneeName: body.assigneeName || null,
        reviewerName: body.reviewerName || null,
        importance: body.importance || null,
        difficulty: body.difficulty || null,
        plannedEndDate: body.plannedEndDate ? new Date(body.plannedEndDate) : null,
        createdBy: currentUser.userId,
      },
    });

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'CREATE',
      targetType: 'requirement',
      targetId: item.requirementId,
      changeDetail: { reqCode: body.reqCode, reqName: body.reqName },
    });

    res.status(201).json({ success: true, data: serialize(item), message: '요구사항이 등록되었습니다.' });
  } catch (err) {
    console.error('Requirement create error:', err);
    res.status(500).json({ success: false, message: '요구사항 등록 중 오류가 발생했습니다.' });
  }
});

// PUT /:requirementId — 요구사항 수정
router.put('/:requirementId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const requirementId = BigInt(req.params.requirementId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);

    const existing = await prisma.requirement.findUnique({ where: { requirementId } });
    if (!existing) {
      res.status(404).json({ success: false, message: '요구사항을 찾을 수 없습니다.' });
      return;
    }

    // 권한 체크: PMS관리자 또는 담당자 본인
    if (!roleInfo.isPmsAdmin) {
      const user = await prisma.user.findUnique({ where: { userId: currentUser.userId }, select: { userName: true } });
      if (existing.assigneeName !== user?.userName) {
        res.status(403).json({ success: false, message: '본인 담당 요구사항만 수정할 수 있습니다.' });
        return;
      }
    }

    // Baseline 확정된 경우 수정 불가
    if (existing.isBaselined) {
      res.status(400).json({ success: false, message: '확정된 요구사항은 수정할 수 없습니다. 변경 관리를 이용해주세요.' });
      return;
    }

    const body = req.body;

    // 진행상태 사유 검증
    if (body.progressStatus && REASON_REQUIRED_STATUSES.includes(body.progressStatus) && !body.statusChangeReason) {
      res.status(400).json({ success: false, message: `진행상태 '${body.progressStatus}'인 경우 변경 사유를 입력해야 합니다.` });
      return;
    }

    const data: any = {};
    const fields = [
      'reqName', 'reqDetail', 'sourceType', 'reqType',
      'progressStatus', 'statusChangeReason', 'derivationPhase',
      'sourceCategory', 'sourceDesc',
      'business', 'funcName', 'subFuncName', 'reviewOpinion',
      'requesterName', 'requesterDept', 'assigneeName', 'reviewerName',
      'importance', 'difficulty',
    ];
    for (const f of fields) {
      if (body[f] !== undefined) data[f] = body[f] || null;
    }
    if (body.plannedEndDate !== undefined) {
      data.plannedEndDate = body.plannedEndDate ? new Date(body.plannedEndDate) : null;
    }

    const updated = await prisma.requirement.update({
      where: { requirementId },
      data,
    });

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'UPDATE',
      targetType: 'requirement',
      targetId: requirementId,
      changeDetail: { fields: Object.keys(data) },
    });

    res.json({ success: true, data: serialize(updated), message: '요구사항이 수정되었습니다.' });
  } catch (err) {
    console.error('Requirement update error:', err);
    res.status(500).json({ success: false, message: '요구사항 수정 중 오류가 발생했습니다.' });
  }
});

// DELETE /:requirementId — 요구사항 삭제
router.delete('/:requirementId', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const requirementId = BigInt(req.params.requirementId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin) {
      res.status(403).json({ success: false, message: 'PMS관리자만 삭제할 수 있습니다.' });
      return;
    }

    const existing = await prisma.requirement.findUnique({ where: { requirementId } });
    if (!existing) {
      res.status(404).json({ success: false, message: '요구사항을 찾을 수 없습니다.' });
      return;
    }

    if (existing.isBaselined) {
      res.status(400).json({ success: false, message: '확정된 요구사항은 삭제할 수 없습니다.' });
      return;
    }

    // 이력도 함께 삭제
    await prisma.requirementHistory.deleteMany({ where: { requirementId } });
    await prisma.requirement.delete({ where: { requirementId } });

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'DELETE',
      targetType: 'requirement',
      targetId: requirementId,
    });

    res.json({ success: true, data: null, message: '요구사항이 삭제되었습니다.' });
  } catch (err) {
    console.error('Requirement delete error:', err);
    res.status(500).json({ success: false, message: '요구사항 삭제 중 오류가 발생했습니다.' });
  }
});

// POST /:requirementId/baseline — Baseline 확정
router.post('/:requirementId/baseline', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const requirementId = BigInt(req.params.requirementId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin) {
      res.status(403).json({ success: false, message: 'PMS관리자만 확정할 수 있습니다.' });
      return;
    }

    const existing = await prisma.requirement.findUnique({ where: { requirementId } });
    if (!existing) {
      res.status(404).json({ success: false, message: '요구사항을 찾을 수 없습니다.' });
      return;
    }
    if (existing.isBaselined) {
      res.status(400).json({ success: false, message: '이미 확정된 요구사항입니다.' });
      return;
    }

    // 필수값 검증 (변경불가 항목 + 주요 항목)
    const missing: string[] = [];
    if (!existing.reqCode) missing.push('요구사항ID');
    if (!existing.reqName) missing.push('요구사항명');
    if (!existing.reqDetail) missing.push('요구사항 내용');
    if (!existing.sourceType) missing.push('도출유형');
    if (!existing.derivationPhase) missing.push('도출단계');
    if (!existing.sourceCategory) missing.push('요구사항 출처구분');
    if (!existing.sourceDesc) missing.push('요구사항 출처상세');
    if (!existing.reqType) missing.push('요구사항유형');
    if (!existing.importance) missing.push('중요도');
    if (!existing.difficulty) missing.push('난이도');
    if (missing.length) {
      res.status(400).json({ success: false, message: `필수항목이 누락되어 확정할 수 없습니다: ${missing.join(', ')}` });
      return;
    }

    const today = new Date(new Date().toISOString().substring(0, 10));

    const updated = await prisma.requirement.update({
      where: { requirementId },
      data: {
        isBaselined: true,
        completedAt: today,
        progressStatus: '미분류',
      },
    });

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'UPDATE',
      targetType: 'requirement',
      targetId: requirementId,
      changeDetail: { action: 'baseline', completedAt: today.toISOString() },
    });

    res.json({ success: true, data: serialize(updated), message: '요구사항이 확정되었습니다.' });
  } catch (err: any) {
    console.error('Requirement baseline error:', err);
    res.status(500).json({ success: false, message: `요구사항 확정 중 오류가 발생했습니다. ${err.message?.substring(0, 100) || ''}` });
  }
});

// POST /baseline-all — 전체 Baseline 확정
router.post('/baseline-all', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin) {
      res.status(403).json({ success: false, message: 'PMS관리자만 확정할 수 있습니다.' });
      return;
    }

    const today = new Date(new Date().toISOString().substring(0, 10));

    // 필수값 미충족 건 체크
    const candidates = await prisma.requirement.findMany({
      where: { projectId, isBaselined: false },
    });
    const validIds: bigint[] = [];
    const skippedReqs: string[] = [];
    for (const r of candidates) {
      const missing: string[] = [];
      if (!r.reqDetail) missing.push('요구사항 내용');
      if (!r.sourceType) missing.push('도출유형');
      if (!r.derivationPhase) missing.push('도출단계');
      if (!r.sourceCategory) missing.push('출처구분');
      if (!r.sourceDesc) missing.push('출처상세');
      if (!r.reqType) missing.push('요구사항유형');
      if (!r.importance) missing.push('중요도');
      if (!r.difficulty) missing.push('난이도');
      if (missing.length) {
        skippedReqs.push(`${r.reqCode}: ${missing.join(', ')} 누락`);
      } else {
        validIds.push(r.requirementId);
      }
    }

    let confirmed = 0;
    if (validIds.length) {
      const result = await prisma.requirement.updateMany({
        where: { requirementId: { in: validIds } },
        data: {
          isBaselined: true,
          completedAt: today,
          progressStatus: '미분류',
        },
      });
      confirmed = result.count;
    }

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'UPDATE',
      targetType: 'requirement',
      targetId: BigInt(0),
      changeDetail: { action: 'baseline-all', confirmed, skipped: skippedReqs.length, completedAt: today.toISOString() },
    });

    const msg = `${confirmed}건 확정 완료` + (skippedReqs.length ? `, ${skippedReqs.length}건 필수값 누락으로 제외` : '');
    res.json({ success: true, data: { confirmed, skipped: skippedReqs }, message: msg });
  } catch (err) {
    console.error('Requirement baseline-all error:', err);
    res.status(500).json({ success: false, message: '전체 확정 중 오류가 발생했습니다.' });
  }
});

// POST /:requirementId/change — Baseline 이후 변경 관리
router.post('/:requirementId/change', async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const requirementId = BigInt(req.params.requirementId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);

    const existing = await prisma.requirement.findUnique({ where: { requirementId } });
    if (!existing) {
      res.status(404).json({ success: false, message: '요구사항을 찾을 수 없습니다.' });
      return;
    }

    // 권한 체크: PMS관리자 또는 담당자 본인
    if (!roleInfo.isPmsAdmin) {
      const user = await prisma.user.findUnique({ where: { userId: currentUser.userId }, select: { userName: true } });
      if (existing.assigneeName !== user?.userName) {
        res.status(403).json({ success: false, message: '본인 담당 요구사항만 변경할 수 있습니다.' });
        return;
      }
    }

    if (!existing.isBaselined) {
      res.status(400).json({ success: false, message: '확정되지 않은 요구사항은 일반 수정을 이용해주세요.' });
      return;
    }

    const body = req.body;
    const { changeReason } = body;
    if (!changeReason) {
      res.status(400).json({ success: false, message: '변경 사유를 입력해주세요.' });
      return;
    }

    // 변경 가능한 필드만 처리 (FROZEN_FIELDS 제외)
    const mutableFields = [
      'reqType', 'progressStatus', 'statusChangeReason',
      'business', 'funcName', 'subFuncName', 'reviewOpinion',
      'requesterName', 'requesterDept', 'assigneeName', 'reviewerName',
      'importance', 'difficulty',
    ];

    // 진행상태 사유 검증
    if (body.progressStatus && REASON_REQUIRED_STATUSES.includes(body.progressStatus) && !body.statusChangeReason) {
      res.status(400).json({ success: false, message: `진행상태 '${body.progressStatus}'인 경우 변경 사유를 입력해야 합니다.` });
      return;
    }

    // 변경된 필드 추적 (null/빈문자열 통일하여 비교)
    const normalize = (v: any) => (v === null || v === undefined || v === '') ? '' : String(v);
    const changedFields: Record<string, { before: any; after: any }> = {};
    const updateData: any = {};

    for (const f of mutableFields) {
      if (body[f] !== undefined && normalize(body[f]) !== normalize((existing as any)[f])) {
        changedFields[f] = { before: (existing as any)[f] || '', after: body[f] || '' };
        updateData[f] = body[f] || null;
      }
    }

    if (Object.keys(changedFields).length === 0) {
      res.status(400).json({ success: false, message: '변경된 항목이 없습니다.' });
      return;
    }

    // 이력 생성 + 본 데이터 업데이트 (트랜잭션)
    const [history, updated] = await prisma.$transaction([
      prisma.requirementHistory.create({
        data: {
          requirementId,
          changeType: body.progressStatus && ['대체', '통합', '제외'].includes(body.progressStatus)
            ? body.progressStatus : '변경',
          changedFields,
          changeReason,
          changedBy: currentUser.userId,
        },
      }),
      prisma.requirement.update({
        where: { requirementId },
        data: updateData,
        include: { histories: { orderBy: { changedAt: 'desc' } } },
      }),
    ]);

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'UPDATE',
      targetType: 'requirement',
      targetId: requirementId,
      changeDetail: { action: 'change-after-baseline', changedFields: Object.keys(changedFields), changeReason },
    });

    res.json({ success: true, data: serialize(updated), message: '변경이 반영되었습니다.' });
  } catch (err) {
    console.error('Requirement change error:', err);
    res.status(500).json({ success: false, message: '변경 처리 중 오류가 발생했습니다.' });
  }
});

// GET /:requirementId/history — 변경 이력 조회
router.get('/:requirementId/history', async (req: Request, res: Response) => {
  try {
    const requirementId = BigInt(req.params.requirementId);
    const histories = await prisma.requirementHistory.findMany({
      where: { requirementId },
      orderBy: { changedAt: 'desc' },
    });
    res.json({
      success: true,
      data: histories.map(h => ({
        ...h,
        historyId: Number(h.historyId),
        requirementId: Number(h.requirementId),
      })),
    });
  } catch (err) {
    console.error('Requirement history error:', err);
    res.status(500).json({ success: false, message: '이력 조회 중 오류가 발생했습니다.' });
  }
});

// POST /import — 엑셀 임포트
router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user as JwtPayload;
    const projectId = BigInt(req.params.projectId);
    const roleInfo = await getProjectRole(currentUser.userId, projectId, currentUser.systemRole);
    if (!roleInfo.isPmsAdmin) {
      res.status(403).json({ success: false, message: 'PMS관리자만 가져올 수 있습니다.' });
      return;
    }

    const file = req.file;
    const mode = req.body?.mode || 'append'; // append | clear
    if (!file) {
      res.status(400).json({ success: false, message: '엑셀 파일을 업로드해주세요.' });
      return;
    }

    // 전체 초기화 모드: 모든 요구사항 삭제 (Baseline 포함)
    let cleared = 0;
    if (mode === 'clear') {
      const toDelete = await prisma.requirement.findMany({
        where: { projectId },
        select: { requirementId: true },
      });
      const ids = toDelete.map(r => r.requirementId);
      if (ids.length) {
        await prisma.requirementHistory.deleteMany({ where: { requirementId: { in: ids } } });
        const result = await prisma.requirement.deleteMany({ where: { requirementId: { in: ids } } });
        cleared = result.count;
      }
    }

    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // 헤더명 → DB필드 매핑 (다양한 엑셀 형식 지원)
    const HEADER_MAP: Record<string, string> = {
      '요구사항id': 'reqCode', '요구사항 id': 'reqCode', 'id': 'reqCode', 'req_id': 'reqCode', 'reqcode': 'reqCode',
      '요구사항명': 'reqName', '요구사항 명': 'reqName', '이름': 'reqName', '명칭': 'reqName',
      '요구사항 내용': 'reqDetail', '요구사항내용': 'reqDetail', '내용': 'reqDetail', '상세': 'reqDetail', '설명': 'reqDetail',
      '도출유형': 'sourceType', '출처유형': 'sourceType', '유형': 'sourceType',
      '도출단계': 'derivationPhase', '단계': 'derivationPhase',
      '요구사항유형': 'reqType', '요구사항 유형': 'reqType', '기능구분': 'reqType', '기능/비기능': 'reqType',
      '진행상태': 'progressStatus', '상태': 'progressStatus',
      '진행상태 변경사유': 'statusChangeReason', '변경사유': 'statusChangeReason', '상태변경사유': 'statusChangeReason',
      '중요도': 'importance',
      '난이도': 'difficulty',
      '완료예정일': 'plannedEndDate', '예정일': 'plannedEndDate',
      '적용방안': 'reviewOpinion', '적용방안(검토의견)': 'reviewOpinion', '검토의견': 'reviewOpinion',
      '업무명': 'business', '업무': 'business',
      '기능명': 'funcName', '기능': 'funcName', '기술': 'funcName',
      '세부기능명': 'subFuncName', '세부기능': 'subFuncName',
      '요구사항 출처구분': 'sourceCategory', '출처구분': 'sourceCategory',
      '요구사항 출처상세': 'sourceDesc', '출처상세': 'sourceDesc', '출처설명': 'sourceDesc',
      '요청자': 'requesterName',
      '요청부서': 'requesterDept',
      '담당자': 'assigneeName',
      '검토자': 'reviewerName',
    };

    // 헤더 행 찾기
    let headerRow = 0;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = rows[i].map((c: any) => String(c).replace(/\s*\*\s*/g, '').trim().toLowerCase());
      if (row.some(c => HEADER_MAP[c] === 'reqCode' || HEADER_MAP[c] === 'reqName')) {
        headerRow = i;
        break;
      }
    }

    // 헤더 → 컬럼인덱스 매핑 생성
    const headerCells = rows[headerRow].map((c: any) => String(c).replace(/\s*\*\s*/g, '').trim().toLowerCase());
    const colMap: Record<string, number> = {};
    headerCells.forEach((h: string, idx: number) => {
      const field = HEADER_MAP[h];
      if (field && !(field in colMap)) colMap[field] = idx;
    });

    const getVal = (row: any[], field: string): string => {
      const idx = colMap[field];
      if (idx === undefined) return '';
      return String(row[idx] || '').trim();
    };

    const dataRows = rows.slice(headerRow + 1).filter((r: any[]) => {
      const first = getVal(r, 'reqCode');
      return first && !first.startsWith('※') && !first.startsWith('관리자');
    });

    if (!dataRows.length) {
      res.status(400).json({ success: false, message: '임포트할 데이터가 없습니다. 헤더 행을 확인해주세요.' });
      return;
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = headerRow + 2 + i;
      const reqCode = getVal(row, 'reqCode');
      const reqName = getVal(row, 'reqName');

      // 필수값 검증 (ID, 이름만 필수)
      if (!reqCode) { errors.push(`${rowNum}행: 요구사항ID 누락`); continue; }
      if (!reqName) { errors.push(`${rowNum}행: 요구사항명 누락`); continue; }

      // 중복 체크
      const existing = await prisma.requirement.findUnique({
        where: { projectId_reqCode: { projectId, reqCode } },
      });
      if (existing) { skipped++; errors.push(`${rowNum}행: ${reqCode} 이미 존재 (건너뜀)`); continue; }

      // 날짜 파싱
      let plannedEndDate: Date | null = null;
      const dateStr = getVal(row, 'plannedEndDate');
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) plannedEndDate = d;
      }

      try {
        await prisma.requirement.create({
          data: {
            projectId,
            reqCode,
            reqName,
            reqDetail: getVal(row, 'reqDetail') || null,
            sourceType: getVal(row, 'sourceType') || null,
            derivationPhase: getVal(row, 'derivationPhase') || null,
            reqType: getVal(row, 'reqType') || null,
            progressStatus: getVal(row, 'progressStatus') || '미분류',
            statusChangeReason: getVal(row, 'statusChangeReason') || null,
            importance: getVal(row, 'importance') || null,
            difficulty: getVal(row, 'difficulty') || null,
            plannedEndDate,
            reviewOpinion: getVal(row, 'reviewOpinion') || null,
            business: getVal(row, 'business') || null,
            funcName: getVal(row, 'funcName') || null,
            subFuncName: getVal(row, 'subFuncName') || null,
            sourceCategory: getVal(row, 'sourceCategory') || null,
            sourceDesc: getVal(row, 'sourceDesc') || null,
            requesterName: getVal(row, 'requesterName') || null,
            requesterDept: getVal(row, 'requesterDept') || null,
            assigneeName: getVal(row, 'assigneeName') || null,
            reviewerName: getVal(row, 'reviewerName') || null,
            createdBy: currentUser.userId,
          },
        });
        imported++;
      } catch (dbErr: any) {
        errors.push(`${rowNum}행: ${reqCode} DB 오류 (${dbErr.message?.substring(0, 50)})`);
      }
    }

    // 파일 정리
    try { fs.unlinkSync(file.path); } catch {}

    await writeAuditLog({
      userId: currentUser.userId,
      ipAddress: req.ip,
      action: 'CREATE',
      targetType: 'requirement',
      targetId: BigInt(0),
      changeDetail: { action: 'import', imported, skipped, errors: errors.length },
    });

    res.json({
      success: true,
      data: { imported, skipped, cleared, errors },
      message: `${cleared ? `${cleared}건 삭제 후 ` : ''}${imported}건 임포트 완료${skipped ? `, ${skipped}건 건너뜀` : ''}${errors.length ? `, ${errors.length}건 오류` : ''}`,
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ success: false, message: '엑셀 가져오기 중 오류가 발생했습니다.' });
  }
});

export default router;
