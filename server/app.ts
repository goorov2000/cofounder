import { HTTP_REQUEST_BYTES, VALIDATED_REPLY_BYTES, CHAT_RESPONSE_BYTES } from '../shared/transportLimits.js';
import express, { type ErrorRequestHandler } from 'express';
import path from 'node:path';
import type { ChatRequest, ChatStreamEvent } from '../shared/types.js';
import { loadConfig, configurationReason, searchConfigurationReason, serviceTierForModel, type ServerConfig } from './config.js';
import { BudgetLedger, hash, type Reservation } from './ledger.js';
import { ServiceError } from './errors.js';
import { requestSchema, validateReply } from './validation.js';
import { estimateMaxCost, estimateInitialCost, generationOutputLimit, usageCost, OpenAIProvider, type Provider } from './provider.js';
import { researchTaskTimeout } from './researchLoop.js';
import { operationOutputLimit, modelProfileSettings } from './modelPolicy.js';
export interface AppOptions { provider?: Provider; ledger?: BudgetLedger; config?: Partial<ServerConfig>; admit?: (request: ChatRequest, maxCostUsd: number) => void }
export function createApp(options: AppOptions = {}) {
  const config = { ...loadConfig(), ...options.config };
  const taskTimeoutMs=researchTaskTimeout(config.timeoutMs,Boolean(config.evaluator));
  // Programmatic injection supports controlled-source evaluations through this same HTTP/ledger boundary; never exposed through request fields or environment switches.
  const ledger = options.ledger || new BudgetLedger(config.ledgerPath, {...config,timeoutMs:taskTimeoutMs});
  let provider = options.provider;
  const app = express();
  app.disable('x-powered-by');
  app.locals.close = () => { if (!options.ledger) ledger.close(); };
  app.set('trust proxy', config.trustProxyHops || false);
  const session = (cookie?: string) => ledger.session(cookie?.match(/(?:^|;\s*)cofounder_session=([a-f0-9]{64})(?:;|$)/)?.[1]);
  app.use('/api', (_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/health', (_request, response) => response.json({ ok: true }));
  app.get('/api/status', (request, response) => {
    if ((request.headers.origin && request.headers.origin !== config.origin) || request.headers['sec-fetch-site'] === 'cross-site') throw new ServiceError('ORIGIN_REJECTED', 'Откройте приложение с его основного адреса.', 403);
    if (!session(request.headers.cookie)) response.cookie('cofounder_session', ledger.createSession(request.ip || request.socket.remoteAddress || 'unknown'), { httpOnly: true, sameSite: 'strict', secure: config.origin.startsWith('https:'), maxAge: 7 * 24 * 60 * 60_000, path: '/' });
    const reason = configurationReason(config);
    response.json({ configured: !reason, reason, model: config.model, searchEnabled: !searchConfigurationReason(config), serviceTiers: {
      answer: serviceTierForModel(config.model,config.serviceTier),
      evaluator: config.evaluator ? serviceTierForModel(config.evaluator.model,config.serviceTier) : null,
      research: serviceTierForModel('gpt-6-luna',config.serviceTier),
    }, reasoningProfile: modelProfileSettings(config), runtimeLimits: {
      callTimeoutMs: config.timeoutMs, evaluatorTimeoutMs: config.timeoutMs, taskTimeoutMs,
    } });
  });
  app.post('/api/chat', (request, _response, next) => {
    if (request.headers.origin !== config.origin || request.headers['sec-fetch-site'] === 'cross-site') return next(new ServiceError('ORIGIN_REJECTED', 'Откройте приложение с его основного адреса.', 403));
    if (!session(request.headers.cookie)) return next(new ServiceError('SESSION_REQUIRED', 'Обновите подключение к приложению и повторите отправку.', 401, true));
    if (!request.is('application/json')) return next(new ServiceError('INVALID_REQUEST', 'Ожидается JSON-запрос.', 415));
    next();
  }, express.json({ limit: HTTP_REQUEST_BYTES, strict: true, inflate: false }), async (request, response, next) => {
    let reservation: Reservation | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let requestId: string | undefined;
    const streaming = request.headers.accept?.includes('text/event-stream');
    const emit = (event: ChatStreamEvent) => {
      if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const startStream = () => {
      response.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' });
      response.flushHeaders();
      emit({ type: 'start', requestId: requestId! });
      heartbeat = setInterval(() => { if (!response.destroyed) response.write(': keep-alive\n\n'); }, 15_000);
    };
    const controller = new AbortController();
    // Keep the first preview readable while the provider repairs or researches
    // a replacement. Only the validated complete envelope replaces it; internal
    // candidates must not erase/retype the same bubble on every round.
    let previewSuperseded = false;
    const disconnected = () => { if (!response.writableEnded) controller.abort(new ServiceError('REQUEST_ABORTED', 'Ожидание отменено. Исход запроса неизвестен; автоматического повтора нет.', 409)); };
    response.once('close', disconnected);
    try {
      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) throw new ServiceError('INVALID_REQUEST', 'Проверьте сообщение и контекст: слишком большой объём или неверный формат.', 400);
      const input = parsed.data as ChatRequest;
      requestId = input.requestId;
      const reason = configurationReason(config);
      if (reason) throw new ServiceError('AI_DISABLED', reason, 503);
      provider ||= new OpenAIProvider(config);
      options.admit?.(input, estimateMaxCost(input, config));
      const reserved = ledger.reserve(session(request.headers.cookie)!, input.requestId, hash(JSON.stringify(input)), estimateInitialCost(input, config), request.ip || request.socket.remoteAddress || 'unknown', true);
      // A cached reply can use the ordinary JSON envelope even for a streaming client.
      if (reserved.kind === 'cached') { response.status(reserved.status).json(reserved.body); return; }
      reservation = reserved.reservation;
      const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
      timer = setTimeout(() => controller.abort(new ServiceError('AI_TIMEOUT', 'AI не ответил вовремя. Исходное сообщение сохранено; повторная платная отправка заблокирована.', 504)), taskTimeoutMs);
      if (streaming) startStream();
      const trustedEvidence = ledger.trustedEvidence(reservation.session, input.projectId, input.coreContext?.evidence ?? []);
      const recoveredEvidence = (input.coreContext ? ledger.recoverableEvidence(reservation.session, input.projectId, input.moduleId, input.coreContext.generation) : [])
        .filter(source=>!trustedEvidence.some(item=>item.id===source.id&&item.version===source.version));
      for (const source of recoveredEvidence) if (!trustedEvidence.some(item => item.id===source.id && item.version===source.version)) trustedEvidence.push(source);
      const result = await Promise.race([provider.complete(input, controller.signal, streaming ? delta => {
        if (!controller.signal.aborted && !previewSuperseded) emit({ type: 'text.delta', requestId: input.requestId, delta });
      } : undefined, {trustedEvidence, recoveredEvidence, onTextReset: () => {previewSuperseded = true;}, onProgress: progress => {if (streaming && !controller.signal.aborted) emit({type:'progress',requestId:input.requestId,progress});}, onOperation: event => ledger.recordOperation(reservation!,event)}), aborted]);
      if (![result.usage.inputTokens, result.usage.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) throw new ServiceError('INVALID_RESPONSE', 'AI не вернул корректный учёт расхода. Автоматического повтора нет.');
      const paidOperations = ledger.readOperations(reservation);
      const outputAllowance=paidOperations.length?paidOperations.reduce((sum,event)=>{
        const kind=event.kind;
        return sum+(kind==='generate'||kind==='plan'||kind==='search'||kind==='evaluate'?operationOutputLimit(input,config,kind,/:check(?:-repair)?$/.test(String(event.id))):0);
      },0):generationOutputLimit(input,config);
      if (result.usage.outputTokens > outputAllowance) throw new ServiceError('INVALID_RESPONSE', 'AI превысил ограничение ответа. Автоматического повтора нет.');
      const output = { requestId: input.requestId, reply: validateReply(result.reply, input, [...trustedEvidence, ...(result.evidence ?? [])]), model: config.model };
      // Retrieval metadata comes from our provider, never from model-generated JSON.
      if (result.knowledgeSources?.length) output.reply.knowledgeSources = result.knowledgeSources;
      if (Buffer.byteLength(JSON.stringify(output.reply), 'utf8') > VALIDATED_REPLY_BYTES || Buffer.byteLength(JSON.stringify(output), 'utf8') > CHAT_RESPONSE_BYTES) throw new ServiceError('INVALID_RESPONSE', 'Ответ превышает безопасный размер. Прежняя работа сохранена; автоматического повтора нет.');
      const cost = result.costUsd ?? usageCost(result.usage, config, result.toolCalls ?? 0);
      if (!Number.isFinite(cost) || cost < 0) throw new ServiceError('INVALID_RESPONSE', 'Некорректный учёт стоимости. Автоматического повтора нет.');
      ledger.complete(reservation, cost, output);
      if (streaming) { emit({ type: 'complete', requestId: input.requestId, response: output }); response.end(); }
      else response.json(output);
    } catch (error) {
      let safe = error instanceof ServiceError ? error : new ServiceError('PROVIDER_ERROR', 'AI временно недоступен. Исходное сообщение сохранено; автоматического повтора нет.');
      if (reservation) safe = ledger.fail(reservation, safe.knownUnspent, safe);
      if (!response.destroyed) {
        if (response.headersSent) { emit({ type: 'error', requestId: requestId!, error: safe.toJSON().error }); response.end(); }
        else next(safe);
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      response.off('close', disconnected);
    }
  });
  app.use('/api', (_request, response) => response.status(404).json(new ServiceError('NOT_FOUND', 'API-маршрут не найден.', 404).toJSON()));
  if (config.production) {
    const clientPath = path.resolve(config.clientPath);
    app.use((request, response, next) => {
      if (request.path.split('/').some(segment => segment.startsWith('.')) || /^\/(server|src|shared)(?:\/|$)/.test(request.path)) { response.sendStatus(404); return; }
      next();
    });
    app.use(express.static(clientPath, { dotfiles: 'deny', index: false, fallthrough: true }));
    app.get('/{*path}', (request, response) => {
      if (path.extname(request.path) || !request.accepts('html')) { response.sendStatus(404); return; }
      response.set('Cache-Control', 'no-store').sendFile(path.join(clientPath, 'index.html'));
    });
  }
  const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
    const raw = error as { type?: string; status?: number };
    const safe = error instanceof ServiceError ? error : raw.type === 'entity.too.large' ? new ServiceError('BODY_TOO_LARGE', 'Контекст слишком большой. Сократите текст или материалы.', 413) : raw.status && raw.status < 500 ? new ServiceError('INVALID_REQUEST', 'Не удалось прочитать запрос.', raw.status) : new ServiceError('INTERNAL_ERROR', 'Не удалось обработать запрос. Исходное сообщение сохранено.', 500);
    const id = typeof request.body?.requestId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(request.body.requestId) ? request.body.requestId : undefined;
    response.status(safe.status).json(safe.toJSON(id));
  };
  app.use(errorHandler);
  return app;
}
