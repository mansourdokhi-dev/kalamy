import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ComplaintsService } from './complaints.service';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { UpdateComplaintStatusDto } from './dto/update-complaint-status.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/complaints')
@UseGuards(SessionGuard, PermissionsGuard)
export class ComplaintsController {
  constructor(private readonly complaintsService: ComplaintsService) {}

  @Post()
  @RequirePermission(Permission.SUBMIT_COMPLAINT)
  create(@Body() dto: CreateComplaintDto, @CurrentUser() user: AuthenticatedUser) {
    return this.complaintsService.create(dto, user);
  }

  @Get()
  @RequirePermission(Permission.MANAGE_COMPLAINTS)
  list(
    @Query('status') status?: 'OPEN' | 'REVIEWED' | 'RESOLVED',
    @Query('relatedClinicianUserId') relatedClinicianUserId?: string,
  ) {
    return this.complaintsService.listAll({ status, relatedClinicianUserId });
  }

  @Get(':id')
  @RequirePermission(Permission.VIEW_COMPLAINT)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.complaintsService.findById(id, user);
  }

  @Patch(':id/status')
  @RequirePermission(Permission.MANAGE_COMPLAINTS)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateComplaintStatusDto) {
    return this.complaintsService.updateStatus(id, dto);
  }
}
