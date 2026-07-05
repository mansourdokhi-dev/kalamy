import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ExercisesService } from './exercises.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/exercises')
@UseGuards(SessionGuard, PermissionsGuard)
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  @Post()
  @RequirePermission(Permission.CREATE_EXERCISE)
  create(@Body() dto: CreateExerciseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.exercisesService.create(dto, user);
  }

  @Get()
  @RequirePermission(Permission.VIEW_EXERCISE)
  findAll(
    @Query('phase', new ParseIntPipe({ optional: true })) phase?: number,
    @Query('category') category?: string,
  ) {
    return this.exercisesService.findAll(phase, category);
  }

  @Get(':id')
  @RequirePermission(Permission.VIEW_EXERCISE)
  findOne(@Param('id') id: string) {
    return this.exercisesService.findById(id);
  }
}
