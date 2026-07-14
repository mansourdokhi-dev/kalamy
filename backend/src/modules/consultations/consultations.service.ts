import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Consultation, PatientProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { RequestConsultationDto } from './dto/request-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';

const TERMINAL_STATUSES = ['COMPLETED', 'CANCELLED'];

@Injectable()
export class ConsultationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
  ) {}

  async request(patientProfileId: string, dto: RequestConsultationDto, actor: AuthenticatedUser): Promise<Consultation> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    return this.prisma.$transaction(async (tx) => {
      // Row-lock the patient profile so two concurrent requests can't both
      // pass the "no active consultation" check before either commits (§119).
      await tx.$queryRaw`SELECT id FROM "PatientProfile" WHERE id = ${patientProfileId} FOR UPDATE`;

      const activeOrCompleted = await tx.consultation.findFirst({
        where: { patientProfileId, status: { not: 'CANCELLED' } },
      });
      if (activeOrCompleted) {
        throw new ConflictException(
          activeOrCompleted.status === 'COMPLETED'
            ? 'The one free consultation has already been used'
            : `A consultation request is already ${activeOrCompleted.status.toLowerCase()}`,
        );
      }

      return tx.consultation.create({
        data: {
          patientProfileId,
          requestedByUserId: actor.id,
          type: dto.type,
          reasonNote: dto.reasonNote,
        },
      });
    });
  }

  async update(consultationId: string, dto: UpdateConsultationDto, actor: AuthenticatedUser): Promise<Consultation> {
    const consultation = await this.prisma.consultation.findUnique({ where: { id: consultationId } });
    if (!consultation) {
      throw new NotFoundException('Consultation not found');
    }
    const profile = await this.findPatientProfileOrThrow(consultation.patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    // A COMPLETED or CANCELLED consultation is a terminal record: without this guard, a clinician
    // could re-open (e.g. re-schedule) a consultation that already consumed the patient's one free
    // credit, or overwrite the outcome notes/cancellation timestamp of a closed record after the
    // fact. Wrapped in a transaction with a row lock so two concurrent PATCHes on the same
    // consultation (e.g. one clinician cancelling while another completes it) can't both read the
    // pre-update status and race past this check — the same TOCTOU class already guarded against
    // elsewhere in this codebase (recordAttempt, submitSample, specialist review).
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Consultation" WHERE id = ${consultationId} FOR UPDATE`;

      const fresh = await tx.consultation.findUniqueOrThrow({ where: { id: consultationId } });
      if (TERMINAL_STATUSES.includes(fresh.status)) {
        return { blocked: true as const, status: fresh.status };
      }

      const newScheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : undefined;
      // A patient who reschedules must still get reminders for their new time — leaving
      // stale "already sent" stamps from the old time would silently drop both reminders
      // instead of re-arming them, since the sweep only ever looks at whether each stamp
      // is still null.
      const scheduledAtChanged = newScheduledAt !== undefined && newScheduledAt.getTime() !== fresh.scheduledAt?.getTime();

      const updated = await tx.consultation.update({
        where: { id: consultationId },
        data: {
          status: dto.status,
          scheduledAt: newScheduledAt,
          externalMeetingLink: dto.externalMeetingLink,
          outcomeNotes: dto.outcomeNotes,
          specialistUserId: dto.status ? actor.id : undefined,
          completedAt: dto.status === 'COMPLETED' ? new Date() : undefined,
          cancelledAt: dto.status === 'CANCELLED' ? new Date() : undefined,
          ...(scheduledAtChanged ? { dayBeforeReminderSentAt: null, hourBeforeReminderSentAt: null } : {}),
        },
      });
      return { blocked: false as const, consultation: updated };
    });

    if (result.blocked) {
      throw new ConflictException(`Cannot update a consultation that is already ${result.status.toLowerCase()}`);
    }
    return result.consultation;
  }

  async listForPatient(patientProfileId: string, actor: AuthenticatedUser): Promise<Consultation[]> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);
    return this.prisma.consultation.findMany({ where: { patientProfileId }, orderBy: { createdAt: 'desc' } });
  }

  private async findPatientProfileOrThrow(patientProfileId: string): Promise<PatientProfile> {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientProfileId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    return profile;
  }
}
