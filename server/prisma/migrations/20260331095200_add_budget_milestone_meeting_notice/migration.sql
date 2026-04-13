-- CreateTable
CREATE TABLE "budget_item" (
    "budget_id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "item_name" VARCHAR(200) NOT NULL,
    "item_type" VARCHAR(50) NOT NULL,
    "plan_amount" BIGINT NOT NULL DEFAULT 0,
    "actual_amount" BIGINT NOT NULL DEFAULT 0,
    "description" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_item_pkey" PRIMARY KEY ("budget_id")
);

-- CreateTable
CREATE TABLE "milestone" (
    "milestone_id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "milestone_name" VARCHAR(200) NOT NULL,
    "due_date" DATE NOT NULL,
    "milestone_type" VARCHAR(50) NOT NULL DEFAULT '기타',
    "status" VARCHAR(20) NOT NULL DEFAULT '예정',
    "description" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_pkey" PRIMARY KEY ("milestone_id")
);

-- CreateTable
CREATE TABLE "meeting" (
    "meeting_id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "meeting_title" VARCHAR(300) NOT NULL,
    "meeting_date" DATE NOT NULL,
    "location" VARCHAR(200),
    "attendees" TEXT,
    "agenda" TEXT,
    "decisions" TEXT,
    "action_items" TEXT,
    "writer_id" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_pkey" PRIMARY KEY ("meeting_id")
);

-- CreateTable
CREATE TABLE "notice" (
    "notice_id" BIGSERIAL NOT NULL,
    "project_id" BIGINT,
    "title" VARCHAR(300) NOT NULL,
    "content" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "writer_id" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notice_pkey" PRIMARY KEY ("notice_id")
);

-- CreateIndex
CREATE INDEX "milestone_project_id_idx" ON "milestone"("project_id");

-- CreateIndex
CREATE INDEX "meeting_project_id_idx" ON "meeting"("project_id");

-- CreateIndex
CREATE INDEX "notice_project_id_idx" ON "notice"("project_id");

-- AddForeignKey
ALTER TABLE "budget_item" ADD CONSTRAINT "budget_item_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_writer_id_fkey" FOREIGN KEY ("writer_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice" ADD CONSTRAINT "notice_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("project_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice" ADD CONSTRAINT "notice_writer_id_fkey" FOREIGN KEY ("writer_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
