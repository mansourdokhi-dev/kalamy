-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('INITIAL', 'PERIODIC', 'FINAL');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "SeverityCategory" AS ENUM ('MILD', 'MODERATE', 'SEVERE', 'VERY_SEVERE');

-- CreateEnum
CREATE TYPE "TreatmentPhase" AS ENUM ('PHASE_1', 'PHASE_2', 'PHASE_3', 'PHASE_4', 'PHASE_5');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ExerciseStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "patientProfileId" TEXT NOT NULL,
    "clinicianUserId" TEXT NOT NULL,
    "type" "AssessmentType" NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "medicalHistory" TEXT,
    "difficultSituations" TEXT,
    "anxietyLevel" TEXT,
    "initialGoals" TEXT,
    "clinicianNotes" TEXT,
    "ssi4Frequency" INTEGER,
    "ssi4Duration" INTEGER,
    "ssi4PhysicalConcomitants" INTEGER,
    "ssi4Total" INTEGER,
    "severityCategory" "SeverityCategory",
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentPlan" (
    "id" TEXT NOT NULL,
    "patientProfileId" TEXT NOT NULL,
    "clinicianUserId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "phase" "TreatmentPhase" NOT NULL DEFAULT 'PHASE_1',
    "goals" TEXT NOT NULL,
    "reviewDate" TIMESTAMP(3) NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreatmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseTransition" (
    "id" TEXT NOT NULL,
    "treatmentPlanId" TEXT NOT NULL,
    "fromPhase" "TreatmentPhase" NOT NULL,
    "toPhase" "TreatmentPhase" NOT NULL,
    "clinicianUserId" TEXT NOT NULL,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhaseTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "phaseLevel" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "status" "ExerciseStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanExercise" (
    "id" TEXT NOT NULL,
    "treatmentPlanId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "frequencyPerWeek" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanExercise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Assessment_patientProfileId_createdAt_idx" ON "Assessment"("patientProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "TreatmentPlan_patientProfileId_status_idx" ON "TreatmentPlan"("patientProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlanExercise_treatmentPlanId_exerciseId_key" ON "PlanExercise"("treatmentPlanId", "exerciseId");

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_clinicianUserId_fkey" FOREIGN KEY ("clinicianUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_clinicianUserId_fkey" FOREIGN KEY ("clinicianUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseTransition" ADD CONSTRAINT "PhaseTransition_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "TreatmentPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseTransition" ADD CONSTRAINT "PhaseTransition_clinicianUserId_fkey" FOREIGN KEY ("clinicianUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExercise" ADD CONSTRAINT "PlanExercise_treatmentPlanId_fkey" FOREIGN KEY ("treatmentPlanId") REFERENCES "TreatmentPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanExercise" ADD CONSTRAINT "PlanExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
