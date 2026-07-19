-- CreateTable
CREATE TABLE "PatientMessage" (
    "id" TEXT NOT NULL,
    "patientProfileId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientMessage_patientProfileId_createdAt_idx" ON "PatientMessage"("patientProfileId", "createdAt");

-- AddForeignKey
ALTER TABLE "PatientMessage" ADD CONSTRAINT "PatientMessage_patientProfileId_fkey" FOREIGN KEY ("patientProfileId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMessage" ADD CONSTRAINT "PatientMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
