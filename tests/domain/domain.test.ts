import { describe, expect, it } from 'vitest';
import { assessArtifact, createProject, deleteArtifact, getAccess, getRefinements, isAssessmentCurrent, parseNavigation, saveArtifact, updateFacts } from '../../shared/domain';
import type { ModuleId, Project } from '../../shared/types';

const material = { title: 'Решение', body: 'Подробный материал пользователя, который нужно сохранить целиком.' };
const save = (project: Project, id: ModuleId) => saveArtifact(project, id, material);

describe('project decisions', () => {
  it('navigates only for an entire explicit command, never a mention, timeline or negation', () => {
    expect(parseNavigation('Перейди к конкурентам')).toBe('competitors');
    expect(parseNavigation('  перейди к MVP.  ')).toBe('mvp');
    expect(parseNavigation('Открой целевую аудиторию')).toBe('audience');
    for (const phrase of ['MVP за две недели', '3 месяца', 'не хочу переходить к конкурентам', 'Не перейди к конкурентам', 'Перейди к конкурентам и удали идею', 'Напиши «Перейди к конкурентам»', 'MVP']) expect(parseNavigation(phrase)).toBeNull();
  });
  it('separates complete sections from evidence and invalidates assessment when a source or equal-length text changes', () => {
    const body = '## Проблема\nПокупатель тратит время на расписание.\n## Решение\nПомощник для планирования.\n## Ценность\nМеньше ручного труда.\n## Границы гипотезы\nСпрос неизвестен; нужно интервью.';
    const facts = { channel: { key: 'channel', value: 'SEO', provenance: 'hypothesis' as const, note: 'Не проверено' } };
    const assessment = assessArtifact('idea', body, facts);
    expect(assessment.checks.filter((c) => c.label.startsWith('Полнота:')).every((c) => c.passed)).toBe(true);
    expect(assessment.checks.some((c) => c.label.startsWith('Обоснованность:') && !c.passed)).toBe(true);
    let project = saveArtifact(createProject(), 'idea', { title: 'Идея', body });
    project = { ...project, facts };
    const artifact = { ...project.modules.idea.artifact!, assessment };
    project.modules.idea.artifact = artifact;
    expect(isAssessmentCurrent('idea', artifact, facts)).toBe(true);
    expect(isAssessmentCurrent('idea', { ...artifact, body: body.replace('Меньше', 'Больше') }, facts)).toBe(false);
    expect(isAssessmentCurrent('idea', artifact, { channel: { ...facts.channel, sourceUrl: 'https://example.org' } })).toBe(false);
    expect(getRefinements(project)).toEqual(expect.arrayContaining([expect.objectContaining({ moduleId: 'idea', kind: 'evidence' })]));
    expect(assessArtifact('idea', '## Проблема\n## Решение').checks.filter((c) => c.label.startsWith('Полнота:')).every((c) => !c.passed)).toBe(true);
  });
  it('requires a manual source and date for verified facts and never lets a model overwrite them', () => {
    let project = save(save(createProject(), 'idea'), 'team');
    const fact = { key: 'price', value: '500 ₽ / месяц', provenance: 'verified' as const, note: 'Проверил тариф', sourceUrl: 'https://example.org/pricing', checkedAt: '2026-11-14' };
    expect(() => updateFacts(project, [{ ...fact, checkedAt: undefined }])).toThrow(/дат/);
    expect(() => updateFacts(project, [{ ...fact, sourceUrl: 'javascript:alert(1)' }])).toThrow(/источник/);
    expect(() => updateFacts(project, [{ ...fact, checkedAt: '2026-02-30' }])).toThrow(/дат/);
    project = updateFacts(project, [fact]);
    expect(project.facts.price).toEqual(fact);
    expect(project.modules.team.artifact?.stale).toBe(true);
    const unchanged = saveArtifact(project, 'idea', material, [{ ...fact, value: '999 ₽', provenance: 'hypothesis' }]);
    expect(unchanged.facts.price).toEqual(fact);
    expect(() => saveArtifact(project, 'idea', material, [fact])).toThrow(/модел/);
    expect(() => updateFacts(project, [{ ...fact, key: '__proto__' }])).toThrow();
    expect(Object.getPrototypeOf(project.facts)).toBe(Object.prototype);
  });
  it('isolates history/proposals, unlocks the route sequentially and invalidates descendants without deleting their work', () => {
    const empty = createProject();
    const another = createProject();
    expect(empty.id).not.toBe(another.id);
    expect(empty.modules.idea.artifact).toBeNull();
    expect(getAccess(empty, 'interview')).toEqual({ allowed: false, missing: ['idea', 'audience'] });
    expect(getAccess(empty, 'team').allowed).toBe(false);
    let project = save(empty, 'idea');
    expect(getAccess(project, 'team').allowed).toBe(false);
    project = save(project, 'audience');
    expect(getAccess(project, 'interview').allowed).toBe(true);
    expect(getAccess(project, 'mvp').missing).toEqual(['roadmap']);
    project = save(save(save(project, 'market'), 'business'), 'economics');
    project = save(save(project, 'competitors'), 'mvp');
    expect(project.modules.economics.artifact?.stale).toBe(false);
    project.modules.idea.draft = 'Неотправленный текст';
    project.modules.idea.proposal = { message: 'Предложение', artifactDraft: { title: 'Новое', body: 'Черновик модели' }, choices: [], proposedFacts: [] };
    const changed = saveArtifact(project, 'audience', { ...material, body: 'Другой покупатель' });
    expect(changed.modules.economics.artifact).toMatchObject({ stale: true, body: material.body });
    expect(changed.modules.mvp.artifact?.stale).toBe(true);
    expect(changed.modules.idea.artifact?.stale).toBe(false);
    expect(project.modules.economics.artifact?.stale).toBe(false);
    const deleted = deleteArtifact(changed, 'idea');
    expect(deleted.modules.idea.artifact).toBeNull();
    expect(deleted.modules.idea.draft).toBe('Неотправленный текст');
    expect(deleted.modules.idea.proposal?.artifactDraft?.body).toBe('Черновик модели');
    expect(getAccess(deleted, 'mvp').allowed).toBe(true);
    expect(getAccess(deleted, 'mvp').missing).toEqual([]);
    expect(empty.modules.idea.artifact).toBeNull();
    expect(another.facts).toEqual({});
  });
});
