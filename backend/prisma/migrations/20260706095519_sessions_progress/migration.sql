-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('IN_TRAINING', 'SUBMITTED', 'APPROVED', 'REPEAT_REQUIRED');

-- CreateTable
CREATE TABLE "SessionTemplate" (
    "id" TEXT NOT NULL,
    "sessionNumber" INTEGER NOT NULL,
    "category" INTEGER NOT NULL,
    "cognitiveVideoUrl" TEXT,
    "behavioralVideoUrl" TEXT,
    "trainingDurationDays" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientSession" (
    "id" TEXT NOT NULL,
    "patientProfileId" TEXT NOT NULL,
    "treatmentPlanId" TEXT NOT NULL,
    "sessionTemplateId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "SessionStatus" NOT NULL DEFAULT 'IN_TRAINING',
    "trainingStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sampleVideoUrl" TEXT,
    "sampleSubmittedAt" TIMESTAMP(3),
    "selfSeverityCurrent" INTEGER,
    "selfSeverityExpectedNext" INTEGER,
    "camperdownPerformanceRating" INTEGER,
    "clientOpinionScore" INTEGER,
    "clinicianOpinionScore" INTEGER,
    "clinicianUserId" TEXT,
    "reviewNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionTemplate_sessionNumber_key" ON "SessionTemplate"("sessionNumber");

-- CreateIndex
CREATE INDEX "PatientSession_patientProfileId_createdAt_idx" ON "PatientSession"("patientProfileId", "createdAt");

-- AddForeignKey
ALTER TABLE "PatientSession" ADD CONSTRAINT "PatientSession_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientSession" ADD CONSTRAINT "PatientSession_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "TreatmentPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientSession" ADD CONSTRAINT "PatientSession_sessionTemplateId_fkey" FOREIGN KEY ("sessionTemplateId") REFERENCES "SessionTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientSession" ADD CONSTRAINT "PatientSession_clinicianUserId_fkey" FOREIGN KEY ("clinicianUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
