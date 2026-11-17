import type { AssistantReply, ChatRequest, ExternalEvidence } from '../shared/types.js';
import type { ProviderExecution, ProviderResult } from './provider.js';
import type { OperationEvent } from './ledger.js';
import { ServiceError } from './errors.js';

export const RESEARCH_TASK_TIMEOUT_MS = 60 * 60_000;
export const RESEARCH_STALLED_ROUNDS = 3;
export function researchTaskTimeout(timeoutMs:number,enabled:boolean):number {
  return enabled&&timeoutMs>=5000 ? Math.max(timeoutMs,RESEARCH_TASK_TIMEOUT_MS) : timeoutMs;
}
export interface ResearchRound {
  index: number;
  task?: string;
  action?: 'answer'|'research';
  previousAnswer?: Pick<AssistantReply,'message'|'artifactDraft'>;
  previousQueries: string[];
}
type RunRound = (signal: AbortSignal, execution: ProviderExecution, round: ResearchRound) => Promise<ProviderResult>;

/** One user request, one atomic final answer, several distinct checked actions.
 * No fabricated user messages or intermediate memory patches are committed. */
export async function runResearchLoop(request: ChatRequest, signal: AbortSignal, execution: ProviderExecution,
  timeoutMs: number, searchAvailable: boolean, run: RunRound, budgetUsd = 0): Promise<ProviderResult> {
  const started=Date.now(),deadline=researchTaskTimeout(timeoutMs,true);
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,deadline-5000))]);
  const operations=new Map<string,OperationEvent>(),sources=new Map<string,ExternalEvidence>();
  const remember=(source:ExternalEvidence)=>sources.set(JSON.stringify([source.id,source.version]),source);
  const record=(event:OperationEvent)=>{
    // Direct provider users share the task cap too; HTTP additionally checks
    // the remaining installation budget atomically in the durable ledger.
    if(event.state==='started'&&budgetUsd>0) {
      const committed=[...operations.values()].filter(item=>item.id!==event.id)
        .reduce((sum,item)=>sum+(item.chargedUsd ?? (item.state==='started'?item.reservedUsd ?? 0:0)),0);
      if(committed+(event.reservedUsd ?? 0)>budgetUsd)throw new ServiceError('BUDGET_EXHAUSTED',`Недостаточно бюджета для следующей проверки: доступно $${Math.max(0,budgetUsd-committed).toFixed(6)}; требуется резерв $${(event.reservedUsd ?? 0).toFixed(6)}.`,402,false,true);
    }
    execution.onOperation?.(event); // Admission must succeed before counting a step.
    const previous=operations.get(event.id);
    operations.set(event.id,{...previous,...event,metadata:{...previous?.metadata,...event.metadata}});
    if(event.kind==='read'&&event.metadata?.evidence)remember(event.metadata.evidence as ExternalEvidence);
  };
  let result:ProviderResult|undefined,stop:string|undefined;
  result=await run(bounded,{...execution,onOperation:record}, {index:0,previousQueries:[]});
  const review=result.reply.memory?.review;
  const researched=result.reply.diagnostics?.action==='research'||sources.size||execution.recoveredEvidence?.length;
  if(researched&&review?.status==='unavailable')stop='Не удалось завершить независимую проверку результата. Ответ и источники сохранены.';
  else if(researched&&review?.status==='completed'&&review.nextStep==='blocked')stop=`Исследование остановлено: ${review.nextAction ?? review.result?.note ?? 'нет доступного следующего действия.'}`;
  else if(researched&&review?.status==='completed'&&review.nextStep==='research'&&review.result?.status!=='ready')stop=`Итоговая проверка отметила оставшийся вопрос: ${review.nextAction ?? review.result?.note ?? 'нужны дополнительные сведения.'}`;
  if(!result)throw new Error('Research returned no answer.');
  if(stop)result.reply.research={status:'partial',limitations:[...(result.reply.research?.limitations ?? []),stop]};
  const all=[...(result.reply.externalSources ?? [])];
  for(const source of sources.values())if(!all.some(item=>item.id===source.id&&item.version===source.version))all.push(source);
  if(all.length)result.reply.externalSources=all;
  const trace=[...operations.values()];
  const usage=trace.reduce((sum,event)=>({inputTokens:sum.inputTokens+(event.usage?.inputTokens ?? 0),outputTokens:sum.outputTokens+(event.usage?.outputTokens ?? 0)}),{inputTokens:0,outputTokens:0});
  const costUsd=trace.reduce((sum,event)=>sum+(event.chargedUsd ?? (event.state==='started'?event.reservedUsd ?? 0:0)),0);
  const toolCalls=trace.reduce((sum,event)=>sum+(event.toolCalls ?? 0),0);
  result.reply.diagnostics={...result.reply.diagnostics,elapsedMs:Date.now()-started,costUsd,
    operations:trace.map(({id,kind,state,inputHash,errorCode})=>({id,kind,state,inputHash,...(errorCode?{errorCode}:{})}))};
  return {...result,usage,costUsd,toolCalls,evidence:[...sources.values()]};
}
