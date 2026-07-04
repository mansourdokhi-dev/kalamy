import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PatientProfile, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { calculateAge } from './patient-age.util';
import { CreatePatientDto } from './dto/create-patient.dto';

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
}
