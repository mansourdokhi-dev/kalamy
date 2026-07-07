import { Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

export interface AssessmentResultsReport {
  patientProfileId: string;
  assessments: Array<{
    id: string;
    type: string;
    status: string;
    ssi4Frequency: number | null;
    ssi4Duration: number | null;
    ssi4PhysicalConcomitants: number | null;
    ssi4Total: number | null;
    severityCategory: string | null;
    approvedAt: Date | null;
    createdAt: Date;
  }>;
}

export interface MedicalReport {
  patientProfileId: string;
  patientFullName: string;
  clinicalInfo: {
    referralReason: string | null;
    initialDiagnosis: string | null;
    medicalHistory: string | null;
    medications: string | null;
    allergies: string | null;
    familyHistory: string | null;
  } | null;
  latestApprovedAssessment: {
    id: string;
    type: string;
    severityCategory: string | null;
    ssi4Total: number | null;
    approvedAt: Date | null;
  } | null;
  activeTreatmentPlan: {
    id: string;
    phase: string;
    goals: string;
    reviewDate: Date;
  } | null;
}

export interface OperationalStatusReport {
  usersByRole: Record<string, number>;
  patientProfilesByStatus: Record<string, number>;
  treatmentPlansByStatus: Record<string, number>;
  patientSessionsByStatus: Record<string, number>;
}

export interface RegisteredUserSummary {
  id: string;
  fullName: string;
  mobile: string;
  role: string;
  status: string;
  createdAt: Date;
  caseProgressSummary: string | null;
}

export interface ServiceModificationLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorFullName: string | null;
  actorRole: string | null;
  createdAt: Date;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
  ) {}

  async getAssessmentResultsReport(patientProfileId: string, actor: AuthenticatedUser): Promise<AssessmentResultsReport> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const assessments = await this.prisma.assessment.findMany({
      where: { patientProfileId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      patientProfileId,
      assessments: assessments.map((a) => ({
        id: a.id,
        type: a.type,
        status: a.status,
        ssi4Frequency: a.ssi4Frequency,
        ssi4Duration: a.ssi4Duration,
        ssi4PhysicalConcomitants: a.ssi4PhysicalConcomitants,
        ssi4Total: a.ssi4Total,
        severityCategory: a.severityCategory,
        approvedAt: a.approvedAt,
        createdAt: a.createdAt,
      })),
    };
  }

  async getMedicalReport(patientProfileId: string, actor: AuthenticatedUser): Promise<MedicalReport> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    const clinicalInfo = await this.prisma.patientClinicalInfo.findUnique({ where: { patientProfileId } });
    const latestApprovedAssessment = await this.prisma.assessment.findFirst({
      where: { patientProfileId, status: 'APPROVED' },
      orderBy: { approvedAt: 'desc' },
    });
    const activePlan = await this.prisma.treatmentPlan.findFirst({
      where: { patientProfileId, status: 'ACTIVE' },
    });

    return {
      patientProfileId,
      patientFullName: profile.fullName,
      clinicalInfo: clinicalInfo
        ? {
            referralReason: clinicalInfo.referralReason,
            initialDiagnosis: clinicalInfo.initialDiagnosis,
            medicalHistory: clinicalInfo.medicalHistory,
            medications: clinicalInfo.medications,
            allergies: clinicalInfo.allergies,
            familyHistory: clinicalInfo.familyHistory,
          }
        : null,
      latestApprovedAssessment: latestApprovedAssessment
        ? {
            id: latestApprovedAssessment.id,
            type: latestApprovedAssessment.type,
            severityCategory: latestApprovedAssessment.severityCategory,
            ssi4Total: latestApprovedAssessment.ssi4Total,
            approvedAt: latestApprovedAssessment.approvedAt,
          }
        : null,
      activeTreatmentPlan: activePlan
        ? {
            id: activePlan.id,
            phase: activePlan.phase,
            goals: activePlan.goals,
            reviewDate: activePlan.reviewDate,
          }
        : null,
    };
  }

  async getOperationalStatusReport(): Promise<OperationalStatusReport> {
    const [usersByRoleRaw, profilesByStatusRaw, plansByStatusRaw, sessionsByStatusRaw] = await Promise.all([
      this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      this.prisma.patientProfile.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.treatmentPlan.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.patientSession.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    return {
      usersByRole: this.zeroFillCounts(['PATIENT', 'CAREGIVER', 'CLINICIAN', 'SUPERVISOR', 'ADMIN'], usersByRoleRaw, 'role'),
      patientProfilesByStatus: this.zeroFillCounts(['ACTIVE', 'DISABLED'], profilesByStatusRaw, 'status'),
      treatmentPlansByStatus: this.zeroFillCounts(['ACTIVE', 'INACTIVE'], plansByStatusRaw, 'status'),
      patientSessionsByStatus: this.zeroFillCounts(
        ['IN_TRAINING', 'SUBMITTED', 'APPROVED', 'REPEAT_REQUIRED'],
        sessionsByStatusRaw,
        'status',
      ),
    };
  }

  async getRegisteredUsersReport(): Promise<RegisteredUserSummary[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      include: { patientProfile: true },
    });

    const summaries: RegisteredUserSummary[] = [];
    for (const user of users) {
      let caseProgressSummary: string | null = null;
      if (user.role === 'PATIENT') {
        caseProgressSummary = 'Not started';
        if (user.patientProfile) {
          const latestSession = await this.prisma.patientSession.findFirst({
            where: { patientProfileId: user.patientProfile.id },
            orderBy: { createdAt: 'desc' },
            include: { sessionTemplate: true },
          });
          if (latestSession) {
            caseProgressSummary = `Session ${latestSession.sessionTemplate.sessionNumber} (${latestSession.status})`;
          }
        }
      }
      summaries.push({
        id: user.id,
        fullName: user.fullName,
        mobile: user.mobile,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        caseProgressSummary,
      });
    }
    return summaries;
  }

  async getServiceModificationLogReport(filters: { from?: Date; to?: Date }): Promise<ServiceModificationLogEntry[]> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        createdAt: {
          gte: filters.from,
          lte: filters.to,
        },
      },
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });

    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      actorFullName: log.user?.fullName ?? null,
      actorRole: log.user?.role ?? null,
      createdAt: log.createdAt,
    }));
  }

  private zeroFillCounts<K extends string>(
    allKeys: K[],
    rows: Array<Record<string, unknown> & { _count: { _all: number } }>,
    keyField: string,
  ): Record<K, number> {
    const result = Object.fromEntries(allKeys.map((key) => [key, 0])) as Record<K, number>;
    for (const row of rows) {
      const key = row[keyField] as K;
      result[key] = row._count._all;
    }
    return result;
  }

  private async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }
}
