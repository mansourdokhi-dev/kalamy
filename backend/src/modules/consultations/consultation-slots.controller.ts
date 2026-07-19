import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ConsultationSlotsService } from './consultation-slots.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { CreateSlotDto } from './dto/create-slot.dto';
import { BookSlotDto } from './dto/book-slot.dto';

@Controller('api/v1')
@UseGuards(SessionGuard, PermissionsGuard)
export class ConsultationSlotsController {
  constructor(private readonly slotsService: ConsultationSlotsService) {}

  @Post('consultation-slots')
  @RequirePermission(Permission.MANAGE_CONSULTATION)
  createSlot(@Body() dto: CreateSlotDto, @CurrentUser() user: AuthenticatedUser) {
    return this.slotsService.createSlot(dto, user);
  }

  @Get('consultation-slots/mine')
  @RequirePermission(Permission.MANAGE_CONSULTATION)
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.slotsService.listMine(user);
  }

  @Get('consultation-slots/available')
  @RequirePermission(Permission.VIEW_CONSULTATION)
  listAvailable() {
    return this.slotsService.listAvailable();
  }

  @Post('consultations/:consultationId/book-slot')
  @RequirePermission(Permission.REQUEST_CONSULTATION)
  bookSlot(@Param('consultationId') consultationId: string, @Body() dto: BookSlotDto, @CurrentUser() user: AuthenticatedUser) {
    return this.slotsService.bookSlot(consultationId, dto.slotId, user);
  }
}
