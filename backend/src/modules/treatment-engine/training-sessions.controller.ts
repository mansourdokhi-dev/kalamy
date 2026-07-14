import { Controller, Post, Param, UseGuards } from '@nestjs/common';
import { TrainingSessionsService } from './training-sessions.service';
import { TrainingCyclesService } from './training-cycles.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/patients/:patientId/cycles/current/training-sessions')
@UseGuards(SessionGuard, PermissionsGuard)
export class TrainingSessionsController {
  constructor(
    private readonly trainingSessionsService: TrainingSessionsService,
    private readonly trainingCyclesService: TrainingCyclesService,
  ) {}

  @Post()
  @RequirePermission(Permission.RECORD_TRAINING_EVENT)
  async startOrResume(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.trainingSessionsService.startOrResume(current.id, user);
  }
}
