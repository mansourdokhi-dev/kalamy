import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RequestConsultationSchema = z.object({
  type: z.enum(['VIDEO', 'VOICE']),
  reasonNote: z.string().min(1).max(2000),
});

export class RequestConsultationDto extends createZodDto(RequestConsultationSchema) {}
