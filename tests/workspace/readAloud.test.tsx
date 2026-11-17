import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useReadAloud } from '../../src/hooks/useReadAloud';

afterEach(() => vi.unstubAllGlobals());
it('one response plays at a time, ignores late callbacks and stops when leaving the conversation', () => {
  class Utterance { text: string; lang = ''; onend?: () => void; onerror?: (event: { error: string }) => void; constructor(text: string) { this.text = text; } }
  const spoken: Utterance[] = [];
  const cancel = vi.fn();
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  vi.stubGlobal('speechSynthesis', { speak: (utterance: Utterance) => spoken.push(utterance), cancel, getVoices: () => [] });
  const { result, rerender } = renderHook(({ scope }) => useReadAloud(scope), { initialProps: { scope: 'project1' } });
  act(() => result.current.read('first', 'Первый ответ'));
  expect(result.current.speakingId).toBe('first');
  act(() => result.current.read('second', 'Второй ответ'));
  expect(cancel).toHaveBeenCalledOnce();
  act(() => spoken[0].onerror?.({ error: 'interrupted' }));
  act(() => spoken[0].onend?.());
  expect(result.current.speakingId).toBe('second');
  expect(result.current.error).toBeNull();
  rerender({ scope: 'project2' });
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(result.current.speakingId).toBeNull();
  act(() => spoken[1].onerror?.({ error: 'not-allowed' }));
  expect(result.current.error).toBeNull();
});
