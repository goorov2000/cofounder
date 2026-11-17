import { expect, it } from 'vitest';
import { createProject } from '../../shared/domain';
import { parseWorkspace, serializeWorkspace } from '../../shared/validation';
import type { Workspace } from '../../shared/types';

it('keeps model recommendations through export and import alongside older choices without the field', () => {
  const project = createProject();
  const choices = [
    { id: 'old', label: 'Старый вариант', description: 'Без рекомендации' },
    { id: 'next', label: 'Начать с интервью', description: 'Проверить знакомую боль', recommended: true },
    { id: 'later', label: 'Сразу сделать прототип', description: '', recommended: false },
  ];
  const reply = { message: 'Выберите следующий шаг.', choices, artifactDraft: null, proposedFacts: [] };
  project.modules.idea.messages.push({ id: 'answer', role: 'assistant', content: reply.message, createdAt: new Date().toISOString(), choices, reply });
  project.modules.idea.proposal = reply;
  const restored = parseWorkspace(serializeWorkspace({ version: 1, projects: [project], activeProjectId: project.id }));
  expect(restored.projects[0].modules.idea).toMatchObject({ messages: [{ choices, reply }], proposal: reply });
  expect(restored.projects[0].modules.idea.messages[0].choices![0]).not.toHaveProperty('recommended');
});

it('round trips a complete workspace and rejects malformed, malicious or misleading data without permissive merges', () => {
  const project = createProject();
  project.modules.idea.draft = 'История и данные';
  project.modules.idea.messages.push({ id: 'msg-1', role: 'user', content: 'Моя идея', createdAt: new Date().toISOString() });
  const workspace: Workspace = { version: 1, projects: [project], activeProjectId: project.id };
  expect(parseWorkspace(serializeWorkspace(workspace))).toEqual(workspace);
  expect(() => parseWorkspace('{broken')).toThrow();
  expect(() => parseWorkspace(JSON.stringify({ ...workspace, version: 2 }))).toThrow();
  expect(() => parseWorkspace(JSON.stringify({ ...workspace, projects: [] }))).toThrow();
  expect(() => parseWorkspace(JSON.stringify({ ...workspace, activeProjectId: 'missing' }))).toThrow();
  expect(() => parseWorkspace(JSON.stringify({ ...workspace, projects: [project, project] }))).toThrow();
  expect(() => parseWorkspace(JSON.stringify(workspace).replace('"calculations":{}', '"calculations":{"__proto__":{"polluted":true}}'))).toThrow();
  project.prototypeUrl = 'javascript:alert(1)';
  expect(() => serializeWorkspace(workspace)).toThrow();
  project.prototypeUrl = '';
  project.facts.price = { key: 'price', value: '100', provenance: 'verified', note: '' };
  expect(() => serializeWorkspace(workspace)).toThrow();
  project.facts = {};
  project.modules.idea.proposal = { message: 'Hello', choices: [], artifactDraft: null, proposedFacts: [{ key: 'price', value: '100', provenance: 'verified', note: '', sourceUrl: 'https://example.org', checkedAt: '2026-11-14' }] };
  expect(() => serializeWorkspace(workspace)).toThrow();
});
