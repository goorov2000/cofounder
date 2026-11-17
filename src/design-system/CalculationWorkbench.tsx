import { useId } from 'react';
import { ChevronDown, MessageSquareText } from 'lucide-react';
import { Alert, Button, Field } from './components';
import { calculationFields, calculationReport, type StoredCalculation } from '../../shared/calculationScenario';
import { parseNonNegative } from '../../shared/calculations';
import './calculation-workbench.css';

const fields: Record<string, { label: string; hint: string; unit: string }> = {
  totalBuyers: { label: 'Потенциальные покупатели', hint: 'Все уникальные покупатели в границах TAM.', unit: 'чел.' },
  reachableBuyers: { label: 'Доступные покупатели', hint: 'Часть TAM, которую может обслужить проект.', unit: 'чел.' },
  targetBuyers: { label: 'Достижимые покупатели', hint: 'Кого сможете привлечь и обслужить за период.', unit: 'чел.' },
  price: { label: 'Расходы одного покупателя', hint: 'Все его покупки за период расчёта.', unit: '' },
  customers: { label: 'Платящие клиенты', hint: 'Уникальные клиенты за период расчёта.', unit: 'чел.' },
  variableCostPerCustomer: { label: 'Затраты на одного клиента', hint: 'Переменные затраты за тот же период.', unit: '' },
  fixedCost: { label: 'Постоянные затраты', hint: 'Расходы, не зависящие от числа клиентов.', unit: '' },
  acquisitionCost: { label: 'Расходы на привлечение', hint: 'Все расходы на новых клиентов за период.', unit: '' },
  newCustomers: { label: 'Новые клиенты', hint: 'Привлечённые покупатели за период.', unit: 'чел.' },
};
const results: Record<string, { title: string; label: string }> = {
  tam: { title: 'TAM', label: 'Весь потенциальный рынок' }, sam: { title: 'SAM', label: 'Доступная часть рынка' }, som: { title: 'SOM', label: 'Достижимый объём' },
  revenue: { title: 'Выручка', label: 'Поступления от клиентов' }, contribution: { title: 'Маржинальный доход', label: 'После переменных затрат' }, profit: { title: 'Прибыль', label: 'После всех затрат' },
  variableCost: { title: 'Переменные затраты', label: 'На всех клиентов' }, cac: { title: 'CAC', label: 'Цена нового клиента' }, ltv: { title: 'LTV', label: 'Доход за время работы с клиентом' },
};

