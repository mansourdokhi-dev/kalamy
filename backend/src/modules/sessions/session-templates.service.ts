import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionTemplate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSessionTemplateDto } from './dto/create-session-template.dto';
import { UpdateSessionTemplateDto } from './dto/update-session-template.dto';

@Injectable()
export class SessionTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSessionTemplateDto): Promise<SessionTemplate> {
    return this.prisma.sessionTemplate.create({
      data: {
        sessionNumber: dto.sessionNumber,
        category: dto.category,
        cognitiveVideoUrl: dto.cognitiveVideoUrl,
        behavioralVideoUrl: dto.behavioralVideoUrl,
        trainingDurationDays: dto.trainingDurationDays,
        instructions: dto.instructions,
      },
    });
  }

  findAll(): Promise<SessionTemplate[]> {
    return this.prisma.sessionTemplate.findMany({ orderBy: { sessionNumber: 'asc' } });
  }

  async findById(id: string): Promise<SessionTemplate> {
    const template = await this.prisma.sessionTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException('Session template not found');
    }
    return template;
  }

  async findByNumberOrThrow(sessionNumber: number): Promise<SessionTemplate> {
    const template = await this.prisma.sessionTemplate.findUnique({ where: { sessionNumber } });
    if (!template) {
      throw new NotFoundException(`Session template ${sessionNumber} not found`);
    }
    return template;
  }

  async update(id: string, dto: UpdateSessionTemplateDto): Promise<SessionTemplate> {
    await this.findById(id);
    return this.prisma.sessionTemplate.update({
      where: { id },
      data: {
        category: dto.category,
        cognitiveVideoUrl: dto.cognitiveVideoUrl,
        behavioralVideoUrl: dto.behavioralVideoUrl,
        trainingDurationDays: dto.trainingDurationDays,
        instructions: dto.instructions,
      },
    });
  }
}
