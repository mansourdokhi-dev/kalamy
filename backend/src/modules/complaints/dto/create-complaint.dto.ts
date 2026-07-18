import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateComplaintSchema = z.object({
  type: z.enum(['COMPLAINT', 'SUGGESTION']),
  subject: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  relatedClinicianUserId: z.uuid().optional(),
});

export class CreateComplaintDto extends createZodDto(CreateComplaintSchema) {}
