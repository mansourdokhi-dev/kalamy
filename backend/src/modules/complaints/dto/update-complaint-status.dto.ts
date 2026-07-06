import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateComplaintStatusSchema = z.object({
  status: z.enum(['OPEN', 'REVIEWED', 'RESOLVED']),
});

export class UpdateComplaintStatusDto extends createZodDto(UpdateComplaintStatusSchema) {}
