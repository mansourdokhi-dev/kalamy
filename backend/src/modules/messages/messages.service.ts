import { Injectable, NotFoundException } from '@nestjs/common';
import { PatientMessage, PatientProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
  ) {}

  async send(patientProfileId: string, dto: SendMessageDto, actor: AuthenticatedUser): Promise<PatientMessage> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);
    return this.prisma.patientMessage.create({
      data: { patientProfileId, senderUserId: actor.id, body: dto.body },
    });
  }

  // Returns the whole thread oldest-first, and marks every message the *other*
  // party sent as read — so the sender can see when their messages were seen.
  async listForPatient(patientProfileId: string, actor: AuthenticatedUser): Promise<PatientMessage[]> {
    const profile = await this.findPatientProfileOrThrow(patientProfileId);
    await this.patientAccessService.assertCanAccess(actor, profile);

    await this.prisma.patientMessage.updateMany({
      where: { patientProfileId, senderUserId: { not: actor.id }, readAt: null },
      data: { readAt: new Date() },
    });

    return this.prisma.patientMessage.findMany({
      where: { patientProfileId },
      orderBy: { createdAt: 'asc' },
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
