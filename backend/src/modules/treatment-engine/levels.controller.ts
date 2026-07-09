import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { LevelsService } from './levels.service';
import { SessionGuard } from '../../common/auth/session.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { CreateLevelDto } from './dto/create-level.dto';
import { CreateLevelVersionDto } from './dto/create-level-version.dto';

@Controller('api/v1/levels')
@UseGuards(SessionGuard, PermissionsGuard)
export class LevelsController {
  constructor(private readonly levelsService: LevelsService) {}

  @Post()
  @RequirePermission(Permission.MANAGE_LEVELS)
  create(@Body() dto: CreateLevelDto) {
    return this.levelsService.create(dto);
  }

  @Post(':levelId/versions')
  @RequirePermission(Permission.MANAGE_LEVELS)
  createVersion(@Param('levelId') levelId: string, @Body() dto: CreateLevelVersionDto) {
    return this.levelsService.createVersion(levelId, dto);
  }

  @Post(':levelId/versions/:versionId/publish')
  @HttpCode(200)
  @RequirePermission(Permission.MANAGE_LEVELS)
  publishVersion(@Param('levelId') levelId: string, @Param('versionId') versionId: string) {
    return this.levelsService.publishVersion(levelId, versionId);
  }

  @Get(':levelId/versions/active')
  @RequirePermission(Permission.VIEW_LEVELS)
  getActiveVersion(@Param('levelId') levelId: string) {
    return this.levelsService.getActiveVersion(levelId);
  }

  @Get()
  @RequirePermission(Permission.VIEW_LEVELS)
  list() {
    return this.levelsService.list();
  }
}
