import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { AuditPhiRead } from '../../common/audit/audit-phi-read.decorator';

@Controller('api/v1/reports')
@UseGuards(SessionGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('patients/:patientId/assessment-results')
  @RequirePermission(Permission.VIEW_PATIENT_REPORTS)
  @AuditPhiRead()
  getAssessmentResultsReport(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.getAssessmentResultsReport(patientId, user);
  }

  @Get('patients/:patientId/medical')
  @RequirePermission(Permission.VIEW_PATIENT_REPORTS)
  @AuditPhiRead()
  getMedicalReport(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.getMedicalReport(patientId, user);
  }

  @Get('operational-status')
  @RequirePermission(Permission.VIEW_ADMIN_REPORTS)
  getOperationalStatusReport() {
    return this.reportsService.getOperationalStatusReport();
  }

  @Get('kpi-dashboard')
  @RequirePermission(Permission.VIEW_ADMIN_REPORTS)
  getKpiDashboard() {
    return this.reportsService.getKpiDashboard();
  }

  @Get('registered-users')
  @RequirePermission(Permission.VIEW_ADMIN_REPORTS)
  getRegisteredUsersReport() {
    return this.reportsService.getRegisteredUsersReport();
  }

  @Get('service-modifications')
  @RequirePermission(Permission.VIEW_ADMIN_REPORTS)
  getServiceModificationLogReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportsService.getServiceModificationLogReport({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Get('staff-performance')
  @RequirePermission(Permission.VIEW_ADMIN_REPORTS)
  getStaffPerformanceReport() {
    return this.reportsService.getStaffPerformanceReport();
  }

  @Get('complaints')
  @RequirePermission(Permission.VIEW_ADMIN_REPORTS)
  getComplaintsReport(
    @Query('status') status?: 'OPEN' | 'REVIEWED' | 'RESOLVED',
    @Query('relatedClinicianUserId') relatedClinicianUserId?: string,
  ) {
    return this.reportsService.getComplaintsReport({ status, relatedClinicianUserId });
  }
}
