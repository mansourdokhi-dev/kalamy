import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SamplesService } from './samples.service';
import { TrainingCyclesService } from './training-cycles.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { RecordAttemptDto } from './dto/record-attempt.dto';

@Controller('api/v1/patients/:patientId/cycles/current/sample-session')
@UseGuards(SessionGuard, PermissionsGuard)
export class SamplesController {
  constructor(
    private readonly samplesService: SamplesService,
    private readonly trainingCyclesService: TrainingCyclesService,
  ) {}

  @Post()
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async openSession(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.openSession(current.id, user);
  }

  @Post('attempts')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async recordAttempt(@Param('patientId') patientId: string, @Body() dto: RecordAttemptDto, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.recordAttempt(current.id, dto, user);
  }

  @Delete('attempts/:attemptId')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async deleteAttempt(
    @Param('patientId') patientId: string,
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.deleteAttempt(current.id, attemptId, user);
  }

  @Get('attempts')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async listAttempts(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.listAttempts(current.id, user);
  }
}
