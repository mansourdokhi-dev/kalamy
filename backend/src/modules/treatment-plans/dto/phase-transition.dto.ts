import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PhaseTransitionSchema = z.object({
  toPhase: z.enum(['PHASE_1', 'PHASE_2', 'PHASE_3', 'PHASE_4', 'PHASE_5']),
  rationale: z.string().optional(),
});

export class PhaseTransitionDto extends createZodDto(PhaseTransitionSchema) {}
