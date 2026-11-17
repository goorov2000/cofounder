import { expect, it } from 'vitest';
import { createDemoProject } from '../../shared/demo';
import { createProject, isAssessmentCurrent } from '../../shared/domain';
import { STAGE_IDS } from '../../shared/modules';
import { parseWorkspace, serializeWorkspace } from '../../shared/validation';

it('creates an isolated explicitly fictional nine-material StaffPlanner with complete MVP details', () => {
  const demo = createDemoProject();
  expect(demo.isDemo).toBe(true);
  expect(demo.name).toBe('StaffPlanner — вымышленный пример');
  for (const id of STAGE_IDS) {
    const artifact = demo.modules[id].artifact!;
    expect(artifact.body.length).toBeGreaterThan(200);
    expect(artifact.stale).toBe(false);
    expect(isAssessmentCurrent(id, artifact, demo.facts)).toBe(true);
    expect(artifact.assessment!.checks.filter((check) => check.label.startsWith('Полнота:')).every((check) => check.passed)).toBe(true);
  }
  const mvp = demo.modules.mvp.artifact!.body;
  for (const detail of ['две недели', 'выходных', 'обмен', 'заместителю', 'директору', 'Telegram mini-app', 'Плательщик', 'Пользователь']) expect(mvp).toContain(detail);
  expect(demo.facts.channel.value).toContain('SEO');
  expect(demo.facts.team.value).toContain('Соло');
  expect(Object.values(demo.facts).every((fact) => fact.provenance === 'hypothesis')).toBe(true);
  const roundTrip = parseWorkspace(serializeWorkspace({ version: 1, activeProjectId: demo.id, projects: [demo] }));
  expect(roundTrip.projects[0]).toEqual(demo);
  const otherDemo = createDemoProject();
  demo.modules.mvp.artifact!.body = 'Изменённая копия';
  expect(otherDemo.modules.mvp.artifact!.body).toContain('Telegram mini-app');
  const clean = createProject();
  expect(clean.facts).toEqual({});
  expect(Object.values(clean.modules).every((module) => !module.artifact && !module.proposal && !module.messages.length)).toBe(true);
});
