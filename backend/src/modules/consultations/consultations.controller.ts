import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { RequestConsultationDto } from './dto/request-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';
import { AuditPhiRead } from '../../common/audit/audit-phi-read.decorator';

@Controller('api/v1')
@UseGuards(SessionGuard, PermissionsGuard)
export class ConsultationsController {
  constructor(private readonly consultationsService: ConsultationsService) {}

  @Post('patients/:patientId/consultations')
  @RequirePermission(Permission.REQUEST_CONSULTATION)
  async request(@Param('patientId') patientId: string, @Body() dto: RequestConsultationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.consultationsService.request(patientId, dto, user);
  }

  @Get('patients/:patientId/consultations')
  @RequirePermission(Permission.REQUEST_CONSULTATION)
  @AuditPhiRead()
  async list(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.consultationsService.listForPatient(patientId, user);
  }

  @Patch('consultations/:consultationId')
  @RequirePermission(Permission.MANAGE_CONSULTATION)
  async update(@Param('consultationId') consultationId: string, @Body() dto: UpdateConsultationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.consultationsService.update(consultationId, dto, user);
  }
}
