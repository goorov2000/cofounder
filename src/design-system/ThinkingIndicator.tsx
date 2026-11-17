import { useEffect, useState } from 'react';
import { useMedia } from '../hooks/useMedia';
import './thinking-indicator.css';

const labels = ['Думаю…', 'Собираю мысли…', 'Связываю детали…', 'Ищу главное…'];

export function ThinkingIndicator({message,startedAt}:{message?:string;startedAt?:number}={}) {
  const [index, setIndex] = useState(0);
  const [now,setNow]=useState(Date.now);
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => setIndex(current => (current + 1) % labels.length), 5000);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);
  useEffect(()=>{
    if(startedAt===undefined)return;
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return ()=>window.clearInterval(timer);
  },[startedAt]);
  const seconds=startedAt===undefined?null:Math.max(0,Math.floor((now-startedAt)/1000));

  // The variations are decorative, not progress reports or repeated live announcements.
  return <div className="ds-thinking" role="status">
    {!message&&<span className="sr-only">Помощник готовит ответ</span>}
    <span className="ds-thinking-dots" aria-hidden="true"><i /><i /><i /></span>
    <span key={message ?? (reducedMotion ? 0 : index)} className="ds-thinking-label" aria-hidden={message?undefined:true}>{message ?? labels[reducedMotion ? 0 : index]}{seconds!==null&&<span className="ds-thinking-elapsed" aria-hidden="true"> · Прошло {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span>}</span>
  </div>;
}
