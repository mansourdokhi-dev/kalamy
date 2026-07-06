import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { PatientSessionsService } from './patient-sessions.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { SubmitRatingsDto } from './dto/submit-ratings.dto';
import { SubmitSampleDto } from './dto/submit-sample.dto';

@Controller('api/v1/patients/:patientId/sessions')
@UseGuards(SessionGuard, PermissionsGuard)
export class PatientSessionsController {
  constructor(private readonly patientSessionsService: PatientSessionsService) {}

  @Post('start')
  @RequirePermission(Permission.START_SESSION)
  start(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientSessionsService.start(patientId, user);
  }

  @Put('current/ratings')
  @RequirePermission(Permission.SUBMIT_SESSION)
  submitRatings(@Param('patientId') patientId: string, @Body() dto: SubmitRatingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.patientSessionsService.submitRatings(patientId, dto, user);
  }

  @Post('current/submit')
  @RequirePermission(Permission.SUBMIT_SESSION)
  submitSample(@Param('patientId') patientId: string, @Body() dto: SubmitSampleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.patientSessionsService.submitSample(patientId, dto, user);
  }
}
