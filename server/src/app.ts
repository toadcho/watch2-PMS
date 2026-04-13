import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// BigInt → JSON 직렬화 전역 지원
(BigInt.prototype as any).toJSON = function () { return Number(this); };
import { errorHandler } from './middlewares/errorHandler';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import codesRouter from './routes/codes';
import auditLogsRouter from './routes/auditLogs';
import projectsRouter from './routes/projects';
import membersRouter from './routes/members';
import risksRouter from './routes/risks';
import wbsRouter from './routes/wbs';
import milestonesRouter from './routes/milestones';
import deliverablesRouter from './routes/deliverables';
import issuesRouter from './routes/issues';
import noticesRouter from './routes/notices';
import dashboardRouter from './routes/dashboard';
import reportsRouter from './routes/reports';
import backupRouter from './routes/backup';
import deliverableDefsRouter from './routes/deliverableDefs';
import methodologyRouter from './routes/methodology';
import approvalRouter from './routes/approval';
import requirementsRouter from './routes/requirements';
import calendarRouter from './routes/calendar';
import notificationsRouter from './routes/notifications';
import devProgramsRouter from './routes/devPrograms';
import docStorageRouter from './routes/docStorage';
import meetingRoomsRouter from './routes/meetingRooms';
import mgmtDeliverablesRouter from './routes/mgmtDeliverables';
import workspaceRouter from './routes/workspace';
import libraryRouter from './routes/library';
import messengerRouter from './routes/messenger';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3100;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files (uploads)
app.use('/uploads', express.static('uploads'));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// Routes — M6 시스템관리
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/codes', codesRouter);
app.use('/api/v1/audit-logs', auditLogsRouter);
app.use('/api/v1/backup', backupRouter);

// Routes — M1 프로젝트관리
app.use('/api/v1/projects', projectsRouter);
app.use('/api/v1/projects/:projectId/members', membersRouter);
app.use('/api/v1/projects/:projectId/risks', risksRouter);

// Routes — 요구사항 관리
app.use('/api/v1/projects/:projectId/requirements', requirementsRouter);

// Routes — M2 일정/WBS
app.use('/api/v1/projects/:projectId/wbs', wbsRouter);
app.use('/api/v1/projects/:projectId/milestones', milestonesRouter);

// Routes — M3 산출물관리
app.use('/api/v1/projects/:projectId/deliverables', deliverablesRouter);
app.use('/api/v1/deliverable-masters', deliverableDefsRouter);
app.use('/api/v1/projects/:projectId/deliverable-defs', deliverableDefsRouter);
app.use('/api/v1/methodologies', methodologyRouter);
app.use('/api/v1', methodologyRouter); // /api/v1/projects/:projectId/tailoring/*
app.use('/api/v1/projects/:projectId/approval', approvalRouter);

// Routes — M5 의사소통/협업
app.use('/api/v1/projects/:projectId/issues', issuesRouter);
app.use('/api/v1/notices', noticesRouter);

// Routes — C1 대시보드 + C2 보고서
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/projects/:projectId/reports', reportsRouter);
app.use('/api/v1/projects/:projectId/calendar', calendarRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/projects/:projectId/dev-programs', devProgramsRouter);
app.use('/api/v1/projects/:projectId/doc-storage', docStorageRouter);
app.use('/api/v1/projects/:projectId/meeting-rooms', meetingRoomsRouter);
app.use('/api/v1/projects/:projectId/mgmt-deliverables', mgmtDeliverablesRouter);
app.use('/api/v1/projects/:projectId/workspace', workspaceRouter);
app.use('/api/v1/projects/:projectId/library', libraryRouter);
app.use('/api/v1/messenger', messengerRouter);

// Global error handler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`PMS Server running on port ${PORT}`);
});

export default app;
