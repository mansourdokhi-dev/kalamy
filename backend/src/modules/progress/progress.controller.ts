import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/patients/:patientId/progress')
@UseGuards(SessionGuard, PermissionsGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get()
  @RequirePermission(Permission.VIEW_PROGRESS)
  getDashboard(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.progressService.getDashboard(patientId, user);
  }
}
