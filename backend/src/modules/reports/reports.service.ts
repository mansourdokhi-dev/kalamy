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

  private async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }
}
