import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Assessment, PatientProfile, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { UpdateAssessmentDto } from './dto/update-assessment.dto';
import { ApproveAssessmentDto } from './dto/approve-assessment.dto';
import { AuthenticatedUser } from '../../common/auth/session.guard';

@Injectable()
export class AssessmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(patientProfileId: string, dto: CreateAssessmentDto, actor: AuthenticatedUser): Promise<Assessment> {
    await this.findPatientProfileOrThrow(patientProfileId);
    return this.prisma.assessment.create({
      data: {
        patientProfileId,
        clinicianUserId: actor.id,
        type: dto.type,
      },
    });
  }

  async findAllForPatient(patientProfileId: string, actor: AuthenticatedUser): Promise<Assessment[]> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.assertCanAccess(actor, profile);
    return this.prisma.assessment.findMany({
      where: { patientProfileId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(patientProfileId: string, id: string, actor: AuthenticatedUser): Promise<Assessment> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.assertCanAccess(actor, profile);
    const assessment = await this.prisma.assessment.findUnique({ where: { id } });
    if (!assessment || assessment.patientProfileId !== patientProfileId) {
      throw new NotFoundException('Assessment not found');
    }
    return assessment;
  }

  async update(patientProfileId: string, id: string, dto: UpdateAssessmentDto): Promise<Assessment> {
    const assessment = await this.findOwnAssessmentOrThrow(patientProfileId, id);
    if (assessment.status !== 'DRAFT') {
      throw new BadRequestException('Only a DRAFT assessment can be edited');
    }
    return this.prisma.assessment.update({
      where: { id },
      data: {
        medicalHistory: dto.medicalHistory,
        difficultSituations: dto.difficultSituations,
        anxietyLevel: dto.anxietyLevel,
        initialGoals: dto.initialGoals,
        clinicianNotes: dto.clinicianNotes,
        ssi4Frequency: dto.ssi4Frequency,
        ssi4Duration: dto.ssi4Duration,
        ssi4PhysicalConcomitants: dto.ssi4PhysicalConcomitants,
        ssi4Total: dto.ssi4Total,
      },
    });
  }

  async approve(patientProfileId: string, id: string, dto: ApproveAssessmentDto): Promise<Assessment> {
    const assessment = await this.findOwnAssessmentOrThrow(patientProfileId, id);
    if (assessment.status !== 'DRAFT') {
      throw new BadRequestException('Assessment is already approved');
    }
    return this.prisma.assessment.update({
      where: { id },
      data: {
        status: 'APPROVED',
        severityCategory: dto.severityCategory,
        approvedAt: new Date(),
      },
    });
  }

  private async findOwnAssessmentOrThrow(patientProfileId: string, id: string): Promise<Assessment> {
    const assessment = await this.prisma.assessment.findUnique({ where: { id } });
    if (!assessment || assessment.patientProfileId !== patientProfileId) {
      throw new NotFoundException('Assessment not found');
    }
    return assessment;
  }

  private async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }

  private async assertCanAccess(actor: AuthenticatedUser, profile: PatientProfile): Promise<void> {
    if (actor.role === Role.CLINICIAN || actor.role === Role.SUPERVISOR || actor.role === Role.ADMIN) {
      return;
    }
    if (actor.role === Role.PATIENT) {
      if (profile.userId === actor.id) {
        return;
      }
      throw new ForbiddenException("Cannot access another patient's assessments");
    }
    if (actor.role === Role.CAREGIVER) {
      const link = await this.prisma.guardianLink.findFirst({
        where: { guardianUserId: actor.id, patientUserId: profile.userId },
      });
      if (link) {
        return;
      }
      throw new ForbiddenException('Not linked as guardian for this patient');
    }
    throw new ForbiddenException('Access denied');
  }
}
