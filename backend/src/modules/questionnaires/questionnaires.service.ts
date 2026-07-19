import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { Permission, hasPermission } from '../../common/rbac/permissions';
import { CreateTemplateDto } from './dto/create-template.dto';
import { SubmitResponseDto } from './dto/submit-response.dto';

const TEMPLATE_WITH_QUESTIONS = {
  questions: { orderBy: { order: 'asc' } },
} satisfies Prisma.QuestionnaireTemplateInclude;

@Injectable()
export class QuestionnairesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
  ) {}

  async createTemplate(dto: CreateTemplateDto, actor: AuthenticatedUser) {
    return this.prisma.questionnaireTemplate.create({
      data: {
        title: dto.title,
        description: dto.description,
        createdByUserId: actor.id,
        questions: {
          create: dto.questions.map((q, index) => ({
            order: index,
            text: q.text,
            type: q.type,
            options: q.options ?? [],
            required: q.required ?? true,
          })),
        },
      },
      include: TEMPLATE_WITH_QUESTIONS,
    });
  }

  // Staff who can manage see every template; everyone else sees only active ones.
  async listTemplates(actor: AuthenticatedUser) {
    const canManage = hasPermission(actor.role, Permission.MANAGE_QUESTIONNAIRE);
    return this.prisma.questionnaireTemplate.findMany({
      where: canManage ? {} : { isActive: true },
      include: TEMPLATE_WITH_QUESTIONS,
      orderBy: { createdAt: 'desc' },
    });
  }

  async setTemplateActive(templateId: string, isActive: boolean) {
    const template = await this.prisma.questionnaireTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      throw new NotFoundException('Questionnaire template not found');
    }
    return this.prisma.questionnaireTemplate.update({
      where: { id: templateId },
      data: { isActive },
      include: TEMPLATE_WITH_QUESTIONS,
    });
  }

  async submitResponse(patientProfileId: string, dto: SubmitResponseDto, actor: AuthenticatedUser) {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const template = await this.prisma.questionnaireTemplate.findUnique({
      where: { id: dto.templateId },
      include: TEMPLATE_WITH_QUESTIONS,
    });
    if (!template) {
      throw new NotFoundException('Questionnaire template not found');
    }
    if (!template.isActive) {
      throw new BadRequestException('This questionnaire is no longer active');
    }

    const questionsById = new Map(template.questions.map((q) => [q.id, q]));
    const answeredIds = new Set<string>();
    for (const answer of dto.answers) {
      if (!questionsById.has(answer.questionId)) {
        throw new BadRequestException('An answer refers to a question that is not part of this questionnaire');
      }
      answeredIds.add(answer.questionId);
    }
    for (const question of template.questions) {
      if (question.required) {
        const answer = dto.answers.find((a) => a.questionId === question.id);
        if (!answer || answer.value.trim().length === 0) {
          throw new BadRequestException('A required question was left unanswered');
        }
      }
    }

    return this.prisma.questionnaireResponse.create({
      data: {
        templateId: template.id,
        patientProfileId,
        submittedByUserId: actor.id,
        answers: {
          create: dto.answers.map((a) => ({ questionId: a.questionId, value: a.value })),
        },
      },
      include: { answers: true, template: { include: TEMPLATE_WITH_QUESTIONS } },
    });
  }

  async listResponsesForPatient(patientProfileId: string, actor: AuthenticatedUser) {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);
    return this.prisma.questionnaireResponse.findMany({
      where: { patientProfileId },
      include: { answers: true, template: { include: TEMPLATE_WITH_QUESTIONS } },
      orderBy: { submittedAt: 'desc' },
    });
  }

  private async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }
}
