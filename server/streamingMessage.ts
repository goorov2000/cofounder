import { invalidResponse } from './errors.js';
import { ASSISTANT_TEXT_CHARS } from '../shared/transportLimits.js';

/** The strict schema puts message first. Only expose its decoded string, never
 * partial JSON, choices, memory or other metadata. The full reply is validated later. */
export function streamingMessage(json: string): string {
  return streamingMessageState(json).text;
}

export function streamingMessageState(json: string): { text: string; complete: boolean } {
  const prefix = /^\s*\{\s*"message"\s*:\s*"/.exec(json);
  if (!prefix) return { text: '', complete: false };
  let text = '', complete = false;
  for (let index = prefix[0].length; index < json.length; index++) {
    const char = json[index];
    if (char === '"') { complete = true; break; }
    if (char === '\\') {
      if (index + 1 >= json.length) break;
      const length = json[index + 1] === 'u' ? 6 : 2;
      if (index + length > json.length) break;
      try { text += JSON.parse(`"${json.slice(index, index + length)}"`) as string; }
      catch { throw invalidResponse(); }
      index += length - 1;
    } else {
      if (char.charCodeAt(0) < 32) throw invalidResponse();
      text += char;
    }
    if (text.length > ASSISTANT_TEXT_CHARS) throw invalidResponse();
  }
  // A delta can end between the two UTF-16 halves of an emoji.
  return { text: text.replace(/[\uD800-\uDBFF]$/, ''), complete };
}
