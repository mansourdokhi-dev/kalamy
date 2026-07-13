import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RequestInterventionSchema = z.object({
  interventionType: z.enum(['VIDEO_MEETING', 'VOICE_CONSULTATION', 'TARGETED_MESSAGE', 'CLINICAL_ACTION']),
  reasonNote: z.string().min(1),
});

export class RequestInterventionDto extends createZodDto(RequestInterventionSchema) {}
