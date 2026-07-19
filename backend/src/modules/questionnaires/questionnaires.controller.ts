import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { QuestionnairesService } from './questionnaires.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { AuditPhiRead } from '../../common/audit/audit-phi-read.decorator';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { SubmitResponseDto } from './dto/submit-response.dto';

@Controller('api/v1')
@UseGuards(SessionGuard, PermissionsGuard)
export class QuestionnairesController {
  constructor(private readonly service: QuestionnairesService) {}

  @Post('questionnaire-templates')
  @RequirePermission(Permission.MANAGE_QUESTIONNAIRE)
  createTemplate(@Body() dto: CreateTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createTemplate(dto, user);
  }

  @Get('questionnaire-templates')
  @RequirePermission(Permission.VIEW_QUESTIONNAIRE)
  listTemplates(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listTemplates(user);
  }

  @Patch('questionnaire-templates/:templateId')
  @RequirePermission(Permission.MANAGE_QUESTIONNAIRE)
  setTemplateActive(@Param('templateId') templateId: string, @Body() dto: UpdateTemplateDto) {
    return this.service.setTemplateActive(templateId, dto.isActive);
  }

  @Post('patients/:patientId/questionnaire-responses')
  @RequirePermission(Permission.ANSWER_QUESTIONNAIRE)
  submitResponse(@Param('patientId') patientId: string, @Body() dto: SubmitResponseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.submitResponse(patientId, dto, user);
  }

  @Get('patients/:patientId/questionnaire-responses')
  @RequirePermission(Permission.VIEW_QUESTIONNAIRE)
  @AuditPhiRead()
  listResponses(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.listResponsesForPatient(patientId, user);
  }
}
