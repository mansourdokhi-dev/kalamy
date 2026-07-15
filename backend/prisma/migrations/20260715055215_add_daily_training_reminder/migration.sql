-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'DAILY_TRAINING_REMINDER';

-- AlterTable
ALTER TABLE "TrainingCycle72h" ADD COLUMN     "lastDailyReminderSentAt" TIMESTAMP(3);
