-- AlterTable
ALTER TABLE "wbs_task" ADD COLUMN     "weight" DECIMAL(5,2) NOT NULL DEFAULT 1.00;

-- CreateTable
CREATE TABLE "task_dependency" (
    "dep_id" BIGSERIAL NOT NULL,
    "predecessor_id" BIGINT NOT NULL,
    "successor_id" BIGINT NOT NULL,
    "dep_type" VARCHAR(2) NOT NULL DEFAULT 'FS',
    "lag_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependency_pkey" PRIMARY KEY ("dep_id")
);

-- CreateIndex
CREATE INDEX "task_dependency_successor_id_idx" ON "task_dependency"("successor_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependency_predecessor_id_successor_id_key" ON "task_dependency"("predecessor_id", "successor_id");

-- AddForeignKey
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_predecessor_id_fkey" FOREIGN KEY ("predecessor_id") REFERENCES "wbs_task"("task_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_successor_id_fkey" FOREIGN KEY ("successor_id") REFERENCES "wbs_task"("task_id") ON DELETE RESTRICT ON UPDATE CASCADE;
