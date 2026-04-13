import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL || 'postgresql://pms_user:pms_password@localhost:5433/pms';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // 공통코드 초기 데이터
  const codes = [
    // 프로젝트 상태
    { codeGroup: 'PROJECT_STATUS', code: 'PLAN', codeName: '계획', sortOrder: 1 },
    { codeGroup: 'PROJECT_STATUS', code: 'ACTIVE', codeName: '진행', sortOrder: 2 },
    { codeGroup: 'PROJECT_STATUS', code: 'PAUSED', codeName: '일시중지', sortOrder: 3 },
    { codeGroup: 'PROJECT_STATUS', code: 'COMPLETED', codeName: '완료', sortOrder: 4 },
    { codeGroup: 'PROJECT_STATUS', code: 'CLOSED', codeName: '종료', sortOrder: 5 },
    // 공정단계 구분
    { codeGroup: 'PHASE', code: 'ANALYSIS', codeName: '분석', sortOrder: 1 },
    { codeGroup: 'PHASE', code: 'DESIGN', codeName: '설계', sortOrder: 2 },
    { codeGroup: 'PHASE', code: 'DEVELOP', codeName: '구현', sortOrder: 3 },
    { codeGroup: 'PHASE', code: 'TEST', codeName: '시험', sortOrder: 4 },
    { codeGroup: 'PHASE', code: 'DEPLOY', codeName: '이행', sortOrder: 5 },
    // 시스템 역할
    { codeGroup: 'SYSTEM_ROLE', code: 'SYS_ADMIN', codeName: '시스템관리자', sortOrder: 1 },
    { codeGroup: 'SYSTEM_ROLE', code: 'PMO', codeName: 'PMO', sortOrder: 2 },
    { codeGroup: 'SYSTEM_ROLE', code: 'PM', codeName: 'PM', sortOrder: 3 },
    { codeGroup: 'SYSTEM_ROLE', code: 'QA', codeName: 'QA', sortOrder: 4 },
    { codeGroup: 'SYSTEM_ROLE', code: 'TEAM_LEAD', codeName: '팀장', sortOrder: 5 },
    { codeGroup: 'SYSTEM_ROLE', code: 'DEVELOPER', codeName: '팀원', sortOrder: 6 },
    { codeGroup: 'SYSTEM_ROLE', code: 'AUDITOR', codeName: '감리원', sortOrder: 7 },
    { codeGroup: 'SYSTEM_ROLE', code: 'CLIENT', codeName: '발주사담당자', sortOrder: 8 },
    { codeGroup: 'SYSTEM_ROLE', code: 'VIEWER', codeName: '열람자', sortOrder: 9 },
    // 프로젝트 멤버 역할
    { codeGroup: 'MEMBER_ROLE', code: 'PM', codeName: 'PM', sortOrder: 1 },
    { codeGroup: 'MEMBER_ROLE', code: 'PL', codeName: 'PL', sortOrder: 2 },
    { codeGroup: 'MEMBER_ROLE', code: 'DEV', codeName: '개발', sortOrder: 3 },
    { codeGroup: 'MEMBER_ROLE', code: 'QA', codeName: 'QA', sortOrder: 4 },
    { codeGroup: 'MEMBER_ROLE', code: 'DESIGN', codeName: '설계', sortOrder: 5 },
    { codeGroup: 'MEMBER_ROLE', code: 'BA', codeName: 'BA', sortOrder: 6 },
    // 산출물 유형
    { codeGroup: 'DOC_TYPE', code: 'REQ_DEF', codeName: '요구사항정의서', sortOrder: 1 },
    { codeGroup: 'DOC_TYPE', code: 'SCREEN_DESIGN', codeName: '화면설계서', sortOrder: 2 },
    { codeGroup: 'DOC_TYPE', code: 'DB_DESIGN', codeName: 'DB설계서', sortOrder: 3 },
    { codeGroup: 'DOC_TYPE', code: 'IF_DESIGN', codeName: '인터페이스설계서', sortOrder: 4 },
    { codeGroup: 'DOC_TYPE', code: 'ARCH_DESIGN', codeName: '아키텍처설계서', sortOrder: 5 },
    { codeGroup: 'DOC_TYPE', code: 'SOURCE_CODE', codeName: '소스코드', sortOrder: 6 },
    { codeGroup: 'DOC_TYPE', code: 'UNIT_TEST', codeName: '단위테스트결과서', sortOrder: 7 },
    { codeGroup: 'DOC_TYPE', code: 'INT_TEST', codeName: '통합테스트결과서', sortOrder: 8 },
    { codeGroup: 'DOC_TYPE', code: 'PERF_TEST', codeName: '성능테스트결과서', sortOrder: 9 },
    { codeGroup: 'DOC_TYPE', code: 'USER_MANUAL', codeName: '사용자매뉴얼', sortOrder: 10 },
    { codeGroup: 'DOC_TYPE', code: 'OPS_MANUAL', codeName: '운영자매뉴얼', sortOrder: 11 },
    // 산출물 상태
    { codeGroup: 'DOC_STATUS', code: 'REGISTERED', codeName: '등록', sortOrder: 1 },
    { codeGroup: 'DOC_STATUS', code: 'REVIEW_REQ', codeName: '검토요청', sortOrder: 2 },
    { codeGroup: 'DOC_STATUS', code: 'REVIEWING', codeName: '검토중', sortOrder: 3 },
    { codeGroup: 'DOC_STATUS', code: 'APPROVED', codeName: '승인', sortOrder: 4 },
    { codeGroup: 'DOC_STATUS', code: 'REJECTED', codeName: '반려', sortOrder: 5 },
    // 감리 점검
    { codeGroup: 'AUDIT_CHECK', code: 'UNCHECKED', codeName: '미점검', sortOrder: 1 },
    { codeGroup: 'AUDIT_CHECK', code: 'PASS', codeName: '적합', sortOrder: 2 },
    { codeGroup: 'AUDIT_CHECK', code: 'FAIL', codeName: '부적합', sortOrder: 3 },
    { codeGroup: 'AUDIT_CHECK', code: 'CONDITIONAL', codeName: '조건부적합', sortOrder: 4 },
    // 결함 심각도
    { codeGroup: 'DEFECT_SEVERITY', code: 'CRITICAL', codeName: '치명', sortOrder: 1 },
    { codeGroup: 'DEFECT_SEVERITY', code: 'MAJOR', codeName: '긴급', sortOrder: 2 },
    { codeGroup: 'DEFECT_SEVERITY', code: 'MINOR', codeName: '보통', sortOrder: 3 },
    { codeGroup: 'DEFECT_SEVERITY', code: 'TRIVIAL', codeName: '경미', sortOrder: 4 },
    // 결함 상태
    { codeGroup: 'DEFECT_STATUS', code: 'NEW', codeName: '신규', sortOrder: 1 },
    { codeGroup: 'DEFECT_STATUS', code: 'CONFIRMED', codeName: '확인', sortOrder: 2 },
    { codeGroup: 'DEFECT_STATUS', code: 'IN_PROGRESS', codeName: '진행중', sortOrder: 3 },
    { codeGroup: 'DEFECT_STATUS', code: 'RESOLVED', codeName: '해결', sortOrder: 4 },
    { codeGroup: 'DEFECT_STATUS', code: 'VERIFIED', codeName: '검증', sortOrder: 5 },
    { codeGroup: 'DEFECT_STATUS', code: 'CLOSED', codeName: '종료', sortOrder: 6 },
    { codeGroup: 'DEFECT_STATUS', code: 'REOPENED', codeName: '재오픈', sortOrder: 7 },
    // 우선순위
    { codeGroup: 'PRIORITY', code: 'URGENT', codeName: '긴급', sortOrder: 1 },
    { codeGroup: 'PRIORITY', code: 'HIGH', codeName: '높음', sortOrder: 2 },
    { codeGroup: 'PRIORITY', code: 'MEDIUM', codeName: '보통', sortOrder: 3 },
    { codeGroup: 'PRIORITY', code: 'LOW', codeName: '낮음', sortOrder: 4 },
    // 이슈 상태
    { codeGroup: 'ISSUE_STATUS', code: 'REGISTERED', codeName: '등록', sortOrder: 1 },
    { codeGroup: 'ISSUE_STATUS', code: 'IN_PROGRESS', codeName: '진행중', sortOrder: 2 },
    { codeGroup: 'ISSUE_STATUS', code: 'RESOLVED', codeName: '해결', sortOrder: 3 },
    { codeGroup: 'ISSUE_STATUS', code: 'CLOSED', codeName: '종료', sortOrder: 4 },
    // 위험 상태
    { codeGroup: 'RISK_STATUS', code: 'IDENTIFIED', codeName: '식별', sortOrder: 1 },
    { codeGroup: 'RISK_STATUS', code: 'MONITORING', codeName: '감시', sortOrder: 2 },
    { codeGroup: 'RISK_STATUS', code: 'MITIGATING', codeName: '대응중', sortOrder: 3 },
    { codeGroup: 'RISK_STATUS', code: 'RESOLVED', codeName: '해결', sortOrder: 4 },
    { codeGroup: 'RISK_STATUS', code: 'ACCEPTED', codeName: '수용', sortOrder: 5 },
    // 위험 수준
    { codeGroup: 'RISK_LEVEL', code: 'HIGH', codeName: '높음', sortOrder: 1 },
    { codeGroup: 'RISK_LEVEL', code: 'MEDIUM', codeName: '중간', sortOrder: 2 },
    { codeGroup: 'RISK_LEVEL', code: 'LOW', codeName: '낮음', sortOrder: 3 },
    // 테스트 유형
    { codeGroup: 'TEST_TYPE', code: 'UNIT', codeName: '단위테스트', sortOrder: 1 },
    { codeGroup: 'TEST_TYPE', code: 'INTEGRATION', codeName: '통합테스트', sortOrder: 2 },
    { codeGroup: 'TEST_TYPE', code: 'SYSTEM', codeName: '시스템테스트', sortOrder: 3 },
    { codeGroup: 'TEST_TYPE', code: 'ACCEPTANCE', codeName: '인수테스트', sortOrder: 4 },
  ];

  for (const code of codes) {
    await prisma.commonCode.upsert({
      where: { codeGroup_code: { codeGroup: code.codeGroup, code: code.code } },
      update: {},
      create: code,
    });
  }
  console.log(`Seeded ${codes.length} common codes`);

  // 관리자 계정
  const adminHash = await bcrypt.hash('admin123!', 10);
  await prisma.user.upsert({
    where: { userId: 'admin' },
    update: {},
    create: {
      userId: 'admin',
      userName: '시스템관리자',
      email: 'admin@pms.local',
      passwordHash: adminHash,
      department: '정보화담당관실',
      position: '관리자',
      systemRole: 'ADMIN',
      isActive: true,
    },
  });
  console.log('Seeded admin user (admin / admin123!)');

  // 샘플 사용자 등록
  const sampleUsers = [
    { userId: 'pm01', userName: '김프엠', email: 'pm01@pms.local', department: '사업관리팀', position: 'PM', systemRole: 'USER' },
    { userId: 'qa01', userName: '이큐에이', email: 'qa01@pms.local', department: '품질관리팀', position: 'QA', systemRole: 'USER' },
    { userId: 'lead01', userName: '박팀장A', email: 'lead01@pms.local', department: '개발1팀', position: '팀장', systemRole: 'USER' },
    { userId: 'lead02', userName: '최팀장B', email: 'lead02@pms.local', department: '개발2팀', position: '팀장', systemRole: 'USER' },
    { userId: 'lead03', userName: '정팀장C', email: 'lead03@pms.local', department: '개발3팀', position: '팀장', systemRole: 'USER' },
    { userId: 'dev01', userName: '홍개발1', email: 'dev01@pms.local', department: '개발1팀', position: '선임', systemRole: 'USER' },
    { userId: 'dev02', userName: '강개발2', email: 'dev02@pms.local', department: '개발1팀', position: '주임', systemRole: 'USER' },
    { userId: 'dev03', userName: '조개발3', email: 'dev03@pms.local', department: '개발1팀', position: '사원', systemRole: 'USER' },
    { userId: 'dev04', userName: '윤개발4', email: 'dev04@pms.local', department: '개발2팀', position: '선임', systemRole: 'USER' },
    { userId: 'dev05', userName: '임개발5', email: 'dev05@pms.local', department: '개발2팀', position: '주임', systemRole: 'USER' },
    { userId: 'dev06', userName: '한개발6', email: 'dev06@pms.local', department: '개발2팀', position: '사원', systemRole: 'USER' },
    { userId: 'dev07', userName: '송개발7', email: 'dev07@pms.local', department: '개발3팀', position: '선임', systemRole: 'USER' },
    { userId: 'dev08', userName: '권개발8', email: 'dev08@pms.local', department: '개발3팀', position: '주임', systemRole: 'USER' },
    { userId: 'dev09', userName: '황개발9', email: 'dev09@pms.local', department: '개발3팀', position: '사원', systemRole: 'USER' },
    { userId: 'pmo01', userName: '서피엠오1', email: 'pmo01@pms.local', department: 'PMO', position: 'PMO', systemRole: 'USER' },
    { userId: 'pmo02', userName: '안피엠오2', email: 'pmo02@pms.local', department: 'PMO', position: 'PMO', systemRole: 'USER' },
    { userId: 'audit01', userName: '류감리1', email: 'audit01@pms.local', department: '감리법인', position: '감리원', systemRole: 'USER' },
    { userId: 'audit02', userName: '오감리2', email: 'audit02@pms.local', department: '감리법인', position: '감리원', systemRole: 'USER' },
    { userId: 'client01', userName: '장발주1', email: 'client01@pms.local', department: '발주기관', position: '사무관', systemRole: 'USER' },
    { userId: 'client02', userName: '문발주2', email: 'client02@pms.local', department: '발주기관', position: '주무관', systemRole: 'USER' },
    { userId: 'viewer01', userName: '배열람', email: 'viewer01@pms.local', department: '기획팀', position: '대리', systemRole: 'USER' },
  ];

  const userHash = await bcrypt.hash('password1!', 10);
  for (const u of sampleUsers) {
    await prisma.user.upsert({
      where: { userId: u.userId },
      update: {},
      create: { ...u, passwordHash: userHash, isActive: true },
    });
  }
  console.log(`Seeded ${sampleUsers.length} sample users (password: password1!)`);

  // ─── 마스터 산출물 목록 (행안부 표준) ───
  const masterDeliverables = [
    { phase: '분석', docCode: 'AN-01', docName: '현행 업무·시스템 분석서', mandatory: '선택', description: '현재 운영 중인 업무 프로세스와 시스템의 구조, 기능, 데이터 등을 분석한 문서', remark: '신규 구축 시 해당', sortOrder: 1 },
    { phase: '분석', docCode: 'AN-02', docName: '요구사항 정의서', mandatory: '필수', description: '사용자 요구사항을 기능/비기능으로 분류하여 정의한 문서. 요구사항 ID, 분류, 내용, 우선순위 등 포함', remark: '', sortOrder: 2 },
    { phase: '분석', docCode: 'AN-03', docName: '요구사항 추적표', mandatory: '필수', description: '요구사항이 설계·구현·시험 단계까지 반영되었는지 추적·관리하는 매트릭스', remark: '', sortOrder: 3 },
    { phase: '분석', docCode: 'AN-04', docName: '비즈니스 프로세스 정의서', mandatory: '선택', description: 'To-Be 업무 프로세스를 정의한 문서. 업무흐름도, 프로세스 설명 포함', remark: 'BPR 포함 시', sortOrder: 4 },
    { phase: '분석', docCode: 'AN-05', docName: '개념 데이터모델 정의서', mandatory: '선택', description: '주요 엔터티와 관계를 정의한 개념 수준의 데이터 모델 문서', remark: '', sortOrder: 5 },
    { phase: '분석', docCode: 'AN-06', docName: '유스케이스 명세서', mandatory: '선택', description: '시스템과 사용자 간 상호작용을 유스케이스로 정의·명세한 문서', remark: 'CBD 방법론 적용 시', sortOrder: 6 },
    { phase: '설계', docCode: 'DE-01', docName: '소프트웨어 아키텍처 정의서', mandatory: '필수', description: '시스템 전체 구조, 기술 아키텍처, 컴포넌트 구성, 연동 방식 등을 정의한 문서', remark: '', sortOrder: 7 },
    { phase: '설계', docCode: 'DE-02', docName: '화면 설계서', mandatory: '필수', description: '사용자 인터페이스(UI) 레이아웃, 화면 흐름, 입출력 항목 등을 설계한 문서', remark: '', sortOrder: 8 },
    { phase: '설계', docCode: 'DE-03', docName: '프로그램 설계서', mandatory: '필수', description: '프로그램 목록, 기능 명세, 처리 로직, 알고리즘 등을 설계한 문서', remark: '', sortOrder: 9 },
    { phase: '설계', docCode: 'DE-04', docName: '인터페이스 설계서', mandatory: '필수', description: '시스템 간 연계 인터페이스의 방식, 데이터 포맷, 프로토콜 등을 설계한 문서', remark: '대외연계 시', sortOrder: 10 },
    { phase: '설계', docCode: 'DE-05', docName: '데이터베이스 설계서', mandatory: '필수', description: '논리/물리 데이터 모델, 테이블 정의서, 인덱스 설계, ERD 등을 포함한 DB 설계 문서', remark: '', sortOrder: 11 },
    { phase: '설계', docCode: 'DE-06', docName: '배치 설계서', mandatory: '선택', description: '배치 프로그램의 처리 흐름, 스케줄, 입출력 데이터 등 설계한 문서', remark: '배치 처리 시', sortOrder: 12 },
    { phase: '설계', docCode: 'DE-07', docName: '보고서 설계서', mandatory: '선택', description: '출력 보고서의 레이아웃, 데이터 항목, 조회 조건 등을 설계한 문서', remark: '보고서 기능 시', sortOrder: 13 },
    { phase: '설계', docCode: 'DE-08', docName: '테스트 계획서', mandatory: '필수', description: '테스트 전략, 범위, 일정, 환경, 기준, 시나리오 작성 방안 등을 수립한 문서', remark: '', sortOrder: 14 },
    { phase: '설계', docCode: 'DE-09', docName: '전환·이행 계획서', mandatory: '필수', description: '기존 시스템에서 신규 시스템으로의 데이터 이행 및 시스템 전환 계획 문서', remark: '시스템 전환 시', sortOrder: 15 },
    { phase: '설계', docCode: 'DE-10', docName: '교육 계획서', mandatory: '선택', description: '사용자 및 운영자 대상 교육 내용, 일정, 방법 등을 수립한 문서', remark: '', sortOrder: 16 },
    { phase: '구현', docCode: 'CO-01', docName: '프로그램 소스코드', mandatory: '필수', description: '설계서에 따라 구현된 프로그램 소스코드 일체(형상관리 시스템 포함)', remark: '', sortOrder: 17 },
    { phase: '구현', docCode: 'CO-02', docName: '단위테스트 결과서', mandatory: '필수', description: '프로그램 단위별 테스트 수행 결과(테스트 케이스, 수행결과, 결함조치 내역)', remark: '', sortOrder: 18 },
    { phase: '구현', docCode: 'CO-03', docName: '데이터 전환 프로그램', mandatory: '선택', description: '기존 데이터를 신규 시스템으로 이행하기 위한 전환 프로그램 및 스크립트', remark: '데이터 이행 시', sortOrder: 19 },
    { phase: '시험', docCode: 'TE-01', docName: '통합테스트 결과서', mandatory: '필수', description: '모듈 간 연계·통합 테스트 수행 결과(시나리오, 케이스, 결과, 결함수정)', remark: '', sortOrder: 20 },
    { phase: '시험', docCode: 'TE-02', docName: '시스템테스트 결과서', mandatory: '필수', description: '전체 시스템 수준의 기능·비기능 테스트 수행 결과서', remark: '', sortOrder: 21 },
    { phase: '시험', docCode: 'TE-03', docName: '성능테스트 결과서', mandatory: '선택', description: '시스템 성능(응답시간, 처리량, 동시사용자 등) 테스트 수행 결과서', remark: '대규모 시스템', sortOrder: 22 },
    { phase: '시험', docCode: 'TE-04', docName: '인수테스트 결과서', mandatory: '선택', description: '발주기관이 수행하는 인수 테스트의 수행 결과 및 합격 판정 문서', remark: '', sortOrder: 23 },
    { phase: '이행', docCode: 'TR-01', docName: '사용자 지침서', mandatory: '필수', description: '시스템 사용 방법, 화면 조작법, 업무 처리 절차 등을 안내하는 최종 사용자용 매뉴얼', remark: '', sortOrder: 24 },
    { phase: '이행', docCode: 'TR-02', docName: '운영자 지침서', mandatory: '필수', description: '시스템 설치·운영·관리·장애대응 절차 등을 안내하는 운영자용 매뉴얼', remark: '', sortOrder: 25 },
    { phase: '이행', docCode: 'TR-03', docName: '데이터 이행 결과서', mandatory: '필수', description: '데이터 이행 수행 결과, 검증 내역, 오류 조치 사항 등을 기록한 문서', remark: '데이터 이행 시', sortOrder: 26 },
    { phase: '이행', docCode: 'TR-04', docName: '교육 결과서', mandatory: '선택', description: '교육 결과(교육 대상, 일시, 내용, 참석자, 만족도 등)를 기록한 문서', remark: '', sortOrder: 27 },
    { phase: '이행', docCode: 'TR-05', docName: '유지보수 계획서', mandatory: '선택', description: '시스템 인수 후 유지보수 범위, 절차, 체계, SLA 등을 수립한 문서', remark: '', sortOrder: 28 },
  ];

  for (const d of masterDeliverables) {
    await prisma.deliverableMaster.upsert({
      where: { docCode: d.docCode },
      update: { ...d },
      create: { ...d },
    });
  }
  console.log(`Seeded ${masterDeliverables.length} master deliverables`);

  await pool.end();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
