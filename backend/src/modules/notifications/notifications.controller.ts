import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';

@Controller('api/v1/notifications')
@UseGuards(SessionGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @RequirePermission(Permission.VIEW_OWN_NOTIFICATIONS)
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listForUser(user.id);
  }

  @Patch(':notificationId/read')
  @RequirePermission(Permission.VIEW_OWN_NOTIFICATIONS)
  async markRead(@Param('notificationId') notificationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markRead(notificationId, user);
  }

  @Get('preferences')
  @RequirePermission(Permission.VIEW_OWN_NOTIFICATIONS)
  async listPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listPreferencesForUser(user.id);
  }

  @Patch('preferences/:type')
  @RequirePermission(Permission.VIEW_OWN_NOTIFICATIONS)
  async updatePreference(@Param('type') type: string, @Body() dto: UpdateNotificationPreferenceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.updatePreference(user.id, type, dto.enabled);
  }
}
