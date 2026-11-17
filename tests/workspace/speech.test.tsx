import { renderHook, act } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { useSpeechRecognition } from '../../src/hooks/useSpeechRecognition';
it('uses ru-RU and ignores late transcript after manual cancellation, never sends',()=>{
 let instance:any; class Recognition {lang='';interimResults=false;continuous=false;onresult:any;onerror:any;onend:any;start=vi.fn();stop=vi.fn();abort=vi.fn();constructor(){instance=this;}}
 Object.defineProperty(window,'SpeechRecognition',{value:Recognition,configurable:true}); const text=vi.fn();
 const {result}=renderHook(()=>useSpeechRecognition(text)); act(()=>result.current.start('Начало'));
 expect(instance.lang).toBe('ru-RU'); expect(instance.interimResults).toBe(true);
 expect(result.current.status).toContain('Слушаю');
 const late=instance.onresult;const lateError=instance.onerror; act(()=>result.current.cancel());
 expect(result.current.status).toBe('');expect(result.current.listening).toBe(false);
 act(()=>late({results:[[{transcript:'поздно'}]]}));act(()=>lateError({error:'no-speech'}));expect(text).not.toHaveBeenCalled();expect(result.current.status).toBe('');
});
it('keeps the last transcript on stop and clears recording feedback without hiding a microphone error',()=>{
 let instance:any;class Recognition {lang='';interimResults=false;continuous=false;onresult:any;onerror:any;onend:any;start=vi.fn();stop=vi.fn();abort=vi.fn();constructor(){instance=this;}}
 Object.defineProperty(window,'SpeechRecognition',{value:Recognition,configurable:true});const text=vi.fn();
 const {result}=renderHook(()=>useSpeechRecognition(text));
 act(()=>result.current.cancel());expect(result.current.status).toBe('');
 act(()=>result.current.start('Начало'));act(()=>result.current.stop());
 expect(instance.stop).toHaveBeenCalledOnce();expect(result.current.status).toBe('');
 act(()=>instance.onresult({results:[[{transcript:'последний фрагмент'}]]}));
 expect(text).toHaveBeenLastCalledWith('Начало последний фрагмент');
 act(()=>instance.onend());expect(result.current.status).toBe('');
 act(()=>result.current.start(''));act(()=>instance.onerror({error:'not-allowed'}));
 expect(result.current.listening).toBe(false);expect(result.current.status).toContain('Доступ к микрофону запрещён');
 act(()=>result.current.cancel());expect(result.current.status).toBe('');
});
