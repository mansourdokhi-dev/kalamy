import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SampleAttempt, SampleSession, SpeechSample, SampleSamplePart } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { TrainingCyclesService } from './training-cycles.service';
import { RecordAttemptDto } from './dto/record-attempt.dto';
import { SubmitSampleDto } from './dto/submit-sample.dto';
import { RerecordPartsDto } from './dto/rerecord-parts.dto';

const MAX_ATTEMPTS = 10;

@Injectable()
export class SamplesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingCyclesService: TrainingCyclesService,
  ) {}

  async openSession(cycleId: string, actor: AuthenticatedUser): Promise<SampleSession> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'SAMPLE_ELIGIBLE') {
      throw new ConflictException(`Cannot open a sample session from status ${cycle.status}`);
    }

    const existing = await this.prisma.sampleSession.findUnique({ where: { trainingCycleId: cycleId } });
    if (existing) {
      return existing;
    }

    await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'SAMPLE_PREPARATION' } });
    try {
      return await this.prisma.sampleSession.create({ data: { trainingCycleId: cycleId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.sampleSession.findUniqueOrThrow({ where: { trainingCycleId: cycleId } });
      }
      throw error;
    }
  }

  async recordAttempt(cycleId: string, dto: RecordAttemptDto, actor: AuthenticatedUser): Promise<SampleAttempt> {
    await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const session = await this.findSessionOrThrow(cycleId);
    if (session.status !== 'OPEN') {
      throw new ConflictException(`Cannot record an attempt in session status ${session.status}`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Row-lock the SampleSession so concurrent recordAttempt calls for the
      // same session serialize instead of racing on the count-then-create below.
      await tx.$queryRaw`SELECT id FROM "SampleSession" WHERE id = ${session.id} FOR UPDATE`;

      const totalAttemptsIncludingDeleted = await tx.sampleAttempt.count({ where: { sampleSessionId: session.id } });
      if (totalAttemptsIncludingDeleted >= MAX_ATTEMPTS) {
        await tx.sampleSession.update({ where: { id: session.id }, data: { status: 'CLOSED_EXHAUSTED' } });
        await tx.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'ACTIVE_LEVEL_TRAINING' } });
        return { exhausted: true as const };
      }

      const attempt = await tx.sampleAttempt.create({
        data: { sampleSessionId: session.id, attemptNumber: totalAttemptsIncludingDeleted + 1, recordingUrl: dto.recordingUrl, mimeType: 'video/mp4', fileSizeBytes: 0 },
      });
      await tx.sampleSession.update({ where: { id: session.id }, data: { attemptsUsed: totalAttemptsIncludingDeleted + 1 } });
      return { exhausted: false as const, attempt };
    });

    if (result.exhausted) {
      throw new ConflictException('Maximum of 10 recording attempts reached without selecting a sample');
    }
    return result.attempt;
  }

  async deleteAttempt(cycleId: string, attemptId: string, actor: AuthenticatedUser): Promise<SampleAttempt> {
    await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const session = await this.findSessionOrThrow(cycleId);
    const attempt = await this.prisma.sampleAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.sampleSessionId !== session.id) {
      throw new NotFoundException('Attempt not found');
    }
    return this.prisma.sampleAttempt.update({ where: { id: attemptId }, data: { deletedAt: new Date() } });
  }

  async listAttempts(cycleId: string, actor: AuthenticatedUser): Promise<SampleAttempt[]> {
    await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    const session = await this.findSessionOrThrow(cycleId);
    return this.prisma.sampleAttempt.findMany({
      where: { sampleSessionId: session.id, deletedAt: null },
      orderBy: { attemptNumber: 'asc' },
    });
  }

  async submitSample(cycleId: string, dto: SubmitSampleDto, actor: AuthenticatedUser): Promise<SpeechSample & { parts: SampleSamplePart[] }> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'SAMPLE_PREPARATION') {
      throw new ConflictException(`Cannot submit a sample from status ${cycle.status}`);
    }
    const session = await this.findSessionOrThrow(cycleId);

    const liveAttempts = await this.prisma.sampleAttempt.findMany({
      where: { sampleSessionId: session.id, deletedAt: null },
    });
    const liveAttemptIds = new Set(liveAttempts.map((a) => a.id));
    for (const part of dto.parts) {
      if (!liveAttemptIds.has(part.sourceAttemptId)) {
        throw new NotFoundException(`Attempt ${part.sourceAttemptId} is not a live attempt in this session`);
      }
    }
    const attemptsById = new Map(liveAttempts.map((a) => [a.id, a]));

    const result = await this.prisma.$transaction(async (tx) => {
      // Row-lock the cycle so concurrent submitSample calls for the same
      // cycle serialize instead of racing into the DB unique constraint.
      await tx.$queryRaw`SELECT id FROM "TrainingCycle72h" WHERE id = ${cycleId} FOR UPDATE`;

      const freshCycle = await tx.trainingCycle72h.findUniqueOrThrow({ where: { id: cycleId } });
      if (freshCycle.status !== 'SAMPLE_PREPARATION') {
        return { alreadyTransitioned: true as const, status: freshCycle.status };
      }

      const sample = await tx.speechSample.create({
        data: {
          trainingCycleId: cycleId,
          selfSeverityCurrent: dto.selfSeverityCurrent,
          selfSeverityExpectedNext: dto.selfSeverityExpectedNext,
          camperdownPerformanceRating: dto.camperdownPerformanceRating,
          clientOpinionScore: dto.clientOpinionScore,
          submittedAt: new Date(),
          parts: {
            create: dto.parts.map((part) => ({
              partType: part.partType,
              label: part.label,
              order: part.order,
              sourceAttemptId: part.sourceAttemptId,
              recordingUrl: attemptsById.get(part.sourceAttemptId)!.recordingUrl,
            })),
          },
        },
        include: { parts: true },
      });

      await tx.sampleSession.update({ where: { id: session.id }, data: { status: 'CLOSED_SUBMITTED' } });
      await tx.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'WAITING_FOR_SPECIALIST' } });

      return { alreadyTransitioned: false as const, sample };
    });

    if (result.alreadyTransitioned) {
      throw new ConflictException(`Cannot submit a sample from status ${result.status}`);
    }
    return result.sample;
  }

  async rerecordDamagedParts(
    cycleId: string,
    dto: RerecordPartsDto,
    actor: AuthenticatedUser,
  ): Promise<SpeechSample & { parts: SampleSamplePart[] }> {
    const cycle = await this.trainingCyclesService.findCycleForActor(cycleId, actor);
    if (cycle.status !== 'TECHNICAL_PARTIAL_RERECORD') {
      throw new ConflictException(`Cannot re-record parts from status ${cycle.status}`);
    }
    const sample = await this.prisma.speechSample.findUnique({ where: { trainingCycleId: cycleId }, include: { parts: true } });
    if (!sample) {
      throw new NotFoundException('No submitted sample found for this cycle');
    }

    const damagedParts = sample.parts.filter((p) => p.technicallyDamaged);
    const submittedIds = new Set(dto.parts.map((p) => p.id));
    for (const damaged of damagedParts) {
      if (!submittedIds.has(damaged.id)) {
        throw new ConflictException('Every currently damaged part must be re-recorded before resubmitting');
      }
    }
    const damagedIds = new Set(damagedParts.map((p) => p.id));
    for (const part of dto.parts) {
      if (!damagedIds.has(part.id)) {
        throw new NotFoundException(`Part ${part.id} is not a currently-damaged part on this sample`);
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Row-lock the cycle so concurrent resubmit calls for the same cycle
      // serialize — the same TOCTOU class already fixed elsewhere in this
      // module (recordAttempt, submitSample, specialist review).
      await tx.$queryRaw`SELECT id FROM "TrainingCycle72h" WHERE id = ${cycleId} FOR UPDATE`;

      const freshCycle = await tx.trainingCycle72h.findUniqueOrThrow({ where: { id: cycleId } });
      if (freshCycle.status !== 'TECHNICAL_PARTIAL_RERECORD') {
        return { alreadyResubmitted: true as const, status: freshCycle.status };
      }

      await Promise.all(
        dto.parts.map((part) =>
          tx.sampleSamplePart.update({
            where: { id: part.id },
            data: { recordingUrl: part.recordingUrl, technicallyDamaged: false },
          }),
        ),
      );
      const updatedSample = await tx.speechSample.findUniqueOrThrow({
        where: { id: sample.id },
        include: { parts: true },
      });
      await tx.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'WAITING_FOR_SPECIALIST' } });
      return { alreadyResubmitted: false as const, sample: updatedSample };
    });

    if (result.alreadyResubmitted) {
      throw new ConflictException(`Cannot re-record parts from status ${result.status}`);
    }
    return result.sample;
  }

  private async findSessionOrThrow(cycleId: string): Promise<SampleSession> {
    const session = await this.prisma.sampleSession.findUnique({ where: { trainingCycleId: cycleId } });
    if (!session) {
      throw new NotFoundException('No sample session open for this cycle');
    }
    return session;
  }
}
