-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP';

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "key" TEXT NOT NULL,
    "valueMs" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("key")
);
