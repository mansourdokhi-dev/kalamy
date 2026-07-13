import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SpeechSample, TrainingCycle72h } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { TrainingCyclesService } from './training-cycles.service';
import { LevelsService } from './levels.service';
import { ReviewSampleDto } from './dto/review-sample.dto';
import { RequestInterventionDto } from './dto/request-intervention.dto';
import { CompleteInterventionDto } from './dto/complete-intervention.dto';
import { TransferReviewDto } from './dto/transfer-review.dto';
import { hasPermission, Permission } from '../../common/rbac/permissions';

const REVIEW_BOOKING_WINDOW_MS = 24 * 60 * 60 * 1000; // §9: escalate if unreserved 24h after submission
const REVIEW_DECISION_WINDOW_MS = 48 * 60 * 60 * 1000; // §9: auto-release if undecided 48h after reservation

@Injectable()
export class SpecialistReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingCyclesService: TrainingCyclesService,
    private readonly levelsService: LevelsService,
  ) {}

  async review(cycleId: string, dto: ReviewSampleDto, actor: AuthenticatedUser): Promise<SpeechSample> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const reviewableStatuses = ['WAITING_FOR_SPECIALIST', 'UNDER_REVIEW', 'WAITING_FINAL_DECISION_AFTER_INTERVENTION'];
    if (!reviewableStatuses.includes(cycle.status)) {
      throw new ConflictException(`Cannot review a cycle in status ${cycle.status}`);
    }

    await this.evaluateReviewDeadlines(cycleId);
    const freshCycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (!reviewableStatuses.includes(freshCycle.status)) {
      throw new ConflictException(`Cannot review a cycle in status ${freshCycle.status}`);
    }

    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId }, include: { parts: true } });
    if (!sample) {
      throw new NotFoundException('No submitted sample found for this cycle');
    }
    if (sample.reservedByUserId && sample.reservedByUserId !== actor.id) {
      throw new ForbiddenException('This sample is reserved by a different specialist');
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
      if (!reviewableStatuses.includes(freshCycle.status)) {
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
          tx.sampleSamplePart.update({
            where: { id: partId },
            data: { technicallyDamaged: true, recordingUrl: null, mimeType: null, fileSizeBytes: null, durationSeconds: null },
          }),
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

  /**
   * Applies any SLA transition that is due as of now (escalation or auto-release),
   * then returns the fresh cycle+sample. Called first by every method that acts on
   * a reviewable sample, mirroring the lazy CLOSED_DUE_TO_INACTIVITY check in
   * TrainingCyclesService.getCurrent — no background job exists for this (see design
   * spec's scope decision on lazy SLA evaluation).
   */
  async evaluateReviewDeadlines(cycleId: string): Promise<{ cycle: TrainingCycle72h; sample: SpeechSample }> {
    const cycle = await this.prisma.trainingCycle72h.findUniqueOrThrow({ where: { id: cycleId } });
    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId } });
    if (!sample) {
      // Every status this method is ever called for (WAITING_FOR_SPECIALIST onward) implies a
      // submitted sample already exists — this is a genuine invariant violation, not a normal
      // "not found" a caller should handle differently, so every caller's own re-fetch-and-throw
      // never actually needs to run. Fail loudly rather than silently returning a fake value.
      throw new NotFoundException('No submitted sample found for this cycle');
    }

    if (
      cycle.status === 'WAITING_FOR_SPECIALIST' &&
      sample.submittedAt &&
      !sample.reservedByUserId &&
      !sample.escalatedAt &&
      Date.now() - sample.submittedAt.getTime() > REVIEW_BOOKING_WINDOW_MS
    ) {
      const updatedSample = await this.prisma.speechSample.update({ where: { id: sample.id }, data: { escalatedAt: new Date() } });
      return { cycle, sample: updatedSample };
    }

    const inDecisionWindow = cycle.status === 'UNDER_REVIEW' || cycle.status === 'WAITING_FINAL_DECISION_AFTER_INTERVENTION';
    if (inDecisionWindow && sample.reviewDeadlineAt && Date.now() > sample.reviewDeadlineAt.getTime()) {
      const releasedFromUserId = sample.reservedByUserId;
      const { updatedCycle, updatedSample } = await this.prisma.$transaction(async (tx) => {
        const updatedCycle = await tx.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'WAITING_FOR_SPECIALIST' } });
        const updatedSample = await tx.speechSample.update({
          where: { id: sample.id },
          data: { reservedByUserId: null, reservedAt: null, reviewDeadlineAt: null },
        });
        await tx.auditLog.create({
          data: {
            userId: releasedFromUserId,
            action: 'REVIEW_RESERVATION_AUTO_RELEASED',
            entity: 'SpeechSample',
            entityId: sample.id,
            before: { reservedByUserId: releasedFromUserId },
            after: { reservedByUserId: null },
          },
        });
        return { updatedCycle, updatedSample };
      });
      return { cycle: updatedCycle, sample: updatedSample };
    }

    if (
      cycle.status === 'DIRECT_INTERVENTION_REQUIRED' &&
      sample.interventionDeadlineAt &&
      !sample.escalatedAt &&
      Date.now() > sample.interventionDeadlineAt.getTime()
    ) {
      const updatedSample = await this.prisma.speechSample.update({ where: { id: sample.id }, data: { escalatedAt: new Date() } });
      return { cycle, sample: updatedSample };
    }

    return { cycle, sample };
  }

  async listAvailableSamples(): Promise<Array<TrainingCycle72h & { speechSample: SpeechSample | null; patientProfile: { id: string; fullName: string } }>> {
    const cycles = await this.prisma.trainingCycle72h.findMany({
      where: { status: 'WAITING_FOR_SPECIALIST' },
      include: { speechSample: true, patientProfile: { select: { id: true, fullName: true } } },
      orderBy: { updatedAt: 'asc' },
    });
    const evaluated = await Promise.all(cycles.map((c) => this.evaluateReviewDeadlines(c.id)));
    return cycles.map((c, i) => ({ ...c, speechSample: evaluated[i].sample }));
  }

  async reserve(cycleId: string, actor: AuthenticatedUser): Promise<SpeechSample> {
    await this.evaluateReviewDeadlines(cycleId);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "TrainingCycle72h" WHERE id = ${cycleId} FOR UPDATE`;

      const cycle = await tx.trainingCycle72h.findUniqueOrThrow({ where: { id: cycleId } });
      if (cycle.status !== 'WAITING_FOR_SPECIALIST') {
        throw new ConflictException(`Cannot reserve a cycle in status ${cycle.status}`);
      }
      const sample = await tx.speechSample.findUnique({ where: { trainingCycleId: cycleId } });
      if (!sample) {
        throw new NotFoundException('No submitted sample found for this cycle');
      }
      if (sample.reservedByUserId) {
        throw new ConflictException('This sample is already reserved by another specialist');
      }

      await tx.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'UNDER_REVIEW' } });
      return tx.speechSample.update({
        where: { id: sample.id },
        data: {
          reservedByUserId: actor.id,
          reservedAt: new Date(),
          reviewDeadlineAt: new Date(Date.now() + REVIEW_DECISION_WINDOW_MS),
          escalatedAt: null,
        },
      });
    });
  }

  async transferResponsibility(cycleId: string, dto: TransferReviewDto, actor: AuthenticatedUser): Promise<SpeechSample> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId } });
    if (!sample) {
      throw new NotFoundException('No submitted sample found for this cycle');
    }
    if (!['UNDER_REVIEW', 'DIRECT_INTERVENTION_REQUIRED', 'WAITING_FINAL_DECISION_AFTER_INTERVENTION'].includes(cycle.status)) {
      throw new ConflictException(`Cannot transfer responsibility from status ${cycle.status}`);
    }

    // reservedByUserId is a real FK to User — an unvalidated toUserId would otherwise surface as
    // an unhandled FK-violation 500 instead of a clean error, and a transfer to someone who can't
    // hold a reservation (e.g. a PATIENT or another SUPERVISOR) would strand the review with nobody
    // able to act on it. Mirrors the damagedPartIds validation pattern in review() above.
    const targetUser = await this.prisma.user.findUnique({ where: { id: dto.toUserId } });
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }
    if (!hasPermission(targetUser.role, Permission.REVIEW_SAMPLE)) {
      throw new ConflictException('Target user is not eligible to hold a review reservation');
    }

    const previousReviewerUserId = sample.reservedByUserId;
    const [, updatedSample] = await this.prisma.$transaction([
      this.prisma.auditLog.create({
        data: {
          userId: actor.id,
          action: 'REVIEW_RESPONSIBILITY_TRANSFERRED',
          entity: 'SpeechSample',
          entityId: sample.id,
          before: { reservedByUserId: previousReviewerUserId },
          after: { reservedByUserId: dto.toUserId },
        },
      }),
      this.prisma.speechSample.update({ where: { id: sample.id }, data: { reservedByUserId: dto.toUserId } }),
    ]);
    return updatedSample;
  }

  async requestIntervention(cycleId: string, dto: RequestInterventionDto, actor: AuthenticatedUser): Promise<SpeechSample> {
    await this.evaluateReviewDeadlines(cycleId);
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'UNDER_REVIEW') {
      throw new ConflictException(`Cannot request intervention from status ${cycle.status}`);
    }
    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId } });
    if (!sample) {
      throw new NotFoundException('No submitted sample found for this cycle');
    }
    if (sample.reservedByUserId !== actor.id) {
      throw new ForbiddenException('Only the specialist holding the reservation can request intervention');
    }

    await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'DIRECT_INTERVENTION_REQUIRED' } });
    return this.prisma.speechSample.update({
      where: { id: sample.id },
      data: {
        interventionType: dto.interventionType,
        interventionRequestedAt: new Date(),
        interventionDeadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        interventionOutcomeNotes: dto.reasonNote,
        // §11: the first review deadline is paused, not extended — a fresh 48h starts only once
        // the intervention is documented complete (see completeIntervention below).
        reviewDeadlineAt: null,
      },
    });
  }

  async completeIntervention(cycleId: string, dto: CompleteInterventionDto, actor: AuthenticatedUser): Promise<SpeechSample> {
    await this.evaluateReviewDeadlines(cycleId);
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'DIRECT_INTERVENTION_REQUIRED') {
      throw new ConflictException(`Cannot complete intervention from status ${cycle.status}`);
    }
    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId } });
    if (!sample) {
      throw new NotFoundException('No submitted sample found for this cycle');
    }
    if (sample.reservedByUserId !== actor.id) {
      throw new ForbiddenException('Only the specialist holding the reservation can complete this intervention');
    }

    await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'WAITING_FINAL_DECISION_AFTER_INTERVENTION' } });
    return this.prisma.speechSample.update({
      where: { id: sample.id },
      data: {
        interventionExecutedByUserId: actor.id,
        interventionCompletedAt: new Date(),
        interventionOutcomeNotes: dto.outcomeNotes,
        reviewDeadlineAt: new Date(Date.now() + REVIEW_DECISION_WINDOW_MS),
      },
    });
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
