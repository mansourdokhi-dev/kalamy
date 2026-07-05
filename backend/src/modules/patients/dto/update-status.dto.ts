import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
});

export class UpdateStatusDto extends createZodDto(UpdateStatusSchema) {}
