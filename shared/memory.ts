import { z } from 'zod';
import type { ChatRequest, ModuleId, Project } from './types.js';
import { allowsChatContext } from './chatContext.js';
import { currentCoverage, currentReview, storedTopicCoverageSchema } from './coverage.js';
import { topicReviewSchema } from './review.js';

const line = z.string().trim().min(1).max(200);
export const chatMemorySchema = z.strictObject({
  facts: z.array(z.strictObject({ text: line, evidence: z.string().trim().min(4).max(240) })).max(6),
  hypotheses: z.array(line).max(3),
  openQuestions: z.array(line).max(3),
  coverage: storedTopicCoverageSchema.optional(),
  review: topicReviewSchema.optional(),
});

// Always carry the active conversation first, then the most recent other stages.
// This bounds additional context without truncating a statement or its evidence.
export function collectMemories(project: Project): NonNullable<ChatRequest['context']['memories']> {
  let remaining = 14_000;
  return Object.entries(project.modules)
    .filter(([id, state]) => state.memory && allowsChatContext(project, id as ModuleId, state.memory.updatedAt))
    .sort(([a, x], [b, y]) => a === project.activeModule ? -1 : b === project.activeModule ? 1 : y.memory!.updatedAt.localeCompare(x.memory!.updatedAt))
    .flatMap(([moduleId, state]) => {
      const { coverage: _coverage, review: _review, ...plain } = state.memory!.content;
      const coverage = currentCoverage(project, moduleId as ModuleId);
      const review = currentReview(project, moduleId as ModuleId);
      const item = { moduleId: moduleId as ModuleId, content: { ...plain, ...(coverage ? { coverage } : {}), ...(review ? { review } : {}) }, updatedAt: state.memory!.updatedAt, ...(state.memory!.needsRefresh ? { needsRefresh: true } : {}) };
      const size = JSON.stringify(item).length;
      if (size > remaining) return [];
      remaining -= size;
      return [item];
    });
}
