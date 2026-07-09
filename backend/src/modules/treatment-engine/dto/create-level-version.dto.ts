import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const TrainingListSchema = z.array(z.string().min(1)).min(1);

const SamplePartTemplateSchema = z
  .array(
    z.object({
      partType: z.string().min(1),
      label: z.string().min(1),
      order: z.number().int().positive(),
      required: z.boolean(),
    }),
  )
  .min(1);

function jsonArrayField<T>(schema: z.ZodType<T>) {
  return z.string().min(1).refine(
    (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return false;
      }
      return schema.safeParse(parsed).success;
    },
    { message: 'Must be a JSON string matching the expected array shape' },
  );
}

export const CreateLevelVersionSchema = z.object({
  versionNumber: z.number().int().positive(),
  cognitiveVideo1Url: z.url().optional(),
  cognitiveVideo1Question: z.string().optional(),
  cognitiveVideo2Url: z.url().optional(),
  cognitiveVideo2Question: z.string().optional(),
  behavioralTechnique: z.string().min(1),
  humanModelVideoUrl: z.url().optional(),
  humanModelDurationSeconds: z.number().int().positive().optional(),
  trainingListJson: jsonArrayField(TrainingListSchema),
  samplePartTemplateJson: jsonArrayField(SamplePartTemplateSchema),
});

export class CreateLevelVersionDto extends createZodDto(CreateLevelVersionSchema) {}
