import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateLevelVersionSchema = z.object({
  versionNumber: z.number().int().positive(),
  cognitiveVideo1Url: z.url().optional(),
  cognitiveVideo1Question: z.string().optional(),
  cognitiveVideo2Url: z.url().optional(),
  cognitiveVideo2Question: z.string().optional(),
  behavioralTechnique: z.string().min(1),
  humanModelVideoUrl: z.url().optional(),
  humanModelDurationSeconds: z.number().int().positive().optional(),
  trainingListJson: z.string().min(1),
  samplePartTemplateJson: z.string().min(1),
});

export class CreateLevelVersionDto extends createZodDto(CreateLevelVersionSchema) {}
