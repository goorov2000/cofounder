import { expect, test } from 'vitest';
import { retrieveKnowledge } from '../../server/knowledge.js';
import { replySchema } from '../../shared/validation.js';
import type { ChatRequest, ModuleId } from '../../shared/types.js';
const request = (moduleId: ModuleId, message: string): ChatRequest => ({ requestId: 'retrieval-request', projectId: 'retrieval-project', moduleId, intent: 'message', message, context: { name: 'Тест', description: '', facts: [], artifacts: [], history: [] } });

test('task selection crosses stage aliases and keeps dialogue guidance on uninformative input', () => {
  const ids = (stage: ModuleId, message: string) => retrieveKnowledge(request(stage, message)).map(card => card.id);
  expect(ids('audience', 'Не знаю, кто согласует покупку и какие полномочия у управляющего.')).toContain('M05');
  expect(ids('idea', 'Сам найди конкурентов и сравни альтернативы.')).toEqual(expect.arrayContaining(['M09', 'M10', 'M30']));
  expect(ids('competitors', 'Найди публичные тарифы конкурентов с условиями оплаты.')[0]).toBe('M11');
  expect(ids('market', 'Нужны вопросы для интервью, интервью ещё не было.')[0]).toBe('M07');
  expect(ids('business', 'Собери бизнес-модель: кто платит, за что и как получаем выручку.')).toContain('M16');
  expect(ids('mvp', 'Подготовь подробное описание MVP для разработчика.')).toContain('M28');
  expect(ids('economics', 'Исправляю цену: теперь 3500 вместо 5000.')).toContain('M15');
  expect(ids('idea', 'Спасибо!')).toEqual(['M30']);
});

test('idea discovery is available for both entry routes and for uncertainty after a route choice', () => {
  for (const message of ['Помоги найти идею. Пока не знаю, с чего начать.', 'Помоги найти идею на основе моего опыта.', 'От боли', 'От рынка и трендов']) {
    const selected = retrieveKnowledge(request('idea', message));
    expect(selected.some(card => card.id === 'M01' && card.version === '0.3.0')).toBe(true);
  }
  const followup = request('idea', 'Не знаю');
  followup.context.history = [{ role: 'user', content: 'От боли' }, { role: 'assistant', content: 'Начнём с выбора знакомой области.' }];
  expect(retrieveKnowledge(followup).map(card => card.id)).toContain('M01');
});
