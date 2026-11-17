import {sameSingleAmount} from '../shared/coreValidation.js';
/** Finite rate grammar; capacity, arithmetic and other prices cannot supply a denominator. */
const units = [
  ['филиал', 'филиала', 'филиалов', 'branch', 'branches'],
  ['точка', 'точку', 'точки', 'точек', 'location', 'locations', 'site', 'sites'],
  ['пользователь', 'пользователя', 'пользователей', 'user', 'users'],
  ['сотрудник', 'сотрудника', 'сотрудников', 'employee', 'employees'],
  ['человек', 'человека', 'person', 'people'],
  ['компания', 'компанию', 'компании', 'company'],
  ['день', 'дня', 'дней', 'day', 'daily'],
  ['час', 'часа', 'часов', 'hour', 'hourly'],
];
const unknown = /^(?:unknown|неизвестно|не указано|не указаны|не указана|неизвестны)$/iu;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const currencies = [['₽','rub','rur','руб','руб.','рублей','рубля','рубль'], ['€','eur','евро'], ['usd','доллар','долларов'], ['$']];
export function groundedPriceUnitBasis(price: { amount: string; currency: string; unit: string }, quote: string): boolean {
  const unit = price.unit.toLowerCase().trim();
  if (unknown.test(unit)) return true;
  const aliases = units.find(group => group.includes(unit.replace(/^(?:за\s+(?:всю\s+)?|в\s+|per\s+)/u, '')));
  // Existing lexical validation remains responsible for unrecognised units.
  if (!aliases) return true;
  const amount = price.amount;
  const literalCurrency = price.currency.toLowerCase().trim();
  const currency = unknown.test(literalCurrency) ? undefined : currencies.find(group => group.includes(literalCurrency)) ?? (literalCurrency ? [literalCurrency] : undefined);
  if (!amount || !literalCurrency) return false;
  // Unrecognised denominations have exact literal identity only; no FX or
  // guessed symbol/ISO equivalence is introduced.
  const cash = [...currencies.flat(), ...(currency ?? [])].sort((a,b)=>b.length-a.length).map(escape).join('|');
  const numeric = '\\d(?:[\\d \\u00a0\\u202f]*\\d)?(?:[.,]\\d+)?(?:\\s*(?:тыс\\.?|к|k))?';
  const token = new RegExp(`(?<![\\p{L}\\d])(?:(?<amount>${numeric})\\s*(?<currency>${cash})|(?<prefixCurrency>${cash})\\s*(?<prefixAmount>${numeric})${!currency ? `|(?<bareAmount>${numeric})` : ''})(?![\\p{L}\\d])`, 'giu');
  const matching = [...quote.matchAll(token)].filter(m => sameSingleAmount(m.groups!.amount ?? m.groups!.prefixAmount ?? m.groups!.bareAmount, amount) && (!currency || currency.includes((m.groups!.currency ?? m.groups!.prefixCurrency ?? '').toLowerCase())));
  if (!matching.length) return false;
  const noun = `(?:${aliases.map(escape).join('|')})(?![\\p{L}\\d])`;
  const connector = '(?:/\\s*|за\\s+(?:(?:каждого|каждый|каждую|одного|одну|всю)\\s+)?|в\\s+|per\\s+)';
  const timeAxis = '(?:(?:/\\s*|в\\s+|per\\s+)(?:месяц|мес\\.?|month|year|год)(?![\\p{L}\\d])\\s*)?';
  const after = new RegExp(`^\\s*${timeAxis}${connector}${noun}`, 'iu');
  // Pricing cards also use "9.99\nuser/month billed yearly". The noun
  // directly follows this amount and owns an explicit /time denominator;
  // a nearby user count or a bare capacity label is insufficient.
  const cardRate = new RegExp(`^\\s*${noun}\\s*/\\s*(?:месяц|мес\\.?|months?|год|years?)(?![\\p{L}\\p{N}_])`, 'iu');
  const before = new RegExp(`(?:^|[.!?;\\n])\\s*${connector}${noun}\\s*[:—–-]?\\s*$`, 'iu');
  // All occurrences must agree. Identical amounts in different plans are
  // ambiguous, even when one occurrence happens to have a valid denominator.
  return matching.every(m => {
    const left = quote.slice(Math.max(0,m.index!-120),m.index!);
    const headingRate = new RegExp(`(?:^|\\n)\\s*${noun}\\s*:\\s*(?:[−-]\\s*\\d+\\s*\\+\\s*)?Каждый следующий\\s*[—–-]\\s*$`, 'iu');
    const right = quote.slice(m.index! + m[0].length);
    return after.test(right) || cardRate.test(right) || before.test(left) || headingRate.test(left);
  });
}
