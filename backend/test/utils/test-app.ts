import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

export async function createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  const prisma = moduleRef.get(PrismaService);
  return { app, prisma };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.notificationPreference.deleteMany(),
    prisma.notificationSetting.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.questionnaireAnswer.deleteMany(),
    prisma.questionnaireResponse.deleteMany(),
    prisma.questionnaireQuestion.deleteMany(),
    prisma.questionnaireTemplate.deleteMany(),
    prisma.patientMessage.deleteMany(),
    prisma.consultationSlot.deleteMany(),
    prisma.consultation.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.sampleSamplePart.deleteMany(),
    prisma.sampleAttempt.deleteMany(),
    prisma.sampleSession.deleteMany(),
    prisma.speechSample.deleteMany(),
    prisma.trainingEvent.deleteMany(),
    prisma.trainingSession.deleteMany(),
    prisma.trainingCycle72h.deleteMany(),
    prisma.levelVersion.deleteMany(),
    prisma.level.deleteMany(),
    prisma.planExercise.deleteMany(),
    prisma.phaseTransition.deleteMany(),
    prisma.treatmentPlan.deleteMany(),
    prisma.assessment.deleteMany(),
    prisma.exercise.deleteMany(),
    prisma.patientClinicalInfo.deleteMany(),
    prisma.patientProfile.deleteMany(),
    prisma.guardianLink.deleteMany(),
    prisma.session.deleteMany(),
    prisma.otpCode.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}
