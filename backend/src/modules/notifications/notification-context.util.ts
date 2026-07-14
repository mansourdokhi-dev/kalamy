import { PrismaService } from '../../prisma/prisma.service';

export async function getNotificationContext(
  prisma: PrismaService,
  cycle: { patientProfileId: string; levelId: string },
): Promise<{ patientName: string; levelName: string }> {
  const [patientProfile, level] = await Promise.all([
    prisma.patientProfile.findUniqueOrThrow({ where: { id: cycle.patientProfileId } }),
    prisma.level.findUniqueOrThrow({ where: { id: cycle.levelId } }),
  ]);
  return { patientName: patientProfile.fullName, levelName: level.name };
}
