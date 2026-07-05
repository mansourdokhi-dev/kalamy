import { Injectable, NotFoundException } from '@nestjs/common';
import { Exercise } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
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
}
