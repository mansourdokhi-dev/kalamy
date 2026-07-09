/*
  Warnings:

  - You are about to drop the `PatientSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SessionTemplate` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "LevelCycleStatus" AS ENUM ('ACTIVE_LEVEL_TRAINING', 'SAMPLE_ELIGIBLE', 'SAMPLE_PREPARATION', 'SAMPLE_SUBMITTED', 'WAITING_FOR_SPECIALIST', 'UNDER_REVIEW', 'DIRECT_INTERVENTION_REQUIRED', 'WAITING_FINAL_DECISION_AFTER_INTERVENTION', 'TECHNICAL_PARTIAL_RERECORD', 'LEVEL_REPEAT_DECIDED', 'NEXT_LEVEL_APPROVED', 'CLOSED_DUE_TO_INACTIVITY', 'SUBSCRIPTION_EXPIRED_CLINICAL_FLOW_OPEN');

-- CreateEnum
CREATE TYPE "SpecialistDecision" AS ENUM ('TRANSITION', 'LEVEL_REPEAT', 'TECHNICAL_RERECORD');

-- CreateEnum
CREATE TYPE "SampleSessionStatus" AS ENUM ('OPEN', 'CLOSED_SUBMITTED', 'CLOSED_EXHAUSTED');

-- DropForeignKey
ALTER TABLE "PatientSession" DROP CONSTRAINT "PatientSession_clinicianUserId_fkey";

-- DropForeignKey
ALTER TABLE "PatientSession" DROP CONSTRAINT "PatientSession_patientProfileId_fkey";

-- DropForeignKey
ALTER TABLE "PatientSession" DROP CONSTRAINT "PatientSession_sessionTemplateId_fkey";

-- DropForeignKey
ALTER TABLE "PatientSession" DROP CONSTRAINT "PatientSession_treatmentPlanId_fkey";

-- DropTable
DROP TABLE "PatientSession";

-- DropTable
DROP TABLE "SessionTemplate";

-- DropEnum
DROP TYPE "SessionStatus";

-- CreateTable
CREATE TABLE "Level" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "ExerciseStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelVersion" (
    "id" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "cognitiveVideo1Url" TEXT,
    "cognitiveVideo1Question" TEXT,
    "cognitiveVideo2Url" TEXT,
    "cognitiveVideo2Question" TEXT,
    "behavioralTechnique" TEXT NOT NULL,
    "humanModelVideoUrl" TEXT,
    "humanModelDurationSeconds" INTEGER,
    "trainingListJson" TEXT NOT NULL,
    "samplePartTemplateJson" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LevelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingCycle72h" (
    "id" TEXT NOT NULL,
    "patientProfileId" TEXT NOT NULL,
    "treatmentPlanId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "levelVersionId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "status" "LevelCycleStatus" NOT NULL DEFAULT 'ACTIVE_LEVEL_TRAINING',
    "humanModelWatchedAt" TIMESTAMP(3),
    "firstTrainingEventAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingCycle72h_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingEvent" (
    "id" TEXT NOT NULL,
    "trainingCycleId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationSeconds" INTEGER,
    "unitsCompleted" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleSession" (
    "id" TEXT NOT NULL,
    "trainingCycleId" TEXT NOT NULL,
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "status" "SampleSessionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SampleSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleAttempt" (
    "id" TEXT NOT NULL,
    "sampleSessionId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "recordingUrl" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SampleAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeechSample" (
    "id" TEXT NOT NULL,
    "trainingCycleId" TEXT NOT NULL,
    "selfSeverityCurrent" INTEGER,
    "selfSeverityExpectedNext" INTEGER,
    "camperdownPerformanceRating" INTEGER,
    "clientOpinionScore" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "clinicianOpinionScore" INTEGER,
    "reviewNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decision" "SpecialistDecision",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeechSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleSamplePart" (
    "id" TEXT NOT NULL,
    "speechSampleId" TEXT NOT NULL,
    "sourceAttemptId" TEXT,
    "partType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "recordingUrl" TEXT,
    "technicallyDamaged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SampleSamplePart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Level_order_key" ON "Level"("order");

-- CreateIndex
CREATE UNIQUE INDEX "LevelVersion_levelId_versionNumber_key" ON "LevelVersion"("levelId", "versionNumber");

-- CreateIndex
CREATE INDEX "TrainingCycle72h_patientProfileId_createdAt_idx" ON "TrainingCycle72h"("patientProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "TrainingCycle72h_treatmentPlanId_levelId_idx" ON "TrainingCycle72h"("treatmentPlanId", "levelId");

-- CreateIndex
CREATE INDEX "TrainingEvent_trainingCycleId_occurredAt_idx" ON "TrainingEvent"("trainingCycleId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SampleSession_trainingCycleId_key" ON "SampleSession"("trainingCycleId");

-- CreateIndex
CREATE INDEX "SampleAttempt_sampleSessionId_attemptNumber_idx" ON "SampleAttempt"("sampleSessionId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SpeechSample_trainingCycleId_key" ON "SpeechSample"("trainingCycleId");

-- CreateIndex
CREATE INDEX "SampleSamplePart_speechSampleId_order_idx" ON "SampleSamplePart"("speechSampleId", "order");

-- AddForeignKey
ALTER TABLE "LevelVersion" ADD CONSTRAINT "LevelVersion_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCycle72h" ADD CONSTRAINT "TrainingCycle72h_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCycle72h" ADD CONSTRAINT "TrainingCycle72h_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "TreatmentPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCycle72h" ADD CONSTRAINT "TrainingCycle72h_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCycle72h" ADD CONSTRAINT "TrainingCycle72h_levelVersionId_fkey" FOREIGN KEY ("levelVersionId") REFERENCES "LevelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEvent" ADD CONSTRAINT "TrainingEvent_trainingCycleId_fkey" FOREIGN KEY ("trainingCycleId") REFERENCES "TrainingCycle72h"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleAttempt" ADD CONSTRAINT "SampleAttempt_sampleSessionId_fkey" FOREIGN KEY ("sampleSessionId") REFERENCES "SampleSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeechSample" ADD CONSTRAINT "SpeechSample_trainingCycleId_fkey" FOREIGN KEY ("trainingCycleId") REFERENCES "TrainingCycle72h"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeechSample" ADD CONSTRAINT "SpeechSample_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleSamplePart" ADD CONSTRAINT "SampleSamplePart_speechSampleId_fkey" FOREIGN KEY ("speechSampleId") REFERENCES "SpeechSample"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleSamplePart" ADD CONSTRAINT "SampleSamplePart_sourceAttemptId_fkey" FOREIGN KEY ("sourceAttemptId") REFERENCES "SampleAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
