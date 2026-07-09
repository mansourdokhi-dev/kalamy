import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SampleAttempt, SampleSession, SpeechSample, SampleSamplePart } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { TrainingCyclesService } from './training-cycles.service';
import { RecordAttemptDto } from './dto/record-attempt.dto';
import { SubmitSampleDto } from './dto/submit-sample.dto';

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
        data: { sampleSessionId: session.id, attemptNumber: totalAttemptsIncludingDeleted + 1, recordingUrl: dto.recordingUrl },
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

    const sample = await this.prisma.speechSample.create({
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

    await this.prisma.sampleSession.update({ where: { id: session.id }, data: { status: 'CLOSED_SUBMITTED' } });
    await this.prisma.trainingCycle72h.update({ where: { id: cycleId }, data: { status: 'WAITING_FOR_SPECIALIST' } });

    return sample;
  }

  private async findSessionOrThrow(cycleId: string): Promise<SampleSession> {
    const session = await this.prisma.sampleSession.findUnique({ where: { trainingCycleId: cycleId } });
    if (!session) {
      throw new NotFoundException('No sample session open for this cycle');
    }
    return session;
  }
}
