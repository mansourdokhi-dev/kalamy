import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateComplaintSchema = z.object({
  type: z.enum(['COMPLAINT', 'SUGGESTION']),
  subject: z.string().min(1),
  description: z.string().min(1),
  relatedClinicianUserId: z.uuid().optional(),
});

export class CreateComplaintDto extends createZodDto(CreateComplaintSchema) {}
