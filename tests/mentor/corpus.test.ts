import { expect, test } from 'vitest';
import { KNOWLEDGE } from '../../server/knowledge.js';

test('the checked-in runtime contains the thirty editorial methods without private evidence', () => {
  expect(KNOWLEDGE).toHaveLength(30);
  expect(KNOWLEDGE.map(card => card.id).sort()).toEqual(Array.from({ length: 30 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`));
  const encoded = JSON.stringify(KNOWLEDGE);
  expect(encoded).not.toContain('original_evidence');
  expect(encoded).not.toContain('knowledge.sqlite');
  expect(KNOWLEDGE.find(card => card.id === 'M01')?.body).toContain('Если эпизода нет');
  expect(KNOWLEDGE.find(card => card.id === 'M01')?.body).toContain('Частоту и стоимость потерь');
  expect(KNOWLEDGE.find(card => card.id === 'M01')?.body).toContain('рынок огромный');
});
