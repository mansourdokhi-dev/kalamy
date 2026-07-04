import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/patients')
@UseGuards(SessionGuard, PermissionsGuard)
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @RequirePermission(Permission.CREATE_PATIENT_PROFILE)
  create(@Body() dto: CreatePatientDto) {
    return this.patientsService.create(dto);
  }

  @Get(':id')
  @RequirePermission(Permission.VIEW_PATIENT_PROFILE)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientsService.findById(id, user);
  }

  @Put(':id')
  @RequirePermission(Permission.EDIT_PATIENT_PROFILE)
  update(@Param('id') id: string, @Body() dto: UpdatePatientDto, @CurrentUser() user: AuthenticatedUser) {
    return this.patientsService.update(id, dto, user);
  }
}
