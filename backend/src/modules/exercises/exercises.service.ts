import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Exercise } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { UpdateExerciseDto } from './dto/update-exercise.dto';
import { UpdateExerciseStatusDto } from './dto/update-exercise-status.dto';
import { AuthenticatedUser } from '../../common/auth/session.guard';

@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateExerciseDto, actor: AuthenticatedUser): Promise<Exercise> {
    return this.prisma.exercise.create({
      data: {
        title: dto.title,
        category: dto.category,
        phaseLevel: dto.phaseLevel,
        instructions: dto.instructions,
        mediaUrl: dto.mediaUrl,
        durationMinutes: dto.durationMinutes,
        createdByUserId: actor.id,
      },
    });
  }

  findAll(phase?: number, category?: string): Promise<Exercise[]> {
    return this.prisma.exercise.findMany({
      where: {
        status: 'ACTIVE',
        phaseLevel: phase,
        category: category ? { equals: category, mode: 'insensitive' } : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<Exercise> {
    const exercise = await this.prisma.exercise.findUnique({ where: { id } });
    if (!exercise) {
      throw new NotFoundException('Exercise not found');
    }
    return exercise;
  }

  async update(id: string, dto: UpdateExerciseDto): Promise<Exercise> {
    await this.findById(id);
    return this.prisma.exercise.update({
      where: { id },
      data: {
        title: dto.title,
        category: dto.category,
        phaseLevel: dto.phaseLevel,
        instructions: dto.instructions,
        mediaUrl: dto.mediaUrl,
        durationMinutes: dto.durationMinutes,
      },
    });
  }

  async updateStatus(id: string, dto: UpdateExerciseStatusDto): Promise<Exercise> {
    await this.findById(id);

    if (dto.status === 'ARCHIVED') {
      const activeUsage = await this.prisma.planExercise.findFirst({
        where: { exerciseId: id, treatmentPlan: { status: 'ACTIVE' } },
      });
      if (activeUsage) {
        throw new BadRequestException('Cannot archive an exercise referenced by an active treatment plan');
      }
    }

    return this.prisma.exercise.update({
      where: { id },
      data: { status: dto.status },
    });
  }
}
