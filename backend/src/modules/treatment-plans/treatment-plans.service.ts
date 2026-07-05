import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile, PhaseTransition, Role, TreatmentPlan } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTreatmentPlanDto } from './dto/create-treatment-plan.dto';
import { UpdateTreatmentPlanDto } from './dto/update-treatment-plan.dto';
import { PhaseTransitionDto } from './dto/phase-transition.dto';
import { AuthenticatedUser } from '../../common/auth/session.guard';

@Injectable()
export class TreatmentPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async create(patientProfileId: string, dto: CreateTreatmentPlanDto, actor: AuthenticatedUser): Promise<TreatmentPlan> {
    await this.findPatientProfileOrThrow(patientProfileId);

    const assessment = await this.prisma.assessment.findUnique({ where: { id: dto.assessmentId } });
    if (!assessment || assessment.patientProfileId !== patientProfileId) {
      throw new NotFoundException('Assessment not found for this patient');
    }
    if (assessment.status !== 'APPROVED') {
      throw new BadRequestException('Treatment plan requires an approved assessment');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.treatmentPlan.updateMany({
        where: { patientProfileId, status: 'ACTIVE' },
        data: { status: 'INACTIVE' },
      });

      return tx.treatmentPlan.create({
        data: {
          patientProfileId,
          clinicianUserId: actor.id,
          assessmentId: dto.assessmentId,
          goals: dto.goals,
          reviewDate: new Date(dto.reviewDate),
        },
      });
    });
  }

  async findAllForPatient(patientProfileId: string, actor: AuthenticatedUser): Promise<TreatmentPlan[]> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.assertCanAccess(actor, profile);
    return this.prisma.treatmentPlan.findMany({
      where: { patientProfileId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveForPatient(patientProfileId: string, actor: AuthenticatedUser): Promise<TreatmentPlan> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.assertCanAccess(actor, profile);
    const plan = await this.prisma.treatmentPlan.findFirst({
      where: { patientProfileId, status: 'ACTIVE' },
    });
    if (!plan) {
      throw new NotFoundException('No active treatment plan for this patient');
    }
    return plan;
  }

  async findByIdOrThrow(patientProfileId: string, id: string): Promise<TreatmentPlan> {
    const plan = await this.prisma.treatmentPlan.findUnique({ where: { id } });
    if (!plan || plan.patientProfileId !== patientProfileId) {
      throw new NotFoundException('Treatment plan not found');
    }
    return plan;
  }

  async update(patientProfileId: string, id: string, dto: UpdateTreatmentPlanDto): Promise<TreatmentPlan> {
    await this.findByIdOrThrow(patientProfileId, id);
    return this.prisma.treatmentPlan.update({
      where: { id },
      data: {
        goals: dto.goals,
        reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : undefined,
      },
    });
  }

  async recordPhaseTransition(
    patientProfileId: string,
    id: string,
    dto: PhaseTransitionDto,
    actor: AuthenticatedUser,
  ): Promise<TreatmentPlan> {
    const plan = await this.findByIdOrThrow(patientProfileId, id);

    return this.prisma.$transaction(async (tx) => {
      await tx.phaseTransition.create({
        data: {
          treatmentPlanId: id,
          fromPhase: plan.phase,
          toPhase: dto.toPhase,
          clinicianUserId: actor.id,
          rationale: dto.rationale,
        },
      });

      return tx.treatmentPlan.update({
        where: { id },
        data: { phase: dto.toPhase },
      });
    });
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
      throw new ForbiddenException("Cannot access another patient's treatment plans");
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
