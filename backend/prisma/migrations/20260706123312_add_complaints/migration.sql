-- CreateEnum
CREATE TYPE "ComplaintType" AS ENUM ('COMPLAINT', 'SUGGESTION');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'REVIEWED', 'RESOLVED');

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "relatedClinicianUserId" TEXT,
    "type" "ComplaintType" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Complaint_status_idx" ON "Complaint"("status");

-- CreateIndex
CREATE INDEX "Complaint_relatedClinicianUserId_idx" ON "Complaint"("relatedClinicianUserId");

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_relatedClinicianUserId_fkey" FOREIGN KEY ("relatedClinicianUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
