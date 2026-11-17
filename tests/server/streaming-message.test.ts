import { expect, test } from 'vitest';
import { streamingMessage, streamingMessageState } from '../../server/streamingMessage';

test('the message closing quote marks finalization before the structured response finishes', () => {
  expect(streamingMessageState('{"message":"Ответ')).toEqual({ text: 'Ответ', complete: false });
  expect(streamingMessageState('{"message":"Ответ", "choices":[')).toEqual({ text: 'Ответ', complete: true });
  expect(streamingMessage('{"message":"Ответ", "choices":[')).toBe('Ответ');
});

test('escaped quotes and fragmented Unicode never signal a completed message', () => {
  for (const message of ['Он сказал: "да".', 'Кириллица 💡', 'Строка\nи ещё строка']) {
    const json = JSON.stringify({ message, choices: [] });
    const end = json.indexOf(',"choices"');
    for (let length = 0; length < end; length++) expect(streamingMessageState(json.slice(0, length)).complete).toBe(false);
    expect(streamingMessageState(json.slice(0, end))).toEqual({ text: message, complete: true });
  }
  expect(() => streamingMessageState('{"message":"\u0000"')).toThrow();
});
