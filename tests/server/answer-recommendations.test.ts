import { expect, it } from 'vitest';
import type { ChatRequest } from '../../shared/types.js';
import { validateReply } from '../../server/validation.js';

const request: ChatRequest = {
  requestId: 'recommendation-request', projectId: 'project', moduleId: 'idea', intent: 'message', message: 'С чего начать?',
  context: { name: '', description: '', facts: [], artifacts: [], history: [] },
};
const choices = [
  { id: 'first', label: 'Примеры', description: 'Выбрать знакомую область' },
  { id: 'second', label: 'Интервью', description: 'Проверить уже описанную боль' },
];
const reply = { message: 'Выберите следующий шаг.', choices, artifactDraft: null, proposedFacts: [] };

it('allows a single recommendation or no recommendation and accepts legacy answers unchanged', () => {
  expect(validateReply(reply, request).choices).toEqual(choices);
  const none = choices.map(choice => ({ ...choice, recommended: false }));
  expect(validateReply({ ...reply, choices: none }, request).choices).toEqual(none);
  const recommended = choices.map((choice, index) => ({ ...choice, recommended: index === 1 }));
  expect(validateReply({ ...reply, choices: recommended }, request).choices).toEqual(recommended);
});

it('rejects conflicting recommendations and non-boolean flags', () => {
  for (const recommended of [true, 'true', 1]) {
    expect(() => validateReply({ ...reply, choices: choices.map(choice => ({ ...choice, recommended })) }, request)).toThrow();
  }
});
