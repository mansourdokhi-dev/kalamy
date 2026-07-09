CREATE UNIQUE INDEX "TrainingCycle72h_patientProfileId_open_key"
ON "TrainingCycle72h" ("patientProfileId")
WHERE "closedAt" IS NULL;
