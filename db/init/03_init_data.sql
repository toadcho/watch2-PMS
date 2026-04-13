-- =====================================================
-- PMS 공통코드 초기 데이터
-- =====================================================

-- 프로젝트 상태
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('PROJECT_STATUS', 'PLAN', '계획', 1),
('PROJECT_STATUS', 'ACTIVE', '진행', 2),
('PROJECT_STATUS', 'PAUSED', '일시중지', 3),
('PROJECT_STATUS', 'COMPLETED', '완료', 4),
('PROJECT_STATUS', 'CLOSED', '종료', 5);

-- 공정단계 구분 (행안부 표준)
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('PHASE', 'ANALYSIS', '분석', 1),
('PHASE', 'DESIGN', '설계', 2),
('PHASE', 'DEVELOP', '구현', 3),
('PHASE', 'TEST', '시험', 4),
('PHASE', 'DEPLOY', '이행', 5);

-- 시스템 역할
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('SYSTEM_ROLE', 'ADMIN', '관리자', 1),
('SYSTEM_ROLE', 'USER', '일반 사용자', 2);

-- 프로젝트 멤버 역할
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('MEMBER_ROLE', 'PMS_ADMIN', 'PMS관리자', 1),
('MEMBER_ROLE', 'LEADER', '팀장', 2),
('MEMBER_ROLE', 'MEMBER', '팀원', 3),
('MEMBER_ROLE', 'PM', 'PM', 4),
('MEMBER_ROLE', 'PMO', 'PMO', 5),
('MEMBER_ROLE', 'CLIENT', '고객', 6),
('MEMBER_ROLE', 'AUDITOR', '감리', 7);

-- 산출물 유형
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('DOC_TYPE', 'REQ_DEF', '요구사항정의서', 1),
('DOC_TYPE', 'SCREEN_DESIGN', '화면설계서', 2),
('DOC_TYPE', 'DB_DESIGN', 'DB설계서', 3),
('DOC_TYPE', 'IF_DESIGN', '인터페이스설계서', 4),
('DOC_TYPE', 'ARCH_DESIGN', '아키텍처설계서', 5),
('DOC_TYPE', 'SOURCE_CODE', '소스코드', 6),
('DOC_TYPE', 'UNIT_TEST', '단위테스트결과서', 7),
('DOC_TYPE', 'INT_TEST', '통합테스트결과서', 8),
('DOC_TYPE', 'PERF_TEST', '성능테스트결과서', 9),
('DOC_TYPE', 'USER_MANUAL', '사용자매뉴얼', 10),
('DOC_TYPE', 'OPS_MANUAL', '운영자매뉴얼', 11),
('DOC_TYPE', 'TRAINING', '교육자료', 12),
('DOC_TYPE', 'MIGRATION', '데이터이행결과서', 13);

-- 산출물 상태
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('DOC_STATUS', 'REGISTERED', '등록', 1),
('DOC_STATUS', 'REVIEW_REQ', '검토요청', 2),
('DOC_STATUS', 'REVIEWING', '검토중', 3),
('DOC_STATUS', 'APPROVED', '승인', 4),
('DOC_STATUS', 'REJECTED', '반려', 5);

-- 감리 점검 상태
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('AUDIT_CHECK', 'UNCHECKED', '미점검', 1),
('AUDIT_CHECK', 'PASS', '적합', 2),
('AUDIT_CHECK', 'FAIL', '부적합', 3),
('AUDIT_CHECK', 'CONDITIONAL', '조건부적합', 4);

-- 테스트 유형
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('TEST_TYPE', 'UNIT', '단위테스트', 1),
('TEST_TYPE', 'INTEGRATION', '통합테스트', 2),
('TEST_TYPE', 'SYSTEM', '시스템테스트', 3),
('TEST_TYPE', 'ACCEPTANCE', '인수테스트', 4);

-- 결함 심각도
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('DEFECT_SEVERITY', 'CRITICAL', '치명', 1),
('DEFECT_SEVERITY', 'MAJOR', '긴급', 2),
('DEFECT_SEVERITY', 'MINOR', '보통', 3),
('DEFECT_SEVERITY', 'TRIVIAL', '경미', 4);

-- 결함 상태
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('DEFECT_STATUS', 'NEW', '신규', 1),
('DEFECT_STATUS', 'CONFIRMED', '확인', 2),
('DEFECT_STATUS', 'IN_PROGRESS', '진행중', 3),
('DEFECT_STATUS', 'RESOLVED', '해결', 4),
('DEFECT_STATUS', 'VERIFIED', '검증', 5),
('DEFECT_STATUS', 'CLOSED', '종료', 6),
('DEFECT_STATUS', 'REOPENED', '재오픈', 7);

-- 이슈 우선순위
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('PRIORITY', 'URGENT', '긴급', 1),
('PRIORITY', 'HIGH', '높음', 2),
('PRIORITY', 'MEDIUM', '보통', 3),
('PRIORITY', 'LOW', '낮음', 4);

-- 이슈 상태
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('ISSUE_STATUS', 'REGISTERED', '등록', 1),
('ISSUE_STATUS', 'IN_PROGRESS', '진행중', 2),
('ISSUE_STATUS', 'RESOLVED', '해결', 3),
('ISSUE_STATUS', 'CLOSED', '종료', 4);

-- 위험 상태
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('RISK_STATUS', 'IDENTIFIED', '식별', 1),
('RISK_STATUS', 'MONITORING', '감시', 2),
('RISK_STATUS', 'MITIGATING', '대응중', 3),
('RISK_STATUS', 'RESOLVED', '해결', 4),
('RISK_STATUS', 'ACCEPTED', '수용', 5);

-- 위험 영향도/발생가능성
INSERT INTO common_code (code_group, code, code_name, sort_order) VALUES
('RISK_LEVEL', 'HIGH', '높음', 1),
('RISK_LEVEL', 'MEDIUM', '중간', 2),
('RISK_LEVEL', 'LOW', '낮음', 3);

-- =====================================================
-- 초기 관리자 계정 (비밀번호: admin123!)
-- bcrypt hash for 'admin123!'
-- =====================================================
INSERT INTO "user" (user_id, user_name, email, password_hash, department, position, system_role, is_active)
VALUES (
  'admin',
  '시스템관리자',
  'admin@pms.local',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  '정보화담당관실',
  '관리자',
  'ADMIN',
  true
);
