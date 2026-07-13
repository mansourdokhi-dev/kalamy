-- CreateEnum
CREATE TYPE "InterventionType" AS ENUM ('VIDEO_MEETING', 'VOICE_CONSULTATION', 'TARGETED_MESSAGE', 'CLINICAL_ACTION');

-- CreateEnum
CREATE TYPE "ConsultationType" AS ENUM ('VIDEO', 'VOICE');

-- CreateEnum
CREATE TYPE "ConsultationStatus" AS ENUM ('REQUESTED', 'SCHEDULING', 'SCHEDULED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "SpeechSample" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "interventionCompletedAt" TIMESTAMP(3),
ADD COLUMN     "interventionDeadlineAt" TIMESTAMP(3),
ADD COLUMN     "interventionExecutedByUserId" TEXT,
ADD COLUMN     "interventionOutcomeNotes" TEXT,
ADD COLUMN     "interventionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "interventionType" "InterventionType",
ADD COLUMN     "reservedAt" TIMESTAMP(3),
ADD COLUMN     "reservedByUserId" TEXT,
ADD COLUMN     "reviewDeadlineAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Consultation" (
    "id" TEXT NOT NULL,
    "patientProfileId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "type" "ConsultationType" NOT NULL,
    "status" "ConsultationStatus" NOT NULL DEFAULT 'REQUESTED',
    "reasonNote" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "externalMeetingLink" TEXT,
    "specialistUserId" TEXT,
    "outcomeNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Consultation_patientProfileId_idx" ON "Consultation"("patientProfileId");

-- AddForeignKey
ALTER TABLE "SpeechSample" ADD CONSTRAINT "SpeechSample_reservedByUserId_fkey" FOREIGN KEY ("reservedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeechSample" ADD CONSTRAINT "SpeechSample_interventionExecutedByUserId_fkey" FOREIGN KEY ("interventionExecutedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_specialistUserId_fkey" FOREIGN KEY ("specialistUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
