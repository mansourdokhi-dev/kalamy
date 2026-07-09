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

    // TODO(Task 9): rebuild against Level/TrainingCycle72h/SpeechSample.
    // Placeholder keeps the endpoint compiling and returning a defined,
    // honest "no data yet" shape until Task 9 lands.
    return { currentSessionNumber: null, sessionsApproved: 0, totalAttempts: 0, repeatedSessionNumbers: [], daysInProgram: 0 };
  }

  private async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }
}
