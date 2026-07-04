import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GuardianLink, PatientProfile, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { calculateAge } from './patient-age.util';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { LinkGuardianDto } from './dto/link-guardian.dto';
import { AuthenticatedUser } from '../../common/auth/session.guard';

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePatientDto): Promise<PatientProfile> {
    const targetUser = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const existingProfile = await this.prisma.patientProfile.findUnique({ where: { userId: dto.userId } });
    if (existingProfile) {
      throw new ConflictException('Patient profile already exists for this user');
    }

    const existingNationalId = await this.prisma.patientProfile.findUnique({
      where: { nationalId: dto.nationalId },
    });
    if (existingNationalId) {
      throw new ConflictException('National ID already registered');
    }

    const dateOfBirth = new Date(dto.dateOfBirth);
    const age = calculateAge(dateOfBirth);
    if (age < 18 && !dto.guardianUserId) {
      throw new BadRequestException('Patients under 18 require guardianUserId at creation time');
    }

    if (dto.guardianUserId) {
      const guardian = await this.prisma.user.findUnique({ where: { id: dto.guardianUserId } });
      if (!guardian || guardian.role !== Role.CAREGIVER) {
        throw new BadRequestException('guardianUserId must reference an existing user with role CAREGIVER');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.patientProfile.create({
        data: {
          userId: dto.userId,
          fullName: dto.fullName,
          gender: dto.gender,
          dateOfBirth,
          nationalId: dto.nationalId,
          address: dto.address,
          referralSource: dto.referralSource,
          clinicalInfo: dto.clinicalInfo ? { create: dto.clinicalInfo } : undefined,
        },
        include: { clinicalInfo: true },
      });

      if (dto.guardianUserId) {
        await tx.guardianLink.create({
          data: {
            patientUserId: dto.userId,
            guardianUserId: dto.guardianUserId,
            relationship: 'GUARDIAN',
          },
        });
      }

      return created;
    });
  }

  async findById(id: string, actor: AuthenticatedUser): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { id },
      include: { clinicalInfo: true },
    });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    await this.assertCanAccess(actor, profile);
    return profile;
  }

  async update(id: string, dto: UpdatePatientDto, actor: AuthenticatedUser): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    await this.assertCanAccess(actor, profile);

    return this.prisma.patientProfile.update({
      where: { id },
      data: {
        fullName: dto.fullName,
        address: dto.address,
        referralSource: dto.referralSource,
      },
      include: { clinicalInfo: true },
    });
  }

  private async assertCanAccess(actor: AuthenticatedUser, profile: PatientProfile): Promise<void> {
    if (actor.role === Role.CLINICIAN || actor.role === Role.SUPERVISOR || actor.role === Role.ADMIN) {
      return;
    }
    if (actor.role === Role.PATIENT) {
      if (profile.userId === actor.id) {
        return;
      }
      throw new ForbiddenException("Cannot access another patient's profile");
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

  async linkGuardian(patientProfileId: string, dto: LinkGuardianDto): Promise<GuardianLink> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }

    const guardian = await this.prisma.user.findUnique({ where: { id: dto.guardianUserId } });
    if (!guardian || guardian.role !== Role.CAREGIVER) {
      throw new BadRequestException('guardianUserId must reference an existing user with role CAREGIVER');
    }

    const existingLink = await this.prisma.guardianLink.findFirst({
      where: { patientUserId: profile.userId, guardianUserId: dto.guardianUserId },
    });
    if (existingLink) {
      throw new ConflictException('This guardian is already linked to this patient');
    }

    return this.prisma.guardianLink.create({
      data: {
        patientUserId: profile.userId,
        guardianUserId: dto.guardianUserId,
        relationship: dto.relationship,
      },
    });
  }
}
