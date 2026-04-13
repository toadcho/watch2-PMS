-- AlterTable
ALTER TABLE "wbs_task" ADD COLUMN     "actual_md" INTEGER,
ADD COLUMN     "actual_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "baseline_end" DATE,
ADD COLUMN     "baseline_start" DATE,
ADD COLUMN     "task_role" VARCHAR(50);
