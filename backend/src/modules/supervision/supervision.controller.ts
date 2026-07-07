import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { SupervisionService } from './supervision.service';
import { AssignSupervisorDto } from './dto/assign-supervisor.dto';
import { SessionGuard } from '../../common/auth/session.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/admin/supervision')
@UseGuards(SessionGuard, PermissionsGuard)
export class SupervisionController {
  constructor(private readonly supervisionService: SupervisionService) {}

  @Put(':clinicianUserId')
  @RequirePermission(Permission.MANAGE_SUPERVISION)
  assignSupervisor(@Param('clinicianUserId') clinicianUserId: string, @Body() dto: AssignSupervisorDto) {
    return this.supervisionService.assignSupervisor(clinicianUserId, dto);
  }
}
