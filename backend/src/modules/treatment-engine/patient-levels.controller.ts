import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { PatientLevelsService } from './patient-levels.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { AuditPhiRead } from '../../common/audit/audit-phi-read.decorator';

@Controller('api/v1/patients/:patientId/levels')
@UseGuards(SessionGuard, PermissionsGuard)
export class PatientLevelsController {
  constructor(private readonly patientLevelsService: PatientLevelsService) {}

  @Get('passed')
  @RequirePermission(Permission.VIEW_LEVELS)
  @AuditPhiRead()
  listPassed(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientLevelsService.listPassed(patientId, user);
  }

  @Get(':levelId/review')
  @RequirePermission(Permission.VIEW_LEVELS)
  @AuditPhiRead()
  reviewLevel(@Param('patientId') patientId: string, @Param('levelId') levelId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientLevelsService.reviewLevel(patientId, levelId, user);
  }
}
