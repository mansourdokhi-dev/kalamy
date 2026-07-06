import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateSessionTemplateSchema = z.object({
  category: z.number().int().min(1).max(11).optional(),
  cognitiveVideoUrl: z.url().optional(),
  behavioralVideoUrl: z.url().optional(),
  trainingDurationDays: z.number().int().min(1).optional(),
  instructions: z.string().min(1).optional(),
});

export class UpdateSessionTemplateDto extends createZodDto(UpdateSessionTemplateSchema) {}
