import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SpeechSample } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { TrainingCyclesService } from './training-cycles.service';
import { LevelsService } from './levels.service';
import { ReviewSampleDto } from './dto/review-sample.dto';

@Injectable()
export class SpecialistReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingCyclesService: TrainingCyclesService,
    private readonly levelsService: LevelsService,
  ) {}

  async review(cycleId: string, dto: ReviewSampleDto, actor: AuthenticatedUser): Promise<SpeechSample> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'WAITING_FOR_SPECIALIST' && cycle.status !== 'UNDER_REVIEW') {
      throw new ConflictException(`Cannot review a cycle in status ${cycle.status}`);
    }
    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId }, include: { parts: true } });
    if (!sample) {
      throw new NotFoundException('No submitted sample found for this cycle');
    }

    if (dto.decision === 'TRANSITION') {
      const updatedSample = await this.prisma.speechSample.update({
        where: { id: sample.id },
        data: {
          decision: 'TRANSITION',
          reviewedByUserId: actor.id,
          clinicianOpinionScore: dto.clinicianOpinionScore,
          reviewNotes: dto.reviewNotes,
          reviewedAt: new Date(),
        },
      });
      await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'NEXT_LEVEL_APPROVED', closedAt: new Date() } });
      await this.openNextLevelCycle(cycle);
      return updatedSample;
    }

    if (dto.decision === 'LEVEL_REPEAT') {
      const updatedSample = await this.prisma.speechSample.update({
        where: { id: sample.id },
        data: {
          decision: 'LEVEL_REPEAT',
          reviewedByUserId: actor.id,
          clinicianOpinionScore: dto.clinicianOpinionScore,
          reviewNotes: dto.reviewNotes,
          reviewedAt: new Date(),
        },
      });
      await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'LEVEL_REPEAT_DECIDED', closedAt: new Date() } });
      await this.prisma.trainingCycle72h.create({
        data: {
          patientProfileId: cycle.patientProfileId,
          treatmentPlanId: cycle.treatmentPlanId,
          levelId: cycle.levelId,
          levelVersionId: cycle.levelVersionId,
          cycleNumber: cycle.cycleNumber + 1,
        },
      });
      return updatedSample;
    }

    // TECHNICAL_RERECORD
    const validPartIds = new Set(sample.parts.map((p) => p.id));
    for (const partId of dto.damagedPartIds) {
      if (!validPartIds.has(partId)) {
        throw new NotFoundException(`Sample part ${partId} does not belong to this sample`);
      }
    }
    await this.prisma.$transaction(
      dto.damagedPartIds.map((partId) =>
        this.prisma.sampleSamplePart.update({ where: { id: partId }, data: { technicallyDamaged: true, recordingUrl: null } }),
      ),
    );
    const updatedSample = await this.prisma.speechSample.update({
      where: { id: sample.id },
      data: { reviewedByUserId: actor.id, reviewNotes: dto.reviewNotes, reviewedAt: new Date() },
      include: { parts: true },
    });
    await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'TECHNICAL_PARTIAL_RERECORD' } });
    return updatedSample;
  }

  private async openNextLevelCycle(currentCycle: { patientProfileId: string; treatmentPlanId: string; levelId: string }): Promise<void> {
    const levels = await this.levelsService.list();
    const currentLevel = levels.find((l) => l.id === currentCycle.levelId);
    const nextLevel = levels.find((l) => currentLevel && l.order === currentLevel.order + 1);
    if (!nextLevel) {
      return; // no next level configured yet — program-completion handling is a later sub-project
    }
    const nextVersion = await this.levelsService.getActiveVersion(nextLevel.id);
    await this.prisma.trainingCycle72h.create({
      data: {
        patientProfileId: currentCycle.patientProfileId,
        treatmentPlanId: currentCycle.treatmentPlanId,
        levelId: nextLevel.id,
        levelVersionId: nextVersion.id,
        cycleNumber: 1,
      },
    });
  }
}
