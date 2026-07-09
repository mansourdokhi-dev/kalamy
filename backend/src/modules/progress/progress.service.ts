import { Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

export interface ProgressDashboard {
  currentLevelName: string | null;
  currentLevelOrder: number | null;
  levelsCompleted: number;
  totalTrainingEvents: number;
  repeatedLevelOrders: number[];
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

    const cycles = await this.prisma.trainingCycle72h.findMany({
      where: { patientProfileId },
      include: { level: true },
      orderBy: { createdAt: 'asc' },
    });

    if (cycles.length === 0) {
      return { currentLevelName: null, currentLevelOrder: null, levelsCompleted: 0, totalTrainingEvents: 0, repeatedLevelOrders: [], daysInProgram: 0 };
    }

    const completedLevelOrders = new Set(
      cycles.filter((c) => c.status === 'NEXT_LEVEL_APPROVED').map((c) => c.level.order),
    );

    const cycleCountByLevelOrder = new Map<number, number>();
    for (const c of cycles) {
      cycleCountByLevelOrder.set(c.level.order, (cycleCountByLevelOrder.get(c.level.order) ?? 0) + 1);
    }
    const repeatedLevelOrders = [...cycleCountByLevelOrder.entries()]
      .filter(([, count]) => count > 1)
      .map(([order]) => order)
      .sort((a, b) => a - b);

    const totalTrainingEvents = await this.prisma.trainingEvent.count({
      where: { trainingCycle: { patientProfileId } },
    });

    const latest = cycles[cycles.length - 1];
    const first = cycles[0];
    const daysInProgram = Math.floor((Date.now() - first.createdAt.getTime()) / (24 * 60 * 60 * 1000));

    return {
      currentLevelName: latest.level.name,
      currentLevelOrder: latest.level.order,
      levelsCompleted: completedLevelOrders.size,
      totalTrainingEvents,
      repeatedLevelOrders,
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
