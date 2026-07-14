-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CONSULTATION_REMINDER';

-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "dayBeforeReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "hourBeforeReminderSentAt" TIMESTAMP(3);