export function CalculationWorkbench({ moduleId, stored, onChange, onDiscuss }: {
  moduleId: 'market' | 'economics'; stored?: StoredCalculation; onChange: (report: StoredCalculation) => void; onDiscuss?: () => void;
}) {
  const id = useId();
  const keys = calculationFields[moduleId];
  const values: Record<string, string> = { period: stored?.period ?? '', pricePeriod: stored?.pricePeriod ?? stored?.period ?? '', currency: stored?.currency ?? '₽', ...Object.fromEntries(Object.entries(stored?.inputs ?? {}).map(([key, input]) => [key, String(input.raw ?? '')])) };
  const sources = Object.fromEntries(Object.entries(stored?.inputs ?? {}).map(([key, input]) => [key, input.source.startsWith('Условный сценарий:') ? '' : input.source]));
  const provenance = Object.fromEntries(Object.entries(stored?.inputs ?? {}).map(([key, input]) => [key, input.provenance]));
  const report = calculationReport(moduleId, values, sources, provenance);
  const known = keys.filter(key => report.inputs[key]?.value !== null).length;
  const primary = moduleId === 'market' ? ['tam', 'sam', 'som'] : ['revenue', 'contribution', 'profit'];
  function edit(key: string, value: string, sourceOnly = false) {
    const nextValues = sourceOnly ? values : { ...values, [key]: value };
    const nextSources = sourceOnly ? { ...sources, [key]: value } : key in report.inputs && value !== values[key] ? { ...sources, [key]: '' } : sources;
    const nextProvenance = { ...provenance };
    if (key in report.inputs) nextProvenance[key] = nextSources[key]?.trim() ? 'user' : 'hypothesis';
    onChange({ ...calculationReport(moduleId, nextValues, nextSources, nextProvenance), pricePeriod: nextValues.pricePeriod,
      fieldOrigins: { ...stored?.fieldOrigins, [key]: 'manual' }, ...(stored?.stale ? { stale: true, staleReason: stored.staleReason } : {}) });
  }
  function resultCard(key: string) {
    const result = report.results[key];
    return <section className={`ds-calc-result${result.value === null ? ' is-unknown' : ''}`} key={key} aria-label={results[key].title}>
      <header><strong>{results[key].title}</strong><span>{results[key].label}</span></header>
      <div className="ds-calc-number">{result.value === null ? 'Нужны вводные' : <>{result.value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}<span>{result.unit}</span></>}</div>
      <small>{report.period ? `За период: ${report.period}` : 'Период пока не определён'}</small>
      <details className="ds-calc-formula"><summary>Как считается<ChevronDown size={14} aria-hidden="true" /></summary><p>{result.formula}</p>{result.reason && <p>{result.reason}</p>}</details>
    </section>;
  }
  const issues = report.warnings.filter(warning => !['Расчёт не подтверждает спрос или исходные допущения.', 'Укажите период расчёта.'].includes(warning) && !warning.startsWith('Неизвестен'));
  return <div className="ds-calculation-workbench">
    <div className="ds-calc-intro"><div className="ds-calc-intro-title"><h3>{moduleId === 'market' ? 'Объём рынка' : 'Экономика проекта'}</h3><span>Рабочий сценарий</span></div><p>Вводные подхватываются из обсуждения. Любое значение можно уточнить вручную.</p></div>
    {stored?.stale && <div role="status"><Alert tone="warning"><strong>Проверьте актуальность вводных.</strong> {stored.staleReason || 'Решения проекта изменились.'}<Button size="sm" variant="ghost" onClick={() => onChange({ ...stored, stale: false, staleReason: undefined })}>Вводные проверены</Button></Alert></div>}
    <div className="ds-calc-results">{primary.map(resultCard)}</div>
    {moduleId === 'economics' && <details className="ds-calc-additional"><summary>Затраты и показатели привлечения<ChevronDown size={16} aria-hidden="true" /></summary><div className="ds-calc-results">{['variableCost', 'cac', 'ltv'].map(resultCard)}</div></details>}
    <section className="ds-calc-data" aria-label="Вводные расчёта"><header className="ds-calc-section-heading"><h4>Вводные</h4><span>Заполнено {known} из {keys.length}</span></header>
      {known === 0 && <div className="ds-calc-empty"><MessageSquareText size={20} aria-hidden="true" /><div><strong>{moduleId === 'market' ? 'Начните с обсуждения рынка' : 'Начните с обсуждения экономики'}</strong><p>Обоснованные числа появятся здесь после ответа наставника. Если уже знаете значения, внесите их ниже.</p>{onDiscuss && <Button size="sm" variant="ghost" onClick={onDiscuss}>Вернуться в обсуждение</Button>}</div></div>}
      <div className="ds-calc-settings"><Field label="Период расчёта" placeholder="Не определён" list={`${id}-periods`} value={values.period} onChange={event => edit('period', event.target.value)} /><Field label={moduleId === 'market' ? 'Период расходов' : 'Период цены'} placeholder="Не определён" list={`${id}-periods`} value={values.pricePeriod} onChange={event => edit('pricePeriod', event.target.value)} /><Field label="Валюта" value={values.currency} onChange={event => edit('currency', event.target.value)} /><datalist id={`${id}-periods`}><option value="месяц" /><option value="год" /></datalist></div>
      <div className="ds-calc-inputs">{keys.map(key => {
        const config = fields[key], input = report.inputs[key], automatic = stored?.fieldOrigins?.[key] === 'conversation';
        const label = key === 'price' && moduleId === 'economics' ? 'Доход от одного клиента' : config.label;
        return <div className="ds-calc-input" key={key}>
          <div className="ds-calc-input-caption"><span>{key === 'totalBuyers' ? 'TAM' : key === 'reachableBuyers' ? 'SAM' : key === 'targetBuyers' ? 'SOM' : key === 'price' ? 'На одного клиента' : 'За период'}</span><span>{input.value === null ? 'Неизвестно' : automatic ? input.provenance === 'hypothesis' ? 'Из диалога · гипотеза' : 'Из диалога' : input.provenance === 'hypothesis' ? 'Вручную · гипотеза' : 'Вручную'}</span></div>
          <div className="ds-calc-value"><Field label={label} inputMode="decimal" placeholder="Пока неизвестно" value={values[key] ?? ''} onChange={event => edit(key, event.target.value)} error={values[key]?.trim() && parseNonNegative(values[key]) === null ? 'Введите число от нуля. Например: 1250,5.' : undefined} /><span aria-hidden="true">{config.unit || values.currency}</span></div>
          <p className="ds-calc-field-hint">{config.hint}</p>
          <details className="ds-calc-source"><summary>{sources[key] ? 'Основание указано' : 'Добавить основание'}<ChevronDown size={14} aria-hidden="true" /></summary><div className="ds-field"><label htmlFor={`${id}-${key}-source`}>{`Основание: ${label.toLowerCase()}`}</label><textarea id={`${id}-${key}-source`} className="ds-textarea" rows={3} placeholder="Откуда число или на чём основано допущение" value={sources[key] ?? ''} onChange={event => edit(key, event.target.value, true)} /></div>{automatic && <p>Правка закрепит это значение за вами. Новые ответы наставника его не заменят.</p>}</details>
        </div>;
      })}</div>
    </section>
    {issues.length > 0 && <Alert tone="warning"><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></Alert>}
    <footer className="ds-calc-footer"><p>Изменения сохраняются автоматически и учитываются в разговоре.</p><p>{moduleId === 'market' ? 'Объём заказов отличается от выручки сервиса. ' : 'Выручка и прибыль различаются. '}Числа без подтверждения остаются допущениями.</p></footer>
  </div>;
}
