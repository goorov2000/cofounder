import { expect, test } from 'vitest';
import { MODULES, STAGE_IDS, TOOL_IDS } from '../../shared/modules';

test('the full route and all five tools expose their prerequisites and useful result guidance', () => {
  expect(STAGE_IDS).toEqual(['idea', 'audience', 'competitors', 'market', 'business', 'economics', 'team', 'roadmap', 'mvp']);
  expect(TOOL_IDS).toEqual(['basics', 'trends', 'ai', 'interview', 'legal']);
  expect(Object.fromEntries(Object.entries(MODULES).map(([id, module]) => [id, module.dependencies]))).toEqual({
    idea: [], audience: ['idea'], competitors: ['idea', 'audience'], market: ['idea', 'audience'],
    business: ['idea', 'audience', 'market'], economics: ['idea', 'audience', 'market', 'business'],
    team: ['idea'], roadmap: ['idea', 'audience', 'business'], mvp: ['idea', 'audience', 'competitors'],
    basics: [], trends: [], ai: [], interview: ['idea', 'audience'], legal: ['idea', 'business'],
  });
  for (const module of Object.values(MODULES)) {
    expect(module.title).not.toBe('');
    expect(module.description).not.toBe('');
    expect(module.welcome.length).toBeGreaterThan(40);
    expect(module.sections.length).toBeGreaterThan(2);
  }
  expect(MODULES.mvp.sections).toContain('Конечный пользователь и плательщик');
});
