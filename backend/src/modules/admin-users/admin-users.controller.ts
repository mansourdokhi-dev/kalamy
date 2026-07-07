import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { CreateStaffDto } from './dto/create-staff.dto';
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
}
