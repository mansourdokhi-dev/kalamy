import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { TreatmentPlansService } from './treatment-plans.service';
import { CreateTreatmentPlanDto } from './dto/create-treatment-plan.dto';
import { UpdateTreatmentPlanDto } from './dto/update-treatment-plan.dto';
import { PhaseTransitionDto } from './dto/phase-transition.dto';
import { LinkExerciseDto } from './dto/link-exercise.dto';
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

  @Put(':id')
  @RequirePermission(Permission.EDIT_TREATMENT_PLAN)
  update(@Param('patientId') patientId: string, @Param('id') id: string, @Body() dto: UpdateTreatmentPlanDto) {
    return this.treatmentPlansService.update(patientId, id, dto);
  }

  @Post(':id/phase-transition')
  @RequirePermission(Permission.EDIT_TREATMENT_PLAN)
  recordPhaseTransition(
    @Param('patientId') patientId: string,
    @Param('id') id: string,
    @Body() dto: PhaseTransitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.treatmentPlansService.recordPhaseTransition(patientId, id, dto, user);
  }

  @Post(':id/exercises')
  @RequirePermission(Permission.EDIT_TREATMENT_PLAN)
  linkExercise(@Param('patientId') patientId: string, @Param('id') id: string, @Body() dto: LinkExerciseDto) {
    return this.treatmentPlansService.linkExercise(patientId, id, dto);
  }

  @Get(':id/exercises')
  @RequirePermission(Permission.VIEW_TREATMENT_PLAN)
  listExercises(@Param('patientId') patientId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.treatmentPlansService.listExercises(patientId, id, user);
  }

  @Delete(':id/exercises/:exerciseId')
  @RequirePermission(Permission.EDIT_TREATMENT_PLAN)
  unlinkExercise(
    @Param('patientId') patientId: string,
    @Param('id') id: string,
    @Param('exerciseId') exerciseId: string,
  ) {
    return this.treatmentPlansService.unlinkExercise(patientId, id, exerciseId);
  }
}
