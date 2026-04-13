-- AlterTable
ALTER TABLE "project" ADD COLUMN     "calendar_type" VARCHAR(20) NOT NULL DEFAULT '표준',
ADD COLUMN     "current_date" DATE,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "schedule_mode" VARCHAR(20) NOT NULL DEFAULT 'FORWARD',
ADD COLUMN     "status_date" DATE;
