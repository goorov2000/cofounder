export type NumericInput = string | number | null | undefined;
export interface Scenario { period: string; pricePeriod?: string; currency?: string; sources?: Record<string, string>; provenance?: Record<string, 'user' | 'hypothesis' | 'unknown'> }
export interface MarketInput extends Scenario { totalBuyers: NumericInput; reachableBuyers: NumericInput; targetBuyers: NumericInput; price: NumericInput }
export interface EconomicsInput extends Scenario { customers: NumericInput; price: NumericInput; variableCostPerCustomer?: NumericInput; fixedCost?: NumericInput; acquisitionCost?: NumericInput; newCustomers?: NumericInput }
export interface CalculationValue { value: number | null; formula: string; unit: string; period: string; reason?: string }
export interface CalculationReport {
  inputs: Record<string, { raw: NumericInput; value: number | null; unit: string; source: string; provenance: 'user' | 'hypothesis' | 'unknown' }>;
  results: Record<string, CalculationValue>;
  warnings: string[];
  period: string;
  currency: string;
}
export function parseNonNegative(value: NumericInput, options: { percent?: boolean } = {}): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !/^\+?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const parsed = typeof value === 'number' ? value : Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 && (!options.percent || parsed <= 100) ? parsed : null;
}
function report(input: Scenario, entries: [string, NumericInput, string][]): CalculationReport {
  const period = input.period.trim();
  const currency = input.currency?.trim() || '₽';
  return {
    period, currency, results: {},
    inputs: Object.fromEntries(entries.map(([key, raw, unit]) => {
      const value = parseNonNegative(raw);
      const source = input.sources?.[key]?.trim() || 'Условный сценарий: основание не указано';
      return [key, { raw: raw ?? null, value, unit, source, provenance: value === null ? 'unknown' : input.provenance?.[key] ?? (input.sources?.[key]?.trim() ? 'user' : 'hypothesis') }];
    })),
    warnings: [
      ...(!period ? ['Укажите период расчёта.'] : []),
      ...(input.pricePeriod && input.pricePeriod.trim() !== period ? ['Период цены не совпадает с периодом расчёта. Приведите входы к одному периоду.'] : []),
      'Расчёт не подтверждает спрос или исходные допущения.',
    ],
  };
}
function calculate(result: CalculationReport, key: string, formula: string, values: (number | null)[], fn: (...values: number[]) => number, reason?: string, unit = result.currency): void {
  let value = reason || !result.period || values.some((entry) => entry === null) ? null : fn(...values as number[]);
  if (value !== null && !Number.isFinite(value)) { value = null; reason = 'Результат выходит за допустимый диапазон чисел.'; }
  result.results[key] = { value, formula, unit, period: result.period, ...(value === null ? { reason: reason || (!result.period ? 'Период не указан.' : 'Исходные значения неизвестны или некорректны.') } : {}) };
}
const show = (value: number | null) => value === null ? 'неизвестно' : String(value);
export function calculateMarket(input: MarketInput): CalculationReport {
  const currency = input.currency?.trim() || '₽';
  const pricePeriod = (input.pricePeriod === undefined ? input.period : input.pricePeriod) || 'период не указан';
  const result = report(input, [['totalBuyers', input.totalBuyers, 'покупателей'], ['reachableBuyers', input.reachableBuyers, 'покупателей'], ['targetBuyers', input.targetBuyers, 'покупателей'], ['price', input.price, `${currency} / покупатель / ${pricePeriod}`]]);
  const { totalBuyers: { value: total }, reachableBuyers: { value: reachable }, targetBuyers: { value: target }, price: { value: price } } = result.inputs;
  const mismatch = input.pricePeriod === '' ? 'Укажите период расходов на покупателя.' : input.pricePeriod && input.pricePeriod.trim() !== result.period ? 'Несогласованные периоды цены и рынка.' : undefined;
  const samError = total !== null && reachable !== null && reachable > total ? 'Доступных покупателей (SAM) не может быть больше всех покупателей (TAM).' : total === null ? 'Неизвестен общий объём покупателей для проверки SAM.' : undefined;
  const somError = reachable !== null && target !== null && target > reachable ? 'Достижимый объём (SOM) не может превышать доступный рынок (SAM).' : reachable === null ? 'Неизвестен доступный объём покупателей для проверки SOM.' : samError;
  for (const error of [samError, somError]) if (error && !result.warnings.includes(error)) result.warnings.push(error);
  calculate(result, 'tam', `TAM = все покупатели × цена = ${show(total)} × ${show(price)}`, [total, price], (a, b) => a * b, mismatch);
  calculate(result, 'sam', `SAM = доступные покупатели × цена = ${show(reachable)} × ${show(price)}`, [reachable, price], (a, b) => a * b, mismatch || samError);
  calculate(result, 'som', `SOM = достижимые покупатели × цена = ${show(target)} × ${show(price)}`, [target, price], (a, b) => a * b, mismatch || somError);
  return result;
}
export function calculateEconomics(input: EconomicsInput): CalculationReport {
  const currency = input.currency?.trim() || '₽';
  const pricePeriod = (input.pricePeriod === undefined ? input.period : input.pricePeriod) || 'период не указан';
  const result = report(input, [
    ['customers', input.customers, 'клиентов'], ['price', input.price, `${currency} / клиент / ${pricePeriod}`],
    ['variableCostPerCustomer', input.variableCostPerCustomer, `${currency} / клиент / ${input.period}`], ['fixedCost', input.fixedCost, `${currency} / ${input.period}`],
    ['acquisitionCost', input.acquisitionCost, `${currency} / ${input.period}`], ['newCustomers', input.newCustomers, `новых покупателей / ${input.period}`],
  ]);
  const { customers: { value: customers }, price: { value: price }, variableCostPerCustomer: { value: variable }, fixedCost: { value: fixed }, acquisitionCost: { value: acquisition }, newCustomers: { value: acquired } } = result.inputs;
  const mismatch = input.pricePeriod === '' ? 'Укажите период цены.' : input.pricePeriod && input.pricePeriod.trim() !== result.period ? 'Несогласованные периоды цены и расчёта.' : undefined;
  calculate(result, 'revenue', `Выручка = клиенты × цена = ${show(customers)} × ${show(price)}`, [customers, price], (a, b) => a * b, mismatch);
  calculate(result, 'variableCost', `Переменные затраты = клиенты × затраты на клиента = ${show(customers)} × ${show(variable)}`, [customers, variable], (a, b) => a * b);
  const revenue = result.results.revenue.value;
  const variableCost = result.results.variableCost.value;
  calculate(result, 'contribution', `Маржинальный доход = выручка − переменные затраты = ${show(revenue)} − ${show(variableCost)}`, [revenue, variableCost], (a, b) => a - b);
  const contribution = result.results.contribution.value;
  calculate(result, 'profit', `Прибыль = маржинальный доход − постоянные затраты = ${show(contribution)} − ${show(fixed)}`, [contribution, fixed], (a, b) => a - b);
  calculate(result, 'cac', `CAC = затраты привлечения / новые покупатели = ${show(acquisition)} / ${show(acquired)}`, [acquisition, acquired], (a, b) => a / b, acquired === 0 ? 'CAC неизвестен: новых покупателей нет, деление на ноль недопустимо.' : undefined, `${currency} / новый покупатель`);
  calculate(result, 'ltv', 'LTV не вычисляется без данных об удержании.', [], () => 0, 'Нет данных об удержании.', `${currency} / клиент`);
  return result;
}
