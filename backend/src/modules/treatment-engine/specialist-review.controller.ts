import { Body, Controller, Post, Param, UseGuards } from '@nestjs/common';
import { SpecialistReviewService } from './specialist-review.service';
import { TrainingCyclesService } from './training-cycles.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { ReviewSampleDto } from './dto/review-sample.dto';

@Controller('api/v1/patients/:patientId/cycles/current')
@UseGuards(SessionGuard, PermissionsGuard)
export class SpecialistReviewController {
  constructor(
    private readonly specialistReviewService: SpecialistReviewService,
    private readonly trainingCyclesService: TrainingCyclesService,
  ) {}

  @Post('review')
  @RequirePermission(Permission.REVIEW_SAMPLE)
  async review(@Param('patientId') patientId: string, @Body() dto: ReviewSampleDto, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.specialistReviewService.review(current.id, dto, user);
  }
}
