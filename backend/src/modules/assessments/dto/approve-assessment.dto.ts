import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ApproveAssessmentSchema = z.object({
  severityCategory: z.enum(['MILD', 'MODERATE', 'SEVERE', 'VERY_SEVERE']),
});

export class ApproveAssessmentDto extends createZodDto(ApproveAssessmentSchema) {}
