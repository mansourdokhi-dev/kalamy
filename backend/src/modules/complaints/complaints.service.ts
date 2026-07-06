import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Complaint } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';
import { CreateComplaintDto } from './dto/create-complaint.dto';

export interface ComplaintFilters {
  status?: 'OPEN' | 'REVIEWED' | 'RESOLVED';
  relatedClinicianUserId?: string;
}

@Injectable()
export class ComplaintsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateComplaintDto, actor: AuthenticatedUser): Promise<Complaint> {
    if (dto.relatedClinicianUserId) {
      const clinician = await this.prisma.user.findUnique({ where: { id: dto.relatedClinicianUserId } });
      if (!clinician) {
        throw new NotFoundException('Related clinician not found');
      }
    }
    return this.prisma.complaint.create({
      data: {
        submittedByUserId: actor.id,
        relatedClinicianUserId: dto.relatedClinicianUserId,
        type: dto.type,
        subject: dto.subject,
        description: dto.description,
      },
    });
  }

  async listAll(filters: ComplaintFilters): Promise<Complaint[]> {
    return this.prisma.complaint.findMany({
      where: {
        status: filters.status,
        relatedClinicianUserId: filters.relatedClinicianUserId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, actor: AuthenticatedUser): Promise<Complaint> {
    const complaint = await this.prisma.complaint.findUnique({ where: { id } });
    if (!complaint) {
      throw new NotFoundException('Complaint not found');
    }
    if (actor.role === 'ADMIN' || actor.role === 'SUPERVISOR') {
      return complaint;
    }
    if (complaint.submittedByUserId === actor.id) {
      return complaint;
    }
    throw new ForbiddenException("Cannot view another user's complaint");
  }
}
