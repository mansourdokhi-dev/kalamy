import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
});

export class UpdateUserStatusDto extends createZodDto(UpdateUserStatusSchema) {}
