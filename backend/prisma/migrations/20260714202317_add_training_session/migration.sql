-- CreateEnum
CREATE TYPE "TrainingSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL,
    "trainingCycleId" TEXT NOT NULL,
    "status" "TrainingSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "unitsCompleted" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingSession_trainingCycleId_status_idx" ON "TrainingSession"("trainingCycleId", "status");

-- CreateIndex
CREATE INDEX "TrainingSession_trainingCycleId_completedAt_idx" ON "TrainingSession"("trainingCycleId", "completedAt");

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_trainingCycleId_fkey" FOREIGN KEY ("trainingCycleId") REFERENCES "TrainingCycle72h"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TrainingSession_trainingCycleId_in_progress_key"
ON "TrainingSession" ("trainingCycleId")
WHERE "status" = 'IN_PROGRESS';
