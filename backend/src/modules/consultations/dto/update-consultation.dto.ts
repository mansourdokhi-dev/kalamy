import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateConsultationSchema = z.object({
  status: z.enum(['SCHEDULING', 'SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
  scheduledAt: z.string().datetime().optional(),
  externalMeetingLink: z.string().url().optional(),
  outcomeNotes: z.string().min(1).max(2000).optional(),
});

export class UpdateConsultationDto extends createZodDto(UpdateConsultationSchema) {}
