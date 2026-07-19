import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { SendMessageDto } from './dto/send-message.dto';
import { AuditPhiRead } from '../../common/audit/audit-phi-read.decorator';

@Controller('api/v1')
@UseGuards(SessionGuard, PermissionsGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('patients/:patientId/messages')
  @RequirePermission(Permission.VIEW_MESSAGE)
  @AuditPhiRead()
  async list(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.messagesService.listForPatient(patientId, user);
  }

  @Post('patients/:patientId/messages')
  @RequirePermission(Permission.SEND_MESSAGE)
  async send(@Param('patientId') patientId: string, @Body() dto: SendMessageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.messagesService.send(patientId, dto, user);
  }
}
