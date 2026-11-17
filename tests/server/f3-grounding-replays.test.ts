import { expect, it } from 'vitest';
import failures from './fixtures/grounding/g4-failures.json';
import ownPrices from './fixtures/grounding/g4-own-price.json';
import { ReplyValidationError, validateReply } from '../../server/validation';
import type { ChatRequest, ExternalEvidence, MemoryPatch } from '../../shared/types';

// Unchanged requests/raw generations/reads copied from the synthetic historical
// g4-second failure logs. The adapter mirrors server-owned envelope assembly;
// it does not repair or discard a claim.
function replay(fixture: typeof failures[number]) {
  const request = fixture.request as unknown as ChatRequest;
  const raw = structuredClone(fixture.raw) as Record<string, unknown>;
  const operations = raw.memoryOperations;
  delete raw.memoryOperations;
  raw.proposedFacts = (raw.proposedFacts as Record<string, unknown>[]).map(fact => Object.fromEntries(Object.entries(fact).filter(([key, value]) => !(['sourceUrl', 'checkedAt'].includes(key) && value === null))));
  const core = request.coreContext!;
  raw.memoryPatch = { schemaVersion: 1, projectId: request.projectId, moduleId: request.moduleId, generation: core.generation, requestId: request.requestId, baseMemoryVersion: core.revision, baseContextVersion: core.contextVersion, sourceMessage: core.sourceMessage, operations };
  raw.externalSources = fixture.evidence;
  return { request, raw, evidence: fixture.evidence as ExternalEvidence[] };
}
function issue(run: () => unknown) {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(ReplyValidationError);
    return (error as ReplyValidationError).validationIssue;
  }
  throw new Error('Expected invalid historical generation');
}
for (const fixture of failures) it(`localizes unchanged historical ${fixture.id} without leaking input`, () => {
  const { request, raw, evidence } = replay(fixture);
  if (['B-idea-unknown', 'B-competitors-correction-refusal', 'B-audience-correction-refusal'].includes(fixture.id)) {
    // 'заточка' is a service name, not 'за точку'; 'в частных' is not 'в час'.
    const reply = validateReply(raw, request, evidence);
    expect(reply.message).toBe(raw.message);
    expect(reply.externalClaims).toEqual(raw.externalClaims);
    expect(reply.memoryPatch!.operations).toEqual((raw.memoryPatch as MemoryPatch).operations);
    return;
  }
  const diagnostic = issue(() => validateReply(raw, request, evidence));
  expect(diagnostic).toMatchSnapshot(fixture.id);
  expect(diagnostic.path.length).toBeGreaterThan(0);
  expect(Object.keys(diagnostic).sort()).toEqual(diagnostic.relatedIssues ? ['path', 'relatedIssues', 'rule'] : ['path', 'rule']);
  for (const related of diagnostic.relatedIssues ?? []) expect(Object.keys(related).sort()).toEqual(['path', 'rule']);
  if (fixture.id === 'D01') expect(diagnostic).toEqual({path:['message'],rule:'invalid_control_character'});
  if (fixture.id === 'D15') expect(diagnostic).toEqual({path:['memoryPatch','operations',0,'value','text'],rule:'ungrounded_memory_quantity'});
  if (fixture.id === 'K06') expect(diagnostic).toEqual({path:['externalClaims',1,'text'],rule:'ungrounded_quantity'});
});

it('grounds D15 by adding the actual historical own-price reference, preserving the complete scenario claim', () => {
  const { request, raw, evidence } = replay(failures.find(item => item.id === 'D15')!);
  const patch = raw.memoryPatch as MemoryPatch;
  const value = patch.operations[0].value;
  const ownPrice = request.coreContext!.entries.find(entry => entry.key === 'price' && entry.acceptance === 'accepted')!;
  value.sources.push(...ownPrice.sources);
  const reply = validateReply(raw, request, evidence);
  expect(reply.memoryPatch!.operations[0].value.text).toBe(value.text);
  expect(reply.memoryPatch!.operations[0].value.acceptance).toBe('proposed');
});

for (const sample of ownPrices) it(`rejects competitor metric in own project scope, historical sample ${sample.iteration}`, async () => {
  const { validateMemoryValue } = await import('../../shared/coreValidation');
  for (const atom of sample.atoms) {
    const source = atom.sources[0];
    if (source.type !== 'message') throw new Error('Expected historical message');
    const core = { entries: [], sourceMessages: [{...source, role:'user',content:source.quote}], evidence:[] };
    const check = () => validateMemoryValue(atom as never, core as never, {projectId:source.projectId} as MemoryPatch, []);
    if (atom.scope.subject === 'our_project') expect(check).toThrow(/external_entity/);
    else expect(check).not.toThrow();
  }
});

it('retains every K06 price as separately quoted claims rather than merging quote scopes', () => {
  const { request, raw, evidence } = replay(failures.find(item => item.id === 'K06')!);
  const claims = raw.externalClaims as {text:string; evidenceId:string;version:number;quoteId:string;price:null}[];
  const combined = claims[1];
  claims.splice(1, 1,
    {...combined, text:'StaffKit: 9 490 ₽ за точку; период неизвестен.', quoteId:'quote-4'},
    {...combined, text:'StaffKit: 12 490 ₽ за точку; период неизвестен.', quoteId:'quote-5'},
  );
  expect(validateReply(raw, request, evidence).externalClaims).toHaveLength(4);
});

it('rejects competing accepted values on both server and client without any partial mutation', async () => {
  const { request, raw, evidence } = replay(failures.find(item => item.id === 'D15')!);
  const patch = raw.memoryPatch as MemoryPatch;
  const existing = request.coreContext!.entries.find(entry => entry.key === 'price' && entry.acceptance === 'accepted')!;
  const {id: _id, version: _version, previousVersion: _previous, createdAt: _created, requestId: _request, ...value} = existing;
  patch.operations = [{op:'create',localId:'duplicate-price',value}];
  expect(issue(() => validateReply(raw,request,evidence)).path).toEqual(['memoryPatch']);
  const { createProject } = await import('../../shared/domain');
  const { applyMemoryPatch } = await import('../../shared/coreMemory');
  const project = createProject(); project.id = request.projectId;
  const context = request.coreContext!;
  project.core = {schemaVersion:1,revision:context.revision,contextVersion:context.contextVersion,entries:structuredClone(context.entries),sourceMessages:structuredClone(context.sourceMessages),evidence:[],appliedRequestIds:[]};
  const before = JSON.stringify(project);
  expect(() => applyMemoryPatch(project,patch,evidence)).toThrow(/Конфликт/);
  expect(JSON.stringify(project)).toBe(before);
});
