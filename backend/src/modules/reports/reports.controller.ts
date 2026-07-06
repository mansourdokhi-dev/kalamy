import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/reports')
@UseGuards(SessionGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('patients/:patientId/assessment-results')
  @RequirePermission(Permission.VIEW_PATIENT_REPORTS)
  getAssessmentResultsReport(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.getAssessmentResultsReport(patientId, user);
  }

  @Get('patients/:patientId/medical')
  @RequirePermission(Permission.VIEW_PATIENT_REPORTS)
  getMedicalReport(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.getMedicalReport(patientId, user);
  }
}
