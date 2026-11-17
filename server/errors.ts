import type { ApiError } from '../shared/types.js';
export class ServiceError extends Error {
  constructor(public code: string, message: string, public status = 502, public retryable = false, public knownUnspent = false) { super(message); }
  toJSON(requestId?: string): ApiError { return { error: { code: this.code, message: this.message, retryable: this.retryable }, ...(requestId ? { requestId } : {}) }; }
}
export const invalidResponse = () => new ServiceError('INVALID_RESPONSE', 'AI вернул некорректный ответ. Исходное сообщение сохранено; автоматического повтора нет.');

export function recoveryFailure(moduleId:string,issue?:{path?:(string|number)[];rule?:string;relatedIssues?:Array<{path:(string|number)[];rule:string}>}):ServiceError {
  const field=issue?.path?.[0];
  const hasURLIssue=[issue,...(issue?.relatedIssues ?? [])].some(item=>item?.rule==='unprovided_url');
  const reason=hasURLIssue?'Ссылка в ответе не совпала с доступными источниками. Точный адрес нужно брать из уже прочитанного каталога.':issue?.rule==='missing_visible_price_qualification'?'Платформенное ограничение прочитанной цены не перенесено в сравнение; условие нужно показать рядом с соответствующей суммой.':issue?.rule==='unsupported_grouped_price'?'Обобщение внешних цен не подтверждено отдельными прочитанными тарифами; суммы и условия оплаты нужно сверить по каждому источнику.':field==='externalClaims'?'Точное основание внешнего утверждения или условия тарифа не подтверждено.':field==='memoryPatch'?'Не подтверждено основание изменения памяти; прежние решения сохранены.':field==='message'?'Обещанный результат не прошёл проверку полноты.':'Структура или основания результата не прошли проверку.';
  const next=moduleId==='audience'?'Для первого теста сравните сегменты по ситуации, масштабу задачи и доступности контакта; спрос остаётся гипотезой.':moduleId==='competitors'?'Продолжить можно сравнением альтернатив по одной задаче; неизвестные условия тарифов оставьте неизвестными.':'Продолжить можно новым сообщением с одним конкретным исправлением; исходные данные и решения уже сохранены.';
  return new ServiceError('INVALID_RESPONSE',`Не удалось проверить ответ после уточнения. ${reason} ${next}`,502);
}
