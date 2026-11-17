import { HTTP_REQUEST_BYTES, CHAT_RESPONSE_BYTES, CHAT_STREAM_BYTES, ASSISTANT_TEXT_CHARS } from '../../shared/transportLimits.js';
import { replySchema, requestSchema } from '../../shared/validation.js';
import { diagnoseCoreRequest, researchProgressSchema } from '../../shared/coreValidation.js';
import type { ChatRequest, ChatResponse, ResearchProgress } from '../../shared/types.js';
export interface ApiStatus { configured: boolean; reason: string; model: string; searchEnabled: boolean; searchDisabledReason?: string }
export interface RequestPreparationDiagnostics {
  code: 'CONTEXT_LIMIT' | 'INVALID_REQUEST_CONTEXT';
  bytes: number;
  limitBytes: number;
  sections: Record<string, number>;
  issues: { path: (string | number)[]; code: string }[];
}
export class ApiRequestError extends Error {
  readonly name = 'ApiRequestError';
  constructor(public readonly code: string, message: string, public readonly retryable: boolean, public readonly requestId?: string, public readonly diagnostics?: RequestPreparationDiagnostics) { super(message); }
}
// A reply includes up to six full method cards and six bounded read pages.
const MAX_REPLY_BYTES = CHAT_RESPONSE_BYTES;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
async function readJson(response: Response, requestId?: string): Promise<unknown> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REPLY_BYTES) throw new ApiRequestError('INVALID_RESPONSE', 'Ответ сервера слишком большой.', false, requestId);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ApiRequestError('INVALID_RESPONSE', 'Сервер вернул нечитаемый ответ. Сообщение сохранено.', false, requestId); }
  if (!response.ok) {
    const error = record(value) && record(value.error) ? value.error : null;
    throw new ApiRequestError(typeof error?.code === 'string' ? error.code : 'SERVER_ERROR', typeof error?.message === 'string' ? error.message.slice(0, 500) : 'Не удалось обработать сообщение.', error?.retryable === true, requestId);
  }
  return value;
}
let statusFlight: Promise<ApiStatus> | undefined;
export function getStatus(): Promise<ApiStatus> {
  // Coalesce first visits so simultaneous sends cannot mint competing anonymous owners.
  if (!statusFlight) statusFlight = (async () => {
    try {
      const value = await readJson(await fetch('/api/status', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10_000) }));
      if (!record(value) || typeof value.configured !== 'boolean' || typeof value.reason !== 'string' || typeof value.model !== 'string' || typeof value.searchEnabled !== 'boolean') throw new ApiRequestError('INVALID_RESPONSE', 'Не удалось проверить состояние AI.', false);
      return value as unknown as ApiStatus;
    } catch (error) {
      if (error instanceof ApiRequestError) throw error;
      throw new ApiRequestError('NETWORK_ERROR', 'Нет связи с сервером. Локальные материалы доступны.', true);
    } finally { statusFlight = undefined; }
  })();
  return statusFlight;
}
async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  let abort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener('abort', abort); }
}
async function readChatStream(response: Response, requestId: string, onText: (delta: string) => void, onProgress?: (progress: ResearchProgress) => void, onTextReset?: () => void): Promise<unknown> {
  const interrupted = () => new ApiRequestError('NETWORK_ERROR', 'Связь прервана. Повтор с тем же идентификатором проверит результат без дублирования.', true, requestId);
  const invalid = () => new ApiRequestError('INVALID_RESPONSE', 'Сервер вернул некорректный поток ответа. Сообщение сохранено.', false, requestId);
  if (!response.body) throw interrupted();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', received = 0, textLength = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      received += value?.byteLength ?? 0;
      buffer += decoder.decode(value, { stream: !done });
      if (received > CHAT_STREAM_BYTES) throw invalid();
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        if (new TextEncoder().encode(frame).byteLength > MAX_REPLY_BYTES) throw invalid();
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue; // SSE comments keep the connection alive during reasoning.
        let event: unknown;
        try { event = JSON.parse(data); } catch { throw invalid(); }
        if (!record(event) || event.requestId !== requestId) throw invalid();
        if (event.type === 'start') continue;
        if (event.type === 'progress') {
          const progress = researchProgressSchema.safeParse(event.progress);
          if (!progress.success) throw invalid();
          onProgress?.(progress.data);
        } else if (event.type === 'text.reset') {
          textLength = 0;
          onTextReset?.();
        } else if (event.type === 'text.delta') {
          if (typeof event.delta !== 'string' || (textLength += event.delta.length) > ASSISTANT_TEXT_CHARS) throw invalid();
          onText(event.delta);
        } else if (event.type === 'complete') {
          return event.response;
        } else if (event.type === 'error') {
          if (!record(event.error) || typeof event.error.code !== 'string' || typeof event.error.message !== 'string') throw invalid();
          throw new ApiRequestError(event.error.code, event.error.message.slice(0, 500), event.error.retryable === true, requestId);
        } else throw invalid();
      }
      if (new TextEncoder().encode(buffer).byteLength > MAX_REPLY_BYTES) throw invalid();
      if (done) throw interrupted(); // EOF alone must never commit an unfinished reply.
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function sendChat(request: ChatRequest, signal?: AbortSignal, onText?: (delta: string) => void, onProgress?: (progress: ResearchProgress) => void, onTextReset?: () => void): Promise<ChatResponse> {
  try {
    assertRequestFits(request);
    // The status route issues/refreshes the HttpOnly session. Configuration errors come from POST.
    await withAbort(getStatus(), signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await fetch('/api/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: onText ? 'text/event-stream' : 'application/json' }, body: JSON.stringify(request), signal });
    const value = response.ok && response.headers.get('Content-Type')?.includes('text/event-stream')
      ? await readChatStream(response, request.requestId, onText ?? (() => {}), onProgress, onTextReset)
      : await readJson(response, request.requestId);
    if (!record(value) || value.requestId !== request.requestId || typeof value.model !== 'string' || !record(value.reply) || typeof value.reply.message !== 'string' || !Array.isArray(value.reply.choices) || !Array.isArray(value.reply.proposedFacts) || !(value.reply.artifactDraft === null || record(value.reply.artifactDraft))) throw new ApiRequestError('INVALID_RESPONSE', 'AI вернул некорректный ответ. Сообщение сохранено.', false, request.requestId);
    if (!replySchema.safeParse(value.reply).success) throw new ApiRequestError('INVALID_RESPONSE', 'AI вернул некорректную память или источник. Прежняя работа сохранена.', false, request.requestId);
    return value as unknown as ChatResponse;
  } catch (error) {
    if (error instanceof ApiRequestError) throw new ApiRequestError(error.code, error.message, error.retryable, request.requestId, error.diagnostics);
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw new ApiRequestError('REQUEST_ABORTED', 'Ожидание отменено. Сообщение сохранено; автоматического повтора нет.', false, request.requestId);
    throw new ApiRequestError('NETWORK_ERROR', 'Связь прервана. Сообщение сохранено. Повтор с тем же идентификатором проверит результат без дублирования.', true, request.requestId);
  }
}

export function assertRequestFits(request: ChatRequest): void {
  const size = (value: unknown) => value === undefined ? 0 : new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const bytes = size(request);
  const parsed = requestSchema.safeParse(request);
  if (bytes <= HTTP_REQUEST_BYTES && parsed.success) return;
  const code = bytes > HTTP_REQUEST_BYTES ? 'CONTEXT_LIMIT' : 'INVALID_REQUEST_CONTEXT';
  const coreIssue = !parsed.success && parsed.error.issues.some(issue => issue.code === 'custom' && issue.path.length === 0) ? diagnoseCoreRequest(request) : undefined;
  // Diagnostic metadata deliberately excludes messages, field values, IDs and
  // source contents. It can be copied for support without sharing the project.
  const diagnostics: RequestPreparationDiagnostics = {
    code, bytes, limitBytes: HTTP_REQUEST_BYTES,
    sections: { history: size(request.context.history), currentDraft: size(request.context.currentDraft), artifacts: size(request.context.artifacts), facts: size(request.context.facts), memories: size(request.context.memories), coreContext: size(request.coreContext) },
    issues: parsed.success ? [] : parsed.error.issues.slice(0, 10).map(issue => issue.code === 'custom' && issue.path.length === 0 && coreIssue ? { path: coreIssue.path, code: coreIssue.rule } : { path: issue.path.filter((part): part is string | number => typeof part !== 'symbol'), code: issue.code }),
  };
  const message = code === 'CONTEXT_LIMIT'
    ? `В проекте накопилось больше материалов, чем можно передать AI за один раз: ${Math.ceil(bytes / 1024)} КБ при лимите ${HTTP_REQUEST_BYTES / 1024} КБ. Сообщение не отправлено, сведения не обрезаны. Скачайте копию перед редактированием материалов.`
    : 'Приложение не смогло подготовить данные проекта для отправки. Это внутренняя ошибка, а не ограничение длины вашего сообщения. Переписка сохранена; запрос к AI не отправлен. Скопируйте сведения об ошибке, чтобы выяснить причину.';
  throw new ApiRequestError(code, message, false, request.requestId, diagnostics);
}
