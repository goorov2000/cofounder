import { useEffect, useRef, useState } from 'react';
interface Recognition { lang:string; interimResults:boolean; continuous:boolean; onresult:((event:{results:ArrayLike<ArrayLike<{transcript:string}>>})=>void)|null; onerror:((event:{error:string})=>void)|null; onend:(()=>void)|null; start():void; stop():void; abort():void }
type SpeechWindow = Window & {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
export function useSpeechRecognition(onText:(text:string)=>void) {
 const [listening,setListening]=useState(false); const [status,setStatus]=useState(''); const generation=useRef(0);const active=useRef<Recognition|null>(null);const callback=useRef(onText);callback.current=onText;
 const browser=typeof window==='undefined'?null:window as SpeechWindow; const Constructor=browser?.SpeechRecognition??browser?.webkitSpeechRecognition;
 const cancel=()=>{ generation.current++;const old=active.current;active.current=null;old?.abort();setListening(false);setStatus(''); };
 useEffect(()=>()=>{generation.current++;active.current?.abort();},[]);
 return {supported:!!Constructor,listening,status,cancel,
 start:(text:string)=>{cancel();if(!Constructor){setStatus('Браузер не поддерживает диктовку. Используйте клавиатуру.');return;}const token=generation.current;const recognition=new Constructor();active.current=recognition;recognition.lang='ru-RU';recognition.interimResults=true;recognition.continuous=true;
 recognition.onresult=event=>{if(token!==generation.current)return;const transcript=Array.from(event.results,result=>result[0]?.transcript??'').join(' ');callback.current([text,transcript].filter(Boolean).join(' '));};
 recognition.onerror=event=>{if(token!==generation.current)return;cancel();setStatus(event.error==='not-allowed'?'Доступ к микрофону запрещён. Продолжайте ввод с клавиатуры.':event.error==='no-speech'?'Речь не распознана. Можно повторить или ввести текст.':'Ошибка распознавания или сети. Текст сохранён.');};
 recognition.onend=()=>{if(token!==generation.current)return;generation.current++;active.current=null;setListening(false);setStatus('');};
 try{recognition.start();setListening(true);setStatus('Слушаю… Текст можно исправить перед отправкой.');}catch{cancel();setStatus('Не удалось включить микрофон. Введите текст.');}},
 stop:()=>{active.current?.stop();setStatus('');setListening(false);}};
}
