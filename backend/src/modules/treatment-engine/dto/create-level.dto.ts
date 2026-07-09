import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateLevelSchema = z.object({
  name: z.string().min(1),
  order: z.number().int().positive(),
});

export class CreateLevelDto extends createZodDto(CreateLevelSchema) {}
