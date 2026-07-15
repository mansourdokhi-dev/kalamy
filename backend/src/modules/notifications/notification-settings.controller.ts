import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { NotificationSettingsService } from './notification-settings.service';
import { SessionGuard } from '../../common/auth/session.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { UpdateNotificationSettingDto } from './dto/update-notification-setting.dto';

@Controller('api/v1/admin/notification-settings')
@UseGuards(SessionGuard, PermissionsGuard)
export class NotificationSettingsController {
  constructor(private readonly notificationSettingsService: NotificationSettingsService) {}

  @Get()
  @RequirePermission(Permission.MANAGE_NOTIFICATION_SETTINGS)
  async list() {
    return this.notificationSettingsService.listAll();
  }

  @Patch(':key')
  @RequirePermission(Permission.MANAGE_NOTIFICATION_SETTINGS)
  async update(@Param('key') key: string, @Body() dto: UpdateNotificationSettingDto) {
    return this.notificationSettingsService.updateValue(key, dto.valueMs);
  }
}
