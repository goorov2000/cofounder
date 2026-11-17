import { z } from 'zod';

export const PROCESS_CHECK_IDS = ['context', 'help', 'questions', 'integrity'] as const;
export const nextStepSchema = z.enum(['research', 'ask_user', 'complete', 'blocked']).nullable();
export const processReviewSchema = z.strictObject({
  status: z.enum(['passed', 'needs_work']),
  note: z.string().trim().min(1).max(400),
  checks: z.array(z.strictObject({
    id: z.enum(PROCESS_CHECK_IDS), status: z.enum(['passed', 'failed', 'not_applicable']),
    reason: z.string().trim().min(1).max(300),
  })).length(PROCESS_CHECK_IDS.length),
}).refine(value => new Set(value.checks.map(check => check.id)).size === PROCESS_CHECK_IDS.length);
export const resultReviewSchema = z.strictObject({
  status: z.enum(['ready', 'in_progress', 'needs_work']), note: z.string().trim().min(1).max(400),
});
export const topicReviewSchema = z.strictObject({
  version: z.literal(1), status: z.enum(['completed', 'unavailable']), model: z.string().min(1).max(100),
  subjectHash: z.string().regex(/^[a-f0-9]{64}$/), assessedAt: z.string().datetime(),
  process: processReviewSchema.nullable(), result: resultReviewSchema.nullable(),
  nextAction: z.string().trim().min(1).max(400).nullable(), errorCode: z.string().max(100).nullable(),
  nextStep: nextStepSchema.optional(),
}).refine(value => value.status === 'completed'
  ? Boolean(value.process && value.result && !value.errorCode)
  : value.process === null && value.result === null && value.errorCode !== null);
export type TopicReview = z.infer<typeof topicReviewSchema>;
