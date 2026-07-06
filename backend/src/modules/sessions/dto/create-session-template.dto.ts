import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateSessionTemplateSchema = z.object({
  sessionNumber: z.number().int().min(1).max(30),
  category: z.number().int().min(1).max(11),
  cognitiveVideoUrl: z.url().optional(),
  behavioralVideoUrl: z.url().optional(),
  trainingDurationDays: z.number().int().min(1),
  instructions: z.string().min(1),
});

export class CreateSessionTemplateDto extends createZodDto(CreateSessionTemplateSchema) {}
