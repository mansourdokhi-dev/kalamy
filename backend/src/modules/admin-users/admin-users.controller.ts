import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { SessionGuard } from '../../common/auth/session.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/admin')
@UseGuards(SessionGuard, PermissionsGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Post('staff')
  @RequirePermission(Permission.CREATE_STAFF_ACCOUNT)
  createStaff(@Body() dto: CreateStaffDto) {
    return this.adminUsersService.createStaff(dto);
  }

  @Get('users')
  @RequirePermission(Permission.MANAGE_USER_ACCOUNTS)
  list(@Query('role') role?: string, @Query('status') status?: string) {
    return this.adminUsersService.list({ role, status });
  }

  @Get('users/:id')
  @RequirePermission(Permission.MANAGE_USER_ACCOUNTS)
  findOne(@Param('id') id: string) {
    return this.adminUsersService.findById(id);
  }

  @Patch('users/:id/status')
  @RequirePermission(Permission.MANAGE_USER_ACCOUNTS)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto) {
    return this.adminUsersService.updateStatus(id, dto);
  }
}
