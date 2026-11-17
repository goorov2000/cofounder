/** Offline diagnostics for the observed F1 concerns. Does not call a provider or bypass live acceptance. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createProject } from '../../shared/domain';
import { ensureCore } from '../../shared/coreMemory';
import { validateMemoryValue } from '../../shared/coreValidation';
import { replySchema, validateReply } from '../../server/validation';
import { applyAnswer } from '../../src/features/workspace/answerRequests';
import { assertRequestFits } from '../../src/lib/api';
import { makeRequest } from './fixtures';
import type { AssistantReply, ChatRequest, ExternalEvidence, MemoryOperation, MemoryPatch } from '../../shared/types';

const root = '.autopilot/2026-11-15-bot-core--wip/evidence';
const { project, request } = makeRequest(ensureCore(createProject()), 'idea', 'Сравни источники.');
const evidence: ExternalEvidence[] = Array.from({ length: 6 }, (_, index) => ({
  id: `page${index}`, version: 1, projectId: request.projectId, moduleId: 'idea', generation: 0,
  requestId: request.requestId, operationId: `read${index}`, url: `https://example.org/${index}`,
  title: 'Страница', retrievedAt: '2026-11-15T00:00:00Z', publishedAt: null, effectiveAt: null,
  retrieval: 'read', contentHash: 'hash', quotes: [{ id: 'q', text: 'Я'.repeat(12000), start: 0, end: 12000 }], limitations: [],
}));
const core = request.coreContext!;
const reply: AssistantReply = { message: 'Готово', choices: [], artifactDraft: null, proposedFacts: [], externalSources: evidence,
  memoryPatch: { schemaVersion: 1, projectId: request.projectId, moduleId: request.moduleId, generation: core.generation, requestId: request.requestId, baseMemoryVersion: core.revision, baseContextVersion: core.contextVersion, sourceMessage: core.sourceMessage, operations: [] },
};
let serverError: string | null = null;
try { validateReply(reply, request, evidence); } catch (error) { serverError = (error as Error).message; }
// Intentionally offline: this identifies the next public-request boundary, not a successful server route.
const saved = applyAnswer(project, request, reply);
const next = makeRequest(saved, 'idea', 'Продолжим.');
let nextError: string | null = null;
try { assertRequestFits(next.request); } catch (error) { nextError = (error as Error).message; }
const size = { mode: 'offline', synthetic: true, fixture: '6 bounded read pages x12000 Cyrillic characters', schemaValid: replySchema.safeParse(reply).success, envelopeBytes: Buffer.byteLength(JSON.stringify(reply)), serverError, appliedEvidence: saved.core?.evidence.length, nextRequestBytes: Buffer.byteLength(JSON.stringify(next.request)), nextError };
writeFileSync(`${root}/t04-size-repro-latest.json`, JSON.stringify(size, null, 2));

type Failure = { id: string; requestId: string; rawBytes: number; envelopeLowerBoundBytes: number; request: ChatRequest; raw?: { memoryOperations?: MemoryOperation[] }; evidence: ExternalEvidence[] };
const failures = readFileSync(`${root}/t04-live_model/failures.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Failure);
const guards = failures.map(failure => {
  const core = failure.request.coreContext!;
  const patch: MemoryPatch = { schemaVersion: 1, projectId: failure.request.projectId, moduleId: failure.request.moduleId, generation: core.generation, requestId: failure.requestId, baseMemoryVersion: core.revision, baseContextVersion: core.contextVersion, sourceMessage: core.sourceMessage, operations: failure.raw?.memoryOperations ?? [] };
  const guardErrors: string[] = [];
  for (const operation of patch.operations) {
    const previous = operation.op === 'revise' ? core.entries.find(entry => entry.id === operation.id && entry.version === operation.expectedVersion) : undefined;
    try { validateMemoryValue(operation.value, core, patch, failure.evidence, previous); } catch (error) { guardErrors.push((error as Error).message); }
  }
  return { id: failure.id, requestId: failure.requestId, rawBytes: failure.rawBytes, envelopeLowerBoundBytes: failure.envelopeLowerBoundBytes, guardErrors };
});
writeFileSync(`${root}/t04-validation-repro.json`, JSON.stringify(guards, null, 2));
console.info(JSON.stringify({ size, guards }, null, 2));
