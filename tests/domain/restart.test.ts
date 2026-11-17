import { expect, it } from 'vitest';
import { createProject, getAccess, restartChat, saveArtifact } from '../../shared/domain';
import { allowsChatContext, collectArtifacts } from '../../shared/chatContext';
import { collectMemories } from '../../shared/memory';
import { getStageWelcome } from '../../shared/welcome';
import { parseWorkspace, serializeWorkspace } from '../../shared/validation';
import { calculateMarket } from '../../shared/calculations';

const memory = { updatedAt: '2026-01-01T00:00:00Z', content: { facts: [{ text: 'Старая задумка', evidence: 'Старая задумка' }], hypotheses: [], openQuestions: [] } };
const message = { id: 'old-message', role: 'user' as const, content: 'Старая задумка', createdAt: '2026-01-01T00:00:00Z' };
function seeded() {
  let project = createProject();
  for (const moduleId of ['idea', 'audience', 'market'] as const) {
    project = saveArtifact(project, moduleId, { title: moduleId, body: 'Старая задумка' });
    project.modules[moduleId] = { ...project.modules[moduleId], messages: [{ ...message }], memory: structuredClone(memory), draft: 'Неотправленный текст', proposal: { message: 'Предложение', artifactDraft: null, choices: [], proposedFacts: [] } };
    project.modules[moduleId].artifact!.savedAt = '2026-01-01T00:00:00Z';
  }
  return project;
}

it('restarts one stage durably while preserving the project and other conversations', () => {
  const project = seeded();
  project.description = 'Общее описание проекта';
  project.facts.city = { key: 'city', value: 'Самара', provenance: 'user', note: '' };
  const original = structuredClone(project);
  const next = restartChat(project, 'idea');
  expect(project).toEqual(original);
  expect(next.id).toBe(project.id);
  expect(next.description).toBe(project.description);
  expect(next.facts).toEqual(project.facts);
  expect(next.modules.idea).toEqual({ generation: 1, messages: [], draft: '', proposal: null, artifact: null, resetAt: expect.any(String) });
  expect(next.modules.audience.messages).toEqual(project.modules.audience.messages);
  expect(next.modules.audience.draft).toBe(project.modules.audience.draft);
  expect(next.modules.audience.proposal).toEqual(project.modules.audience.proposal);
  expect(next.modules.audience.artifact).toMatchObject({ body: 'Старая задумка', stale: true });
  expect(next.modules.audience.memory).toMatchObject({ content: memory.content, needsRefresh: true });
  expect(getAccess(next, 'audience').allowed).toBe(true);
  expect(next.modules.basics).toEqual(project.modules.basics);
  expect(parseWorkspace(serializeWorkspace({ version: 1, activeProjectId: next.id, projects: [next] })).projects[0]).toEqual(next);
});

it('does not restore discarded ideas from older downstream context and keeps prerequisite materials when restarting a later stage', () => {
  const next = restartChat(seeded(), 'idea');
  expect(collectMemories(next)).toEqual([]);
  expect(collectArtifacts(next)).toEqual([]);
  expect(allowsChatContext(next, 'market')).toBe(false);
  expect(getStageWelcome(next, 'idea').prompt).toBeNull();
  const later = restartChat(seeded(), 'audience');
  later.activeModule = 'audience';
  expect(collectArtifacts(later).map(item => item.moduleId)).toEqual(['idea']);
  expect(collectMemories(later).map(item => item.moduleId)).toEqual(['idea']);
  expect(getStageWelcome(later, 'audience').materials).toEqual(['idea']);
  later.modules.market.artifact!.savedAt = new Date(Date.parse(later.modules.audience.resetAt!) + 1000).toISOString();
  expect(collectArtifacts(later).map(item => item.moduleId)).toEqual(['idea', 'market']);
});

it('clears only the restarted stage calculation and also supports tool conversations', () => {
  const project = seeded();
  project.calculations.market = calculateMarket({ totalBuyers: '100', reachableBuyers: '50', targetBuyers: '10', price: '200', period: 'месяц', pricePeriod: 'месяц', currency: '₽', sources: {} });
  project.modules.legal.messages = [{ ...message }];
  const tool = restartChat(project, 'legal');
  expect(tool.modules.legal.messages).toEqual([]);
  expect(tool.modules.idea).toEqual(project.modules.idea);
  expect(tool.calculations.market).toEqual(project.calculations.market);
  const market = restartChat(project, 'market');
  expect(market.calculations.market).toBeUndefined();
  expect(market.modules.idea).toEqual(project.modules.idea);
});
