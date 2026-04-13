# CLAUDE.md — watch2-PMS 프로젝트관리시스템

## 프로젝트 개요
공공 SI 프로젝트 전용 PMS. 행안부 SW개발 표준 프레임워크, 감리 대응, 망분리 환경 전제.
온프레미스 Docker Compose 배포 기본.

## 기술 스택
- **Backend**: Node.js 20 + Express 5 + TypeScript + Prisma ORM
- **Frontend**: Vue 3 + Vuetify 3 + Vite + TypeScript + Pinia
- **DB**: PostgreSQL 16 + Redis 7
- **Container**: Docker Compose
- **차트**: ApexCharts
- **패턴**: watch2-TMS 프로젝트와 동일한 아키텍처 패턴 사용

## [M4] 시험/결함 관리
watch2-TMS(d:/Pgm/watch2-TMS)를 재사용. PMS에서는 API 연동 또는 iframe 방식으로 통합 예정.
PMS 내 TestCase/Defect 모델은 대시보드 통계용 경량 참조 목적.

## 모듈 구성
| 모듈 | 설명 | 상태 |
|------|------|------|
| M1 프로젝트관리 | 프로젝트 CRUD, 인력, 예산, 위험 | 미착수 |
| M2 일정/WBS | WBS 트리, 간트차트, 마일스톤 | 미착수 |
| M3 산출물관리 | 등록, 버전, 검토/승인, 감리 | 미착수 |
| M4 시험/결함 | **watch2-TMS 연동** | 기존 시스템 |
| M5 의사소통 | 이슈, 회의록, 알림 | 미착수 |
| M6 시스템관리 | 사용자, 권한, 공통코드, 감사로그 | 미착수 |
| C1 대시보드 | PMO 통합 대시보드 | 미착수 |
| C2 보고서 | 주간/월간/감리 보고서 | 미착수 |

## 포트 구성
- PMS Server: 3100 (watch2-TMS는 3000)
- PMS Client: 5174 (watch2-TMS는 5173)
- PostgreSQL: 5433 (watch2-TMS는 5432)
- Redis: 6379

## 개발 규칙
- API: `/api/v1/{resource}` REST 패턴
- 응답: `{ success, data, message, pagination }`
- 인증: JWT Bearer + Refresh Token
- 역할: SYS_ADMIN, PMO, PM, DEVELOPER, QA, AUDITOR, VIEWER
- 커밋: `[M1] feat: 프로젝트 등록 API 구현` 형식

## 실행 방법
```bash
docker-compose up        # 개발 환경 전체 기동
docker-compose down      # 전체 중지
```
