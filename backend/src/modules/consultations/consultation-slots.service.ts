import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConsultationSlot } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { CreateSlotDto } from './dto/create-slot.dto';

const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED'];

@Injectable()
export class ConsultationSlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
  ) {}

  async createSlot(dto: CreateSlotDto, actor: AuthenticatedUser): Promise<ConsultationSlot> {
    const startsAt = new Date(dto.startsAt);
    if (startsAt.getTime() <= Date.now()) {
      throw new BadRequestException('A consultation slot must be in the future');
    }
    return this.prisma.consultationSlot.create({
      data: { staffUserId: actor.id, startsAt, durationMinutes: dto.durationMinutes ?? 30 },
    });
  }

  async listMine(actor: AuthenticatedUser): Promise<ConsultationSlot[]> {
    return this.prisma.consultationSlot.findMany({
      where: { staffUserId: actor.id },
      orderBy: { startsAt: 'asc' },
    });
  }

  async listAvailable(): Promise<ConsultationSlot[]> {
    return this.prisma.consultationSlot.findMany({
      where: { status: 'AVAILABLE', startsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
    });
  }

  // Books a slot for a patient's consultation: sets the consultation's scheduledAt
  // and status to SCHEDULED, and flips the slot to BOOKED. Row-locks the slot so two
  // patients can't book the same one (same TOCTOU-guard pattern used across this repo).
  async bookSlot(consultationId: string, slotId: string, actor: AuthenticatedUser): Promise<ConsultationSlot> {
    const consultation = await this.prisma.consultation.findUnique({ where: { id: consultationId } });
    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }
    const profile = await this.prisma.patientProfile.findUniqueOrThrow({ where: { id: consultation.patientProfileId } });
    await this.patientAccessService.assertCanAccess(actor, profile);

    if (TERMINAL_STATUSES.includes(consultation.status)) {
      throw new ConflictException(`Cannot book a slot for a consultation that is already ${consultation.status.toLowerCase()}`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ConsultationSlot" WHERE id = ${slotId} FOR UPDATE`;

      const slot = await tx.consultationSlot.findUnique({ where: { id: slotId } });
      if (!slot) {
        throw new NotFoundException('Slot not found');
      }
      if (slot.status !== 'AVAILABLE') {
        throw new ConflictException('This slot has already been booked');
      }
      if (slot.startsAt.getTime() <= Date.now()) {
        throw new ConflictException('This slot is in the past');
      }

      await tx.consultation.update({
        where: { id: consultationId },
        data: { status: 'SCHEDULED', scheduledAt: slot.startsAt, specialistUserId: slot.staffUserId, dayBeforeReminderSentAt: null, hourBeforeReminderSentAt: null },
      });
      return tx.consultationSlot.update({
        where: { id: slotId },
        data: { status: 'BOOKED', consultationId },
      });
    });
  }
}
