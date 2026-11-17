import type {AssistantReply, ChatRequest} from '../shared/types.js';
const object = '(?:карточк[ау]|черновик|план|таблиц[ау]|текст|сравнение|ответ)';
const promise = new RegExp(`(?:^|[.!?;,—–\\n])\\s*(?:ниже\\s*(?:[—–:-]\\s*)?${object}|${object}\\s+ниже|вот\\s+(?:он[ао]?|${object})|(?:привожу|показываю|даю)\\s+(?:${object}\\s+(?:здесь|ниже)|(?:здесь|ниже)\\s+${object}))(?=$|[^\\p{L}\\d])`, 'giu');
const handoff = new RegExp(`(?:^|[.!?;,—–\\n])\\s*(?:${object}\\s+(?:готов[ао]?|подготовлен[ао]?)|(?:подготовил[а]?|собрал[а]?|сформировал[а]?)\\s+${object})(?=$|[^\\p{L}\\d])`, 'giu');
// Only these finite continuation phrases are classified as presentation rather
// than content. Unknown prose stays outside this guard; length is not evidence.
const scaffold = /^(?:которая отделяет ваше предположение от того, что ещё нужно выяснить|(?:он|она) основан[а]? только на вашей идее и не подтверждает, что такая проблема уже есть у людей|(?:пока )?это гипотеза, а не подтвержд[её]нная проблема|вот он[ао]?|проекта|идеи|сравнения|для обсуждения|для проверки|для старта|(?:пока )?это (?:(?:рабочий|предварительный|первый) )?(?:черновик|вариант|карточка)|(?:он|она|они) основан[аы]? на (?:ваших вводных|вашем описании|текущих вводных|описании проекта)|(?:готов[ао]?|подготовлен[ао]?)|(?:его|её|ее|их) можно (?:открыть|посмотреть|сохранить)(?: отдельно| по кнопке| в черновике)?|(?:откройте|посмотрите|сохраните) (?:его|её|ее|черновик|карточку)(?: отдельно| по кнопке)?|детали можно уточнить позже|можно уточнить позже)(?=$|[^\p{L}\d])/iu;
function presentationOnly(tail: string): boolean {
  let rest = tail.trim();
  while (rest) {
    rest = rest.replace(/^[\s.,!?:;—–-]+/u, '');
    if (!rest) return true;
    const match = rest.match(scaffold);
    if (!match) return false;
    rest = rest.slice(match[0].length);
  }
  return true;
}
function inFencedCode(text: string, at: number): boolean {
  let open: string | undefined;
  for (const match of text.slice(0,at).matchAll(/^ {0,3}(`{3,}|~{3,})[^\n]*$/gmu)) {
    if (!open) open = match[1];
    else if (match[1][0] === open[0] && match[1].length >= open.length && /^ {0,3}(?:`+|~+)\s*$/u.test(match[0])) open = undefined;
  }
  return Boolean(open);
}
function requestsInline(message: string): boolean {
  const verbs = /(?<![\p{L}\d])(?:покажи(?:те)?|показывай(?:те)?|приведи(?:те)?|напиши(?:те)?|выведи(?:те)?|дай(?:те)?|пришли(?:те)?)[^.!?\n]{0,180}(?:в (?:этом )?(?:чате|сообщении)|прямо здесь)/giu;
  return [...message.matchAll(verbs)].some(match => !/(?<![\p{L}\d])не\s+$/iu.test(message.slice(0,match.index)));
}
/** A finite terminal promise check, not a general measure of answer usefulness. */
export function missingPromisedInlineContent(
  request: Pick<ChatRequest,'message'>,
  reply: Pick<AssistantReply,'message'|'artifactDraft'>,
): {path:['message'];rule:'missing_promised_inline_content'} | undefined {
  if (!reply.artifactDraft?.body.trim()) return;
  // An exact body already in the message is visible, even if a later cue is
  // awkwardly phrased. Never require a useful paraphrase to duplicate it.
  if (reply.message.includes(reply.artifactDraft.body.trim())) return;
  const patterns = [promise, ...(requestsInline(request.message) ? [handoff] : [])];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of reply.message.matchAll(pattern)) {
      if (!inFencedCode(reply.message,match.index!) && presentationOnly(reply.message.slice(match.index!+match[0].length))) {
        return {path:['message'],rule:'missing_promised_inline_content'};
      }
    }
  }
}
