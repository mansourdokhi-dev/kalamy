-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SPECIALIST_WORKLOAD_REMINDER';

-- AlterTable
ALTER TABLE "SpeechSample" ADD COLUMN     "deadlineReminderSentAt" TIMESTAMP(3);
