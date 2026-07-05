import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AssessmentsService } from './assessments.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { UpdateAssessmentDto } from './dto/update-assessment.dto';
import { ApproveAssessmentDto } from './dto/approve-assessment.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/patients/:patientId/assessments')
@UseGuards(SessionGuard, PermissionsGuard)
export class AssessmentsController {
  constructor(private readonly assessmentsService: AssessmentsService) {}

  @Post()
  @RequirePermission(Permission.CREATE_ASSESSMENT)
  create(@Param('patientId') patientId: string, @Body() dto: CreateAssessmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assessmentsService.create(patientId, dto, user);
  }

  @Get()
  @RequirePermission(Permission.VIEW_ASSESSMENT)
  findAll(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assessmentsService.findAllForPatient(patientId, user);
  }

  @Get(':id')
  @RequirePermission(Permission.VIEW_ASSESSMENT)
  findOne(@Param('patientId') patientId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assessmentsService.findById(patientId, id, user);
  }

  @Put(':id')
  @RequirePermission(Permission.EDIT_ASSESSMENT)
  update(@Param('patientId') patientId: string, @Param('id') id: string, @Body() dto: UpdateAssessmentDto) {
    return this.assessmentsService.update(patientId, id, dto);
  }

  @Post(':id/approve')
  @RequirePermission(Permission.APPROVE_ASSESSMENT)
  approve(@Param('patientId') patientId: string, @Param('id') id: string, @Body() dto: ApproveAssessmentDto) {
    return this.assessmentsService.approve(patientId, id, dto);
  }
}
