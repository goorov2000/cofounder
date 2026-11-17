import type { ChatRequest } from '../shared/types.js';
import type { ServerConfig } from './config.js';

export type ReasoningProfile = 'speed' | 'quality';
export type ModelOperationKind = 'plan' | 'search' | 'generate' | 'evaluate';

export const MODEL_PROFILES = {
  speed: {
    effort: { plan:'none', check:'none', answer:'low', evaluator:'low', brief:'low', repair:'low', search:'none' },
    limits: { plan:1024, check:1536, answer:6144, draft:16384, brief:16384, evaluator:4096, search:2048 },
    verbosity: { answer:undefined, brief:undefined },
  },
  quality: {
    effort: { plan:'low', check:'medium', answer:'medium', evaluator:'medium', brief:'high', repair:'medium', search:'none' },
    limits: { plan:16384, check:32768, answer:128000, draft:128000, brief:128000, evaluator:32768, search:16384 },
    verbosity: { answer:'medium', brief:'high' },
  },
} as const;

export function requestsMvpBrief(request:Pick<ChatRequest,'moduleId'|'intent'|'message'>):boolean {
  return request.moduleId==='mvp'&&(request.intent==='draft'||
    /(?<!\p{L})(?:собр|собер|состав|подготов|оформ|обнов|доработ|покаж|сдела|напиш|сформир)\p{L}*/iu.test(request.message)&&
    /бриф|техническ.{0,20}задан|описани.{0,20}mvp|(?<!\p{L})тз(?!\p{L})/iu.test(request.message));
}

/** The explicit global cap still wins, including for long drafts and briefs. */
export function generationOutputLimit(request:ChatRequest,config:ServerConfig):number {
  const limits=MODEL_PROFILES[config.reasoningProfile].limits;
  if(request.moduleId==='mvp')return config.maxOutputTokens;
  if(request.intent==='draft'||request.context.currentDraft)return config.reasoningProfile==='speed'?config.maxOutputTokens:Math.min(config.maxOutputTokens,limits.draft);
  return Math.min(config.maxOutputTokens,limits.answer);
}

export function operationOutputLimit(request:ChatRequest,config:ServerConfig,kind:ModelOperationKind,researchCheck=false):number {
  const limits=MODEL_PROFILES[config.reasoningProfile].limits;
  return kind==='generate'?generationOutputLimit(request,config):kind==='evaluate'?config.evaluator?.maxOutputTokens ?? 0:
    kind==='search'?limits.search:researchCheck?limits.check:limits.plan;
}

export function modelRequestPolicy(request:ChatRequest,config:ServerConfig,kind:ModelOperationKind,model:string,researchCheck=false) {
  const profile=MODEL_PROFILES[config.reasoningProfile],brief=requestsMvpBrief(request);
  const effort=kind==='generate'?(brief?profile.effort.brief:profile.effort.answer):kind==='evaluate'?profile.effort.evaluator:
    kind==='search'?profile.effort.search:model!=='gpt-6-luna'?profile.effort.repair:researchCheck?profile.effort.check:profile.effort.plan;
  return {effort,maxOutputTokens:operationOutputLimit(request,config,kind,researchCheck),
    verbosity:kind==='generate'?(brief?profile.verbosity.brief:profile.verbosity.answer):undefined};
}

export function modelProfileSettings(config:ServerConfig) {
  const profile=MODEL_PROFILES[config.reasoningProfile];
  return {name:config.reasoningProfile,reasoningMode:'standard',effort:profile.effort,verbosity:profile.verbosity,
    outputLimits:{...profile.limits,answer:Math.min(config.maxOutputTokens,profile.limits.answer),
      draft:config.reasoningProfile==='speed'?config.maxOutputTokens:Math.min(config.maxOutputTokens,profile.limits.draft),brief:config.maxOutputTokens,evaluator:config.evaluator?.maxOutputTokens ?? null}};
}
