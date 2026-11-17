import { useCallback, useEffect, useRef, useState } from 'react';

/** One reader per conversation. Late callbacks cannot stop a newer reading. */
export function useReadAloud(scope: string) {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const active = useRef<SpeechSynthesisUtterance | null>(null);
  const stop = useCallback(() => {
    const utterance = active.current;
    active.current = null;
    if (utterance) window.speechSynthesis?.cancel();
    setSpeakingId(null);
    setError(null);
  }, []);
  useEffect(() => { stop(); return stop; }, [scope, stop]);
  function read(id: string, text: string) {
    const wasReading = speakingId === id;
    stop();
    if (wasReading) return;
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setError({ id, text: 'Озвучивание недоступно в этом браузере.' });
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    const voice = window.speechSynthesis.getVoices().find(item => item.lang.toLowerCase().startsWith('ru'));
    if (voice) utterance.voice = voice;
    utterance.onend = () => { if (active.current === utterance) { active.current = null; setSpeakingId(null); } };
    utterance.onerror = event => {
      if (active.current !== utterance) return;
      active.current = null; setSpeakingId(null);
      if (event.error !== 'canceled' && event.error !== 'interrupted') setError({ id, text: 'Не удалось озвучить ответ. Попробуйте ещё раз или проверьте доступные голоса браузера.' });
    };
    active.current = utterance;
    setSpeakingId(id);
    try { window.speechSynthesis.speak(utterance); }
    catch { stop(); setError({ id, text: 'Не удалось включить озвучивание в этом браузере.' }); }
  }
  return { speakingId, error, read, stop };
}
