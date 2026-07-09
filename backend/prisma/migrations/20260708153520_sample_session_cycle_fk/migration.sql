-- AddForeignKey
ALTER TABLE "SampleSession" ADD CONSTRAINT "SampleSession_trainingCycleId_fkey" FOREIGN KEY ("trainingCycleId") REFERENCES "TrainingCycle72h"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
