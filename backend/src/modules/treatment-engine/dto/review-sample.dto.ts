import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ReviewSampleSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('TRANSITION'),
    clinicianOpinionScore: z.number().int().min(1).max(9),
    reviewNotes: z.string().optional(),
  }),
  z.object({
    decision: z.literal('LEVEL_REPEAT'),
    clinicianOpinionScore: z.number().int().min(1).max(9),
    reviewNotes: z.string().optional(),
  }),
  z.object({
    decision: z.literal('TECHNICAL_RERECORD'),
    damagedPartIds: z.array(z.string().uuid()).min(1),
    reviewNotes: z.string().optional(),
  }),
]);

// `createZodDto(...).extends` doesn't type-check for discriminated unions: TS
// rejects a class `extends` clause whose base constructor returns a union type
// (TS2509). The runtime class (isZodDto/schema/create — what nestjs-zod's
// ZodValidationPipe actually needs) still works fine as a plain value, so we
// merge a type alias with a const of the same name instead of subclassing.
export type ReviewSampleDto = z.infer<typeof ReviewSampleSchema>;
export const ReviewSampleDto = createZodDto(ReviewSampleSchema);
