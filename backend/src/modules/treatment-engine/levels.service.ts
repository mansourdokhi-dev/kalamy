import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Level, LevelVersion } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLevelDto } from './dto/create-level.dto';
import { CreateLevelVersionDto } from './dto/create-level-version.dto';

@Injectable()
export class LevelsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateLevelDto): Promise<Level> {
    return this.prisma.level.create({ data: dto });
  }

  async createVersion(levelId: string, dto: CreateLevelVersionDto): Promise<LevelVersion> {
    await this.findLevelOrThrow(levelId);
    return this.prisma.levelVersion.create({ data: { ...dto, levelId } });
  }

  async publishVersion(levelId: string, versionId: string): Promise<LevelVersion> {
    const version = await this.prisma.levelVersion.findUnique({ where: { id: versionId } });
    if (!version || version.levelId !== levelId) {
      throw new NotFoundException('Level version not found');
    }
    return this.prisma.levelVersion.update({ where: { id: versionId }, data: { publishedAt: new Date() } });
  }

  list(): Promise<Level[]> {
    return this.prisma.level.findMany({ orderBy: { order: 'asc' } });
  }

  async getActiveVersion(levelId: string): Promise<LevelVersion> {
    const version = await this.prisma.levelVersion.findFirst({
      where: { levelId, publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
    });
    if (!version) {
      throw new ConflictException('Level has no published version');
    }
    return version;
  }

  private async findLevelOrThrow(levelId: string): Promise<Level> {
    const level = await this.prisma.level.findUnique({ where: { id: levelId } });
    if (!level) {
      throw new NotFoundException('Level not found');
    }
    return level;
  }
}
