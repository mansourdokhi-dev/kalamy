import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { SessionTemplatesService } from './session-templates.service';
import { CreateSessionTemplateDto } from './dto/create-session-template.dto';
import { UpdateSessionTemplateDto } from './dto/update-session-template.dto';
import { SessionGuard } from '../../common/auth/session.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';

@Controller('api/v1/session-templates')
@UseGuards(SessionGuard, PermissionsGuard)
export class SessionTemplatesController {
  constructor(private readonly sessionTemplatesService: SessionTemplatesService) {}

  @Post()
  @RequirePermission(Permission.MANAGE_SESSION_TEMPLATES)
  create(@Body() dto: CreateSessionTemplateDto) {
    return this.sessionTemplatesService.create(dto);
  }

  @Get()
  @RequirePermission(Permission.VIEW_SESSION_TEMPLATES)
  findAll() {
    return this.sessionTemplatesService.findAll();
  }

  @Get(':id')
  @RequirePermission(Permission.VIEW_SESSION_TEMPLATES)
  findOne(@Param('id') id: string) {
    return this.sessionTemplatesService.findById(id);
  }

  @Put(':id')
  @RequirePermission(Permission.MANAGE_SESSION_TEMPLATES)
  update(@Param('id') id: string, @Body() dto: UpdateSessionTemplateDto) {
    return this.sessionTemplatesService.update(id, dto);
  }
}
