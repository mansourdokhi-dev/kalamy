import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { TreatmentPlansService } from './treatment-plans.service';
import { CreateTreatmentPlanDto } from './dto/create-treatment-plan.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/patients/:patientId/treatment-plans')
@UseGuards(SessionGuard, PermissionsGuard)
export class TreatmentPlansController {
  constructor(private readonly treatmentPlansService: TreatmentPlansService) {}

  @Post()
  @RequirePermission(Permission.CREATE_TREATMENT_PLAN)
  create(@Param('patientId') patientId: string, @Body() dto: CreateTreatmentPlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.treatmentPlansService.create(patientId, dto, user);
  }

  @Get()
  @RequirePermission(Permission.VIEW_TREATMENT_PLAN)
  findAll(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.treatmentPlansService.findAllForPatient(patientId, user);
  }

  @Get('active')
  @RequirePermission(Permission.VIEW_TREATMENT_PLAN)
  findActive(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.treatmentPlansService.findActiveForPatient(patientId, user);
  }
}
