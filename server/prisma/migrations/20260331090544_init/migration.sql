-- CreateTable
CREATE TABLE "user" (
    "user_id" VARCHAR(50) NOT NULL,
    "user_name" VARCHAR(50) NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "password_hash" VARCHAR(256) NOT NULL,
    "department" VARCHAR(100),
    "position" VARCHAR(50),
    "phone" VARCHAR(20),
    "system_role" VARCHAR(20) NOT NULL DEFAULT 'VIEWER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "project" (
    "project_id" BIGSERIAL NOT NULL,
    "project_name" VARCHAR(200) NOT NULL,
    "business_no" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT '계획',
    "budget_amount" BIGINT NOT NULL DEFAULT 0,
    "client_org" VARCHAR(100),
    "pm_user_id" VARCHAR(50),
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_pkey" PRIMARY KEY ("project_id")
);

-- CreateTable
CREATE TABLE "project_member" (
    "member_id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "user_id" VARCHAR(50) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "join_date" DATE NOT NULL,
    "leave_date" DATE,
    "man_month" DECIMAL(5,2) NOT NULL DEFAULT 0.00,

    CONSTRAINT "project_member_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "wbs_task" (
    "task_id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "parent_task_id" BIGINT,
    "task_name" VARCHAR(200) NOT NULL,
    "phase" VARCHAR(20),
    "depth" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "plan_start" DATE,
    "plan_end" DATE,
    "actual_start" DATE,
    "actual_end" DATE,
    "progress_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "assignee_id" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wbs_task_pkey" PRIMARY KEY ("task_id")
);

-- CreateTable
CREATE TABLE "deliverable" (
    "doc_id" BIGSERIAL NOT NULL,
    "task_id" BIGINT NOT NULL,
    "doc_type" VARCHAR(50) NOT NULL,
    "doc_name" VARCHAR(300) NOT NULL,
    "file_path" VARCHAR(500),
    "file_size" BIGINT NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT '등록',
    "auditor_check" VARCHAR(20) NOT NULL DEFAULT '미점검',
    "uploader_id" VARCHAR(50),
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliverable_pkey" PRIMARY KEY ("doc_id")
);

-- CreateTable
CREATE TABLE "doc_version" (
    "version_id" BIGSERIAL NOT NULL,
    "doc_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "file_path" VARCHAR(500) NOT NULL,
    "file_size" BIGINT NOT NULL DEFAULT 0,
    "change_desc" VARCHAR(500),
    "created_by" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_version_pkey" PRIMARY KEY ("version_id")
);

-- CreateTable
CREATE TABLE "review" (
    "review_id" BIGSERIAL NOT NULL,
    "doc_id" BIGINT NOT NULL,
    "reviewer_id" VARCHAR(50) NOT NULL,
    "result" VARCHAR(20) NOT NULL,
    "comment" TEXT,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_pkey" PRIMARY KEY ("review_id")
);

-- CreateTable
CREATE TABLE "test_case" (
    "tc_id" BIGSERIAL NOT NULL,
    "task_id" BIGINT NOT NULL,
    "tc_name" VARCHAR(300) NOT NULL,
    "test_type" VARCHAR(20) NOT NULL,
    "priority" VARCHAR(10) NOT NULL DEFAULT '보통',
    "precondition" TEXT,
    "steps" TEXT NOT NULL,
    "expected_result" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT '작성중',
    "tester_id" VARCHAR(50),
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_case_pkey" PRIMARY KEY ("tc_id")
);

-- CreateTable
CREATE TABLE "defect" (
    "defect_id" BIGSERIAL NOT NULL,
    "defect_no" VARCHAR(20) NOT NULL,
    "tc_id" BIGINT,
    "project_id" BIGINT NOT NULL,
    "severity" VARCHAR(10) NOT NULL,
    "priority" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT '신규',
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "assignee_id" VARCHAR(50),
    "reporter_id" VARCHAR(50) NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "defect_pkey" PRIMARY KEY ("defect_id")
);

-- CreateTable
CREATE TABLE "risk" (
    "risk_id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "risk_name" VARCHAR(200) NOT NULL,
    "impact_level" VARCHAR(10) NOT NULL,
    "probability" VARCHAR(10) NOT NULL,
    "mitigation_plan" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT '식별',
    "owner_id" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_pkey" PRIMARY KEY ("risk_id")
);

-- CreateTable
CREATE TABLE "issue" (
    "issue_id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "issue_title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "priority" VARCHAR(10) NOT NULL DEFAULT '보통',
    "status" VARCHAR(20) NOT NULL DEFAULT '등록',
    "reporter_id" VARCHAR(50) NOT NULL,
    "assignee_id" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "issue_pkey" PRIMARY KEY ("issue_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "log_id" BIGSERIAL NOT NULL,
    "user_id" VARCHAR(50) NOT NULL,
    "ip_address" VARCHAR(45),
    "action" VARCHAR(20) NOT NULL,
    "target_type" VARCHAR(50),
    "target_id" BIGINT,
    "change_detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("log_id")
);

-- CreateTable
CREATE TABLE "common_code" (
    "code_group" VARCHAR(50) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "code_name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(200),

    CONSTRAINT "common_code_pkey" PRIMARY KEY ("code_group","code")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "project_business_no_key" ON "project"("business_no");

-- CreateIndex
CREATE UNIQUE INDEX "project_member_project_id_user_id_key" ON "project_member"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "wbs_task_project_id_idx" ON "wbs_task"("project_id");

-- CreateIndex
CREATE INDEX "wbs_task_parent_task_id_idx" ON "wbs_task"("parent_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "defect_defect_no_key" ON "defect"("defect_no");

-- CreateIndex
CREATE INDEX "defect_project_id_idx" ON "defect"("project_id");

-- CreateIndex
CREATE INDEX "defect_status_idx" ON "defect"("status");

-- CreateIndex
CREATE INDEX "audit_log_user_id_idx" ON "audit_log"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_pm_user_id_fkey" FOREIGN KEY ("pm_user_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_task" ADD CONSTRAINT "wbs_task_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_task" ADD CONSTRAINT "wbs_task_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "wbs_task"("task_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_task" ADD CONSTRAINT "wbs_task_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable" ADD CONSTRAINT "deliverable_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "wbs_task"("task_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable" ADD CONSTRAINT "deliverable_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_version" ADD CONSTRAINT "doc_version_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "deliverable"("doc_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_version" ADD CONSTRAINT "doc_version_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "deliverable"("doc_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_case" ADD CONSTRAINT "test_case_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "wbs_task"("task_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_case" ADD CONSTRAINT "test_case_tester_id_fkey" FOREIGN KEY ("tester_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect" ADD CONSTRAINT "defect_tc_id_fkey" FOREIGN KEY ("tc_id") REFERENCES "test_case"("tc_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect" ADD CONSTRAINT "defect_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect" ADD CONSTRAINT "defect_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defect" ADD CONSTRAINT "defect_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk" ADD CONSTRAINT "risk_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk" ADD CONSTRAINT "risk_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue" ADD CONSTRAINT "issue_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue" ADD CONSTRAINT "issue_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue" ADD CONSTRAINT "issue_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
