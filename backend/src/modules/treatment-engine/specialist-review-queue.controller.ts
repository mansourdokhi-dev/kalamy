import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { SpecialistReviewService } from './specialist-review.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { RequestInterventionDto } from './dto/request-intervention.dto';
import { CompleteInterventionDto } from './dto/complete-intervention.dto';

@Controller('api/v1/specialist-review')
@UseGuards(SessionGuard, PermissionsGuard)
export class SpecialistReviewQueueController {
  constructor(private readonly specialistReviewService: SpecialistReviewService) {}

  @Get('available-samples')
  @RequirePermission(Permission.REVIEW_SAMPLE)
  async listAvailable() {
    return this.specialistReviewService.listAvailableSamples();
  }

  @Post('cycles/:cycleId/reserve')
  @RequirePermission(Permission.REVIEW_SAMPLE)
  async reserve(@Param('cycleId') cycleId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.specialistReviewService.reserve(cycleId, user);
  }

  @Post('cycles/:cycleId/intervention')
  @RequirePermission(Permission.REVIEW_SAMPLE)
  async requestIntervention(@Param('cycleId') cycleId: string, @Body() dto: RequestInterventionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.specialistReviewService.requestIntervention(cycleId, dto, user);
  }

  @Post('cycles/:cycleId/intervention/complete')
  @RequirePermission(Permission.REVIEW_SAMPLE)
  async completeIntervention(@Param('cycleId') cycleId: string, @Body() dto: CompleteInterventionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.specialistReviewService.completeIntervention(cycleId, dto, user);
  }
}
