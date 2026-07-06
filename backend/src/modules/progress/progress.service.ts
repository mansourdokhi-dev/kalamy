import { Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

export interface ProgressDashboard {
  currentSessionNumber: number | null;
  sessionsApproved: number;
  totalAttempts: number;
  repeatedSessionNumbers: number[];
  daysInProgram: number;
}

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
  ) {}

  async getDashboard(patientProfileId: string, actor: AuthenticatedUser): Promise<ProgressDashboard> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const sessions = await this.prisma.patientSession.findMany({
      where: { patientProfileId },
      include: { sessionTemplate: true },
      orderBy: { createdAt: 'asc' },
    });

    if (sessions.length === 0) {
      return { currentSessionNumber: null, sessionsApproved: 0, totalAttempts: 0, repeatedSessionNumbers: [], daysInProgram: 0 };
    }

    const approvedSessionNumbers = new Set(
      sessions.filter((s) => s.status === 'APPROVED').map((s) => s.sessionTemplate.sessionNumber),
    );

    const attemptCountBySessionNumber = new Map<number, number>();
    for (const s of sessions) {
      const n = s.sessionTemplate.sessionNumber;
      attemptCountBySessionNumber.set(n, (attemptCountBySessionNumber.get(n) ?? 0) + 1);
    }
    const repeatedSessionNumbers = [...attemptCountBySessionNumber.entries()]
      .filter(([, count]) => count > 1)
      .map(([sessionNumber]) => sessionNumber)
      .sort((a, b) => a - b);

    const latest = sessions[sessions.length - 1];
    const first = sessions[0];
    const daysInProgram = Math.floor((Date.now() - first.trainingStartedAt.getTime()) / (24 * 60 * 60 * 1000));

    return {
      currentSessionNumber: latest.sessionTemplate.sessionNumber,
      sessionsApproved: approvedSessionNumbers.size,
      totalAttempts: sessions.length,
      repeatedSessionNumbers,
      daysInProgram,
    };
  }

  private async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }
}
