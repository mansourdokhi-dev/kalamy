/*
  Warnings:

  - Added the required column `fileSizeBytes` to the `SampleAttempt` table without a default value. This is not possible if the table is not empty.
  - Added the required column `mimeType` to the `SampleAttempt` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable (added nullable first so pre-existing rows can be backfilled below)
ALTER TABLE "SampleAttempt" ADD COLUMN     "durationSeconds" INTEGER,
ADD COLUMN     "fileSizeBytes" INTEGER,
ADD COLUMN     "mimeType" TEXT;

-- Backfill pre-existing rows (from before this project's video-capture switch) with placeholder values
UPDATE "SampleAttempt" SET "fileSizeBytes" = 0, "mimeType" = 'audio/m4a' WHERE "fileSizeBytes" IS NULL;

-- Now enforce NOT NULL, matching the Prisma schema declaration
ALTER TABLE "SampleAttempt" ALTER COLUMN "fileSizeBytes" SET NOT NULL,
ALTER COLUMN "mimeType" SET NOT NULL;

-- AlterTable
ALTER TABLE "SampleSamplePart" ADD COLUMN     "durationSeconds" INTEGER,
ADD COLUMN     "fileSizeBytes" INTEGER,
ADD COLUMN     "mimeType" TEXT;
