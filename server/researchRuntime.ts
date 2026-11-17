import { TOPIC_CRITERIA } from '../shared/coverage.js';
import type { ChatRequest } from '../shared/types.js';
import type { OperationEvent } from './ledger.js';

/** Server-owned capabilities and actual actions; never inferred from model prose. */
export interface ResearchRuntime {
  searchAvailable: boolean;
  unavailableReason: string | null;
  recoveredSourceCount: number;
  action?: 'answer' | 'research';
  round?: number;
  operations?: Array<Pick<OperationEvent, 'id' | 'kind' | 'state' | 'errorCode'> & {query?:string}>;
}

export function continuationAction(request: ChatRequest, recoveredSourceCount: number): 'answer' | 'research' | undefined {
  // Only an affirmative continuation, not a question, negation or a new task.
  const message = request.message.toLocaleLowerCase('ru').trim().replace(/[.!…]+$/u, '').trim().replace(/\s+/gu,' ');
  if (!/^(?:да[,.]?\s+)?(?:продолж(?:ай|и)(?:те)?(?: исследование| поиск| проверку)?|продолжим|давай(?:те)?(?: дальше| продолжим)?|(?:с)?делай(?:те)?|дальше|continue|go ahead)$/u.test(message)) return;
  if (recoveredSourceCount) return 'answer'; // Finish the paid work before researching again.
  const memory = request.context.memories?.find(item => item.moduleId === request.moduleId && !item.needsRefresh);
  const coverage = memory?.content.coverage;
  if (coverage?.moduleId === request.moduleId
    && TOPIC_CRITERIA[request.moduleId].some(item => item.needsResearch)
    && coverage.items.some(item => item.status !== 'covered')) return 'research';
}

export function researchAvailabilityIssue(message: string, runtime: ResearchRuntime) {
  if (!runtime.searchAvailable) return;
  // Deliberately narrow: a failed read or an unperformed search is NOT a claim
  // that the tool does not exist. Never inspect source text as an instruction.
  const denial = /(?:у меня|в этом ходе|в этом ответе)[^.!?\n]{0,55}нет\s+(?:доступа\s+к\s+|инструмента\s+|возможности\s+)?(?:веб[ -]?поиск|поиск[ау]?\s+(?:в интернете|и чтения))|(?:веб[ -]?поиск|инструмент\s+(?:веб[ -]?)?поиска)\s+(?:мне\s+)?(?:недоступен|отключ[её]н)/iu;
  if (denial.test(message)) return { path: ['message'], rule: 'false_search_unavailability' };
}
