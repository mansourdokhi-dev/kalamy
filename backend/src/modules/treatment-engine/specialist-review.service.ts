import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SpeechSample } from '@prisma/client';
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

    if (dto.decision === 'TECHNICAL_RERECORD') {
      const validPartIds = new Set(sample.parts.map((p) => p.id));
      for (const partId of dto.damagedPartIds) {
        if (!validPartIds.has(partId)) {
          throw new NotFoundException(`Sample part ${partId} does not belong to this sample`);
        }
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Row-lock the cycle so concurrent review() calls for the same cycle
      // serialize instead of racing — this is the same bug class already
      // found and fixed in recordAttempt/submitSample in this module.
      await tx.$queryRaw`SELECT id FROM "TrainingCycle72h" WHERE id = ${cycleId} FOR UPDATE`;

      const freshCycle = await tx.trainingCycle72h.findUniqueOrThrow({ where: { id: cycleId } });
      if (freshCycle.status !== 'WAITING_FOR_SPECIALIST' && freshCycle.status !== 'UNDER_REVIEW') {
        return { alreadyReviewed: true as const, status: freshCycle.status };
      }

      if (dto.decision === 'TRANSITION') {
        const updatedSample = await tx.speechSample.update({
          where: { id: sample.id },
          data: {
            decision: 'TRANSITION',
            reviewedByUserId: actor.id,
            clinicianOpinionScore: dto.clinicianOpinionScore,
            reviewNotes: dto.reviewNotes,
            reviewedAt: new Date(),
          },
        });
        await tx.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'NEXT_LEVEL_APPROVED', closedAt: new Date() } });
        await this.openNextLevelCycle(tx, freshCycle);
        return { alreadyReviewed: false as const, sample: updatedSample };
      }

      if (dto.decision === 'LEVEL_REPEAT') {
        const updatedSample = await tx.speechSample.update({
          where: { id: sample.id },
          data: {
            decision: 'LEVEL_REPEAT',
            reviewedByUserId: actor.id,
            clinicianOpinionScore: dto.clinicianOpinionScore,
            reviewNotes: dto.reviewNotes,
            reviewedAt: new Date(),
          },
        });
        await tx.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'LEVEL_REPEAT_DECIDED', closedAt: new Date() } });
        await tx.trainingCycle72h.create({
          data: {
            patientProfileId: freshCycle.patientProfileId,
            treatmentPlanId: freshCycle.treatmentPlanId,
            levelId: freshCycle.levelId,
            levelVersionId: freshCycle.levelVersionId,
            cycleNumber: freshCycle.cycleNumber + 1,
          },
        });
        return { alreadyReviewed: false as const, sample: updatedSample };
      }

      // TECHNICAL_RERECORD
      await Promise.all(
        dto.damagedPartIds.map((partId) =>
          tx.sampleSamplePart.update({ where: { id: partId }, data: { technicallyDamaged: true, recordingUrl: null } }),
        ),
      );
      const updatedSample = await tx.speechSample.update({
        where: { id: sample.id },
        // decision intentionally stays null here: TECHNICAL_RERECORD is a
        // deferral pending re-recording, not a clinical progression verdict.
        // The per-part technicallyDamaged/recordingUrl fields already record
        // what happened; decision is reserved for an eventual real
        // TRANSITION/LEVEL_REPEAT once the sample is complete again.
        data: { reviewedByUserId: actor.id, reviewNotes: dto.reviewNotes, reviewedAt: new Date() },
        include: { parts: true },
      });
      await tx.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'TECHNICAL_PARTIAL_RERECORD' } });
      return { alreadyReviewed: false as const, sample: updatedSample };
    });

    if (result.alreadyReviewed) {
      throw new ConflictException(`Cannot review a cycle in status ${result.status}`);
    }
    return result.sample;
  }

  private async openNextLevelCycle(
    tx: Prisma.TransactionClient,
    currentCycle: { patientProfileId: string; treatmentPlanId: string; levelId: string },
  ): Promise<void> {
    const levels = await this.levelsService.list();
    const currentLevel = levels.find((l) => l.id === currentCycle.levelId);
    const nextLevel = levels.find((l) => currentLevel && l.order === currentLevel.order + 1);
    if (!nextLevel) {
      return; // no next level configured yet — program-completion handling is a later sub-project
    }
    const nextVersion = await this.levelsService.getActiveVersion(nextLevel.id);
    await tx.trainingCycle72h.create({
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
