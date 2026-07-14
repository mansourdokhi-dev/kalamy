import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { TrainingCyclesService } from './training-cycles.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { StartCycleDto } from './dto/start-cycle.dto';

@Controller('api/v1/patients/:patientId/cycles')
@UseGuards(SessionGuard, PermissionsGuard)
export class TrainingCyclesController {
  constructor(private readonly trainingCyclesService: TrainingCyclesService) {}

  @Post('start')
  @RequirePermission(Permission.START_CYCLE)
  start(@Param('patientId') patientId: string, @Body() dto: StartCycleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.trainingCyclesService.startFirstCycle(patientId, dto.treatmentPlanId, user);
  }

  @Post('restart-after-inactivity')
  @RequirePermission(Permission.RESTART_CYCLE)
  restartAfterInactivity(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.trainingCyclesService.restartAfterInactivity(patientId, user);
  }

  @Get()
  @RequirePermission(Permission.VIEW_CYCLE)
  listHistory(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.trainingCyclesService.listHistory(patientId, user);
  }

  @Post('current/watch-human-model')
  @RequirePermission(Permission.RECORD_TRAINING_EVENT)
  async watchHumanModel(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.trainingCyclesService.watchHumanModel(current.id, user);
  }

  @Get('current')
  @RequirePermission(Permission.VIEW_CYCLE)
  getCurrent(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.trainingCyclesService.getCurrent(patientId, user);
  }
}
