import { expect, it } from 'vitest';
import { createProject, saveArtifact } from '../../shared/domain';
import { getStageWelcome } from '../../shared/welcome';
import { MODULES } from '../../shared/modules';

it('uses manually saved materials for the next stage without extracting unverified facts from their text', () => {
  let project = saveArtifact(createProject(), 'idea', {
    title: 'Доставка фермерских наборов', body: 'Начинаем в Ярославле, возможное расширение в Кострому ещё не решено.',
  });
  project = saveArtifact(project, 'audience', {
    title: 'Покупатели наборов', body: 'Семьи с детьми. География определена в описании идеи. Интервью ещё не проводили.',
  });
  const before = structuredClone(project);
  const welcome = getStageWelcome(project, 'market');
  expect(welcome.message).not.toContain('В какой географии');
  expect(welcome.message).toBe(MODULES.market.welcome);
  expect(welcome.prompt).toBe('Начнём этап «Размер рынка». Учти то, что мы уже обсудили о проекте.');
  expect(welcome.materials).toEqual(['idea', 'audience']);
  expect(welcome.message).not.toMatch(/Ярославл|Костром|Семьи с детьми/);
  expect(project).toEqual(before);
  expect(project.facts).toEqual({});
});

it('starts from the saved project description even before separate facts or results exist', () => {
  const project = { ...createProject(), name: 'Ремонт рядом', description: 'Выездной ремонт велосипедов в Петрозаводске для частных владельцев. Работаю один.' };
  const welcome = getStageWelcome(project, 'team');
  expect(welcome.message).not.toContain('Вы начинаете самостоятельно или с кем-то');
  expect(welcome.message).toBe(MODULES.team.welcome);
  expect(welcome.prompt).toContain('уже обсудили о проекте');
  expect(welcome.materials).toEqual([]);
});
