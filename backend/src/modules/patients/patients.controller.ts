import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { SessionGuard } from '../../common/auth/session.guard';
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
}
