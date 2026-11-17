import type { AssistantReply, ChatRequest, MessageRevision } from '../shared/types.js';

// Literal quotation only. No paraphrase matching or inferred speaker. All exact
// colliding originals remain visible rather than choosing the first/latest one.
function visibleQuotes(reply: AssistantReply): string[] {
  const visible = [reply.message, reply.artifactDraft?.body].filter((text): text is string => typeof text === 'string');
  const quotes = visible.flatMap(text => Array.from(text.matchAll(/«([^«»\n]+)»|“([^“”\n]+)”|"([^"\n]+)"/gu), match => match[1] ?? match[2] ?? match[3]));
  return [...new Set(quotes.filter(quote => quote.trim() === quote && quote.length > 0))];
}

export function literalHistoryQuote(source: string, quote: string): boolean {
  let offset = source.indexOf(quote);
  while (offset !== -1) {
    const before = source.slice(0, offset).at(-1) ?? '';
    const after = source.slice(offset + quote.length)[0] ?? '';
    if (!(/[\p{L}\p{N}_]/u.test(quote[0]) && /[\p{L}\p{N}_]/u.test(before)) &&
        !(/[\p{L}\p{N}_]/u.test(quote.at(-1)!) && /[\p{L}\p{N}_]/u.test(after))) return true;
    offset = source.indexOf(quote, offset + 1);
  }
  return false;
}

export function deriveHistorySources(request: ChatRequest, reply: AssistantReply): NonNullable<AssistantReply['historySources']> {
  const core = request.coreContext;
  if (!core) return [];
  const quotes = visibleQuotes(reply);
  const result: NonNullable<AssistantReply['historySources']> = [];
  const seen = new Set<string>();
  for (const source of core.sourceMessages) {
    if (source.projectId !== request.projectId || (source.moduleId === core.moduleId && source.generation === core.generation && source.messageId === core.sourceMessage.messageId && source.revision === core.sourceMessage.revision)) continue;
    const matched = quotes.filter(quote => literalHistoryQuote(source.content, quote));
    const snapshot = JSON.stringify(source);
    if (matched.length && !seen.has(snapshot)) {
      seen.add(snapshot);
      result.push({ source: structuredClone(source) as MessageRevision, quotes: matched });
    }
  }
  return result;
}

export function attachHistorySources(request: ChatRequest, reply: AssistantReply): AssistantReply {
  const { historySources: _untrusted, ...rest } = reply;
  const historySources = deriveHistorySources(request, reply);
  return historySources.length ? { ...rest, historySources } : rest;
}
