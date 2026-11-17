import path from 'node:path';
import { MODEL_PROFILES, type ReasoningProfile } from './modelPolicy.js';

export type ServiceTier = 'default' | 'fast' | 'ultrafast';
export function serviceTierForModel(model: string, tier: ServiceTier): ServiceTier {
  // Terra and Luna have no Ultrafast tier; use their fastest supported mode.
  return tier === 'ultrafast' && (model === 'gpt-6-luna' || model === 'gpt-6.1-terra') ? 'fast' : tier;
}

export interface ServerConfig {
  environment: string; apiKey: string; model: string; budgetUsd: number; serviceTier: ServiceTier; reasoningProfile: ReasoningProfile;
  inputPricePerMillion: number; outputPricePerMillion: number;
  origin: string; ledgerPath: string; maxOutputTokens: number; timeoutMs: number;
  maxConcurrent: number; sessionConcurrent: number; sessionRate: number; ipRate: number;
  rateWindowMs: number; responseTtlMs: number; maxCachedResponses: number;
  trustProxyHops: number; production: boolean; clientPath: string;
  searchEnabled: boolean; searchToolPriceUsd: number;
  evaluator?: { model: string; inputPricePerMillion: number; outputPricePerMillion: number; maxOutputTokens: number };
}
// Base Standard prices. Fast costs 2x; Ultrafast (Sol only) costs 6x.
// Includes cached input; hosted search tool fees do not receive a tier multiplier.
// https://developers.openai.com/api/docs/pricing — checked 2026-11-17.
export const MODEL_PRICES: Record<string, { input: number; output: number; cached: number; maxInputTokens?: number }> = {
  'gpt-6-luna': { input: 0.10, output: 0.50, cached:0.01 },
  'gpt-6.1-sol': { input: 2, output: 10, cached:0.10, maxInputTokens:922_000 },
  'gpt-6.1-terra': { input: 1, output: 5, cached:0.05, maxInputTokens:922_000 },
};
const positive = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return value !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const reasoningProfile=env.AI_REASONING_PROFILE?.trim() || 'speed';
  if(reasoningProfile!=='speed'&&reasoningProfile!=='quality')throw new Error('AI_REASONING_PROFILE: ожидается speed или quality.');
  const profile=MODEL_PROFILES[reasoningProfile];
  const serviceTier = env.AI_SERVICE_TIER?.trim() || 'default';
  if (serviceTier !== 'default' && serviceTier !== 'fast' && serviceTier !== 'ultrafast') throw new Error('AI_SERVICE_TIER: ожидается default, fast или ultrafast.');
  const model = env.OPENAI_MODEL?.trim() || 'gpt-6-luna';
  const known = MODEL_PRICES[model];
  const evaluatorModel = env.AI_EVALUATOR_MODEL?.trim();
  const evaluatorPrices = evaluatorModel ? MODEL_PRICES[evaluatorModel] : undefined;
  return {
    searchEnabled: Boolean(known) && env.AI_WEB_SEARCH !== '0', searchToolPriceUsd: known ? 0.01 : 0,
    ...(evaluatorModel ? { evaluator: {
      model: evaluatorModel,
      inputPricePerMillion: positive(env.AI_EVALUATOR_INPUT_USD_PER_MILLION, evaluatorPrices?.input ?? 0),
      outputPricePerMillion: positive(env.AI_EVALUATOR_OUTPUT_USD_PER_MILLION, evaluatorPrices?.output ?? 0),
      maxOutputTokens: Math.min(128000,Math.floor(positive(env.AI_EVALUATOR_MAX_OUTPUT_TOKENS,profile.limits.evaluator))),
    } } : {}),
    environment: env.NODE_ENV || 'development', apiKey: env.OPENAI_API_KEY?.trim() || '', model, serviceTier, reasoningProfile,
    budgetUsd: positive(env.AI_BUDGET_USD, 0),
    inputPricePerMillion: positive(env.AI_INPUT_USD_PER_MILLION, known?.input ?? 0),
    outputPricePerMillion: positive(env.AI_OUTPUT_USD_PER_MILLION, known?.output ?? 0),
    origin: env.APP_ORIGIN || 'http://localhost:3000',
    ledgerPath: path.resolve(env.DATA_DIR || '.data', 'ai-ledger.sqlite'),
    maxOutputTokens: Math.min(128000, Math.floor(positive(env.AI_MAX_OUTPUT_TOKENS, profile.limits.brief))),
    timeoutMs: Math.min(1_800_000, positive(env.AI_TIMEOUT_MS, 900_000)),
    // Local screen-share demo: zero disables public visitor admission limits.
    // One active turn per session still protects the order of chat memory.
    maxConcurrent: 0, sessionConcurrent: 1, sessionRate: 0, ipRate: 0,
    rateWindowMs: 60_000, responseTtlMs: 24 * 60 * 60_000, maxCachedResponses: 200,
    trustProxyHops: env.TRUST_PROXY_HOPS === '1' ? 1 : 0,
    production: env.NODE_ENV === 'production', clientPath: path.resolve('dist/client'),
  };
}
export function configurationReason(config: ServerConfig): string {
  if (!config.apiKey.trim()) return 'AI пока не подключён: заполните OPENAI_API_KEY на сервере.';
  if (!Number.isFinite(config.budgetUsd) || config.budgetUsd <= 0) return 'AI выключен: AI_BUDGET_USD должен быть положительным числом.';
  if (config.serviceTier !== 'default' && (!MODEL_PRICES[config.model] || config.evaluator && !MODEL_PRICES[config.evaluator.model])) return 'Для ускоренного режима требуется модель с подтверждённым тарифом.';
  if (![config.inputPricePerMillion, config.outputPricePerMillion].every(value => Number.isFinite(value) && value > 0)) return 'Для этой модели задайте обе ставки AI_INPUT_USD_PER_MILLION и AI_OUTPUT_USD_PER_MILLION.';
  if (config.evaluator && ![config.evaluator.inputPricePerMillion, config.evaluator.outputPricePerMillion].every(value => Number.isFinite(value) && value > 0)) return 'Для оценщика задайте обе ставки AI_EVALUATOR_INPUT_USD_PER_MILLION и AI_EVALUATOR_OUTPUT_USD_PER_MILLION.';
  return '';
}

export function searchConfigurationReason(config: ServerConfig): string {
  if (configurationReason(config)) return configurationReason(config);
  if (!config.searchEnabled) return 'Внешний поиск отключён в этой конфигурации.';
  if (!MODEL_PRICES[config.model] || config.searchToolPriceUsd !== 0.01) return 'Тариф и предел расхода внешнего поиска для этой модели не подтверждены.';
  return '';
}
