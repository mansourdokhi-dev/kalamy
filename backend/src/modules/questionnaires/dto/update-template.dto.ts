import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateTemplateSchema = z.object({
  isActive: z.boolean(),
});

export class UpdateTemplateDto extends createZodDto(UpdateTemplateSchema) {}
