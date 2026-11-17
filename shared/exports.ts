import { getCurrentEntries } from './coreMemory.js';
import type { ModuleId, Project, SourceRef } from './types.js';
import type { CalculationReport } from './calculations.js';
import { MODULES, STAGE_IDS, TOOL_IDS } from './modules.js';
import { isHttpUrl, PROVENANCE_LABELS } from './validation.js';
function section(project: Project, id: ModuleId): string {
 const state=project.modules[id],artifact=state.artifact,draft=state.proposal?.artifactDraft,memory=state.memory?.content;
 const context=draft ? `> Рабочая формулировка из контекста. Предложение не является подтверждённым фактом.\n\n${draft.body}`
  : memory ? [memory.facts.map(fact=>`- ${fact.text}`).join('\n'),memory.hypotheses.length?`Гипотезы:\n${memory.hypotheses.map(text=>`- ${text}`).join('\n')}`:'',memory.openQuestions.length?`Неизвестное:\n${memory.openQuestions.map(text=>`- ${text}`).join('\n')}`:''].filter(Boolean).join('\n\n') : '';
 return `## ${MODULES[id].title}\n\n${artifact ? `${artifact.stale ? `> Требует пересмотра: ${artifact.staleReason || 'Изменились исходные решения'}\n\n` : ''}${artifact.body}` : context ? `${state.memory?.needsRefresh ? '> Контекст требует пересмотра.\n\n' : ''}${context}` : 'Неизвестно — тема ещё не проработана.'}`;
}
function facts(project: Project): string {
 return `## Решения, основания и источники\n\n${Object.values(project.facts).map(f=>`- ${f.key}: ${f.value || 'Неизвестно'} — ${PROVENANCE_LABELS[f.provenance]}. ${f.note}${f.sourceUrl && isHttpUrl(f.sourceUrl) ? ` Источник пользователя: ${f.sourceUrl}.` : ''}${f.checkedAt ? ` Дата проверки: ${f.checkedAt}.` : ''}`).join('\n') || 'Неизвестно — общие решения не заполнены.'}`;
}
function calculations(project: Project): string {
 const labels: Record<string, string> = { totalBuyers: 'Все потенциальные покупатели', reachableBuyers: 'Доступные покупатели', targetBuyers: 'Достижимые покупатели', price: 'Цена за покупателя', customers: 'Клиенты', variableCostPerCustomer: 'Переменные затраты на клиента', fixedCost: 'Постоянные затраты', acquisitionCost: 'Затраты привлечения', newCustomers: 'Новые покупатели' };
 return (['market', 'economics'] as const).flatMap(id => {
  const report = project.calculations[id] as (CalculationReport & { pricePeriod?: string; stale?: boolean; staleReason?: string }) | undefined;
  if (!report) return [];
  const number = (value: string | number | null | undefined) => value === null || value === undefined || value === '' ? 'неизвестно' : String(value);
  return [`## Расчёт: ${MODULES[id].shortTitle}\n\n${report.stale ? `> Устаревший расчёт: ${report.staleReason || 'Изменились исходные решения.'} Прежние значения сохранены; требуется сверка.\n\n` : ''}Период расчёта: ${report.period || 'неизвестно'}. Период цены: ${(report.pricePeriod === undefined ? report.period : report.pricePeriod) || 'неизвестно'}. Валюта: ${report.currency}.\n\n### Исходные данные и основания\n\n${Object.entries(report.inputs).map(([key,input]) => `- ${labels[key] || key}: ввод ${number(input.raw)}; принято ${number(input.value)} ${input.unit}. ${PROVENANCE_LABELS[input.provenance]}. Основание: ${input.source}`).join('\n')}\n\n### Результаты и формулы\n\n${Object.entries(report.results).map(([key,result]) => `- ${key.toUpperCase()}: ${number(result.value)} ${result.unit} / ${result.period || 'период не указан'}. ${result.formula}${result.reason ? ` Основание неизвестного результата: ${result.reason}` : ''}`).join('\n')}\n\n### Оговорки\n\n${report.warnings.map(warning => `- ${warning}`).join('\n')}`];
 }).join('\n\n');
}
function header(project: Project): string {
 return `# ${project.name}\n\n${project.isDemo ? '> Вымышленный пример. Числа и решения не подтверждены.\n\n' : ''}${project.description || 'Описание не заполнено.'}\n\nСтадия: ${project.stageLabel || 'Не указана'}.\n\nГипотезы и расчёты требуют проверки. Происхождение сведений и ограничения указаны отдельно. Публичный тариф не подтверждает спрос или фактический средний чек.`;
}
export function projectToMarkdown(project: Project): string {
 return [header(project), ...STAGE_IDS.map(id=>section(project,id)), ...TOOL_IDS.filter(id=>project.modules[id].artifact||project.modules[id].proposal?.artifactDraft||project.modules[id].memory).map(id=>section(project,id)),facts(project),coreEvidence(project),calculations(project),prototype(project)].join('\n\n');
}
function prototype(project: Project): string {
 return `## Прототип\n\n${project.modules.mvp.artifact ? 'Описание готово' : project.modules.mvp.proposal?.artifactDraft||project.modules.mvp.memory ? 'Рабочее описание MVP — в контексте проекта' : 'Описание MVP ещё не подготовлено'} / ${isHttpUrl(project.prototypeUrl) ? `прототип указан: ${project.prototypeUrl}` : 'прототип не указан'}.`;
}
export function mvpToMarkdown(project: Project): string { return [header(project),section(project,'mvp'),prototype(project),facts(project),coreEvidence(project),calculations(project)].join('\n\n'); }

function sourceDescription(source: SourceRef): string {
 if (source.type === 'legacy') return `Унаследованное основание: ${source.label}. Цитата: «${source.quote}»`;
 if (source.type === 'external') return `Внешнее основание ${source.evidenceId}, версия ${source.version}, фрагмент ${source.quoteId}`;
 return `Реплика ${source.projectId}/${source.moduleId}, поколение ${source.generation}, ${source.messageId}, версия ${source.revision}. Цитата: «${source.quote}»`;
}
function coreEvidence(project: Project): string {
 const core = project.core;
 if (!core) return '';
 const current = getCurrentEntries(core);
 const acceptance = { accepted:'принято', proposed:'предложение', rejected:'отклонено', unresolved:'не решено' };
 const knowledge = { reported:'со слов источника', hypothesis:'гипотеза', observed:'наблюдение', calculated:'расчёт', unknown:'неизвестно' };
 const entries = core.entries.map(entry => `### ${entry.key} · версия ${entry.version} · ${current.some(ref => ref.id === entry.id && ref.version === entry.version) ? 'текущая' : 'история'}

${entry.text}

${acceptance[entry.acceptance]}; ${knowledge[entry.epistemic]}; происхождение: ${entry.origin}; вид: ${entry.kind}. Область: ${entry.scope.subject}/${entry.scope.area}/${entry.scope.stageId ?? 'весь проект'}/${entry.scope.scenario ?? 'без сценария'}/${entry.scope.entityId ?? 'наш проект'}. ID: ${entry.id}; предыдущая версия: ${entry.previousVersion ?? 'нет'}.

${entry.sources.map(source => `- ${sourceDescription(source)}`).join('\n')}

Зависимости: ${entry.dependsOn.map(ref => `${ref.id}@${ref.version}`).join(', ') || 'нет'}.`);
 const pages = core.evidence.map(source => `### ${source.title} · версия ${source.version}

${source.url}

Статус чтения: ${source.retrieval}; получено: ${source.retrievedAt}; опубликовано: ${source.publishedAt ?? 'неизвестно'}; действует с: ${source.effectiveAt ?? 'неизвестно'}. Проект ${source.projectId}; этап ${source.moduleId}; поколение ${source.generation}. Источник ${source.id}, запрос ${source.requestId}, операция ${source.operationId}, отпечаток ${source.contentHash}.

${source.quotes.map(quote => `> [${quote.id}] ${quote.text.replaceAll('\n','\n> ')} (позиции ${quote.start ?? '?'}–${quote.end ?? '?'})`).join('\n\n')}

Ограничения: ${source.limitations.join('; ') || 'не указаны'}.`);
 const claims = Object.values(project.modules).flatMap(module => module.messages.flatMap(message => (message.reply?.externalClaims ?? []).map(claim => `- ${claim.text} — ${claim.evidenceId}@${claim.version}, фрагмент ${claim.quoteId}${claim.price ? `. Цена: ${claim.price.amount} ${claim.price.currency} / ${claim.price.unit} / ${claim.price.period}; оплата: ${claim.price.paymentTerms}` : '. Цена не заявлена'}.`)));
 const research = Object.values(project.modules).flatMap(module => module.messages.filter(message => message.reply?.research).map(message => `- Запрос ${message.requestId ?? 'неизвестно'}: ${message.reply!.research!.status}; ограничения: ${message.reply!.research!.limitations.join('; ') || 'не указаны'}.`));
 const originals = core.sourceMessages.map(source => `### ${MODULES[source.moduleId].shortTitle}: ${source.role === 'user' ? 'пользователь' : 'AI'} · ${source.messageId} · версия ${source.revision}

Проект ${source.projectId}; поколение ${source.generation}; ${source.createdAt}.

${source.content}`);
 const dependencies = Object.entries(project.modules).flatMap(([id,module]) => module.artifact?.basedOn ? [`- ${MODULES[id as ModuleId].shortTitle}: версия памяти ${module.artifact.basedOn.memoryVersion}; записи ${module.artifact.basedOn.atoms.map(ref => `${ref.id}@${ref.version}`).join(', ')}; источники ${module.artifact.basedOn.evidence.map(ref => `${ref.id}@${ref.version}`).join(', ')}.`] : []);
 return ['## Реестр решений и история',...entries,'## Внешние свидетельства',...pages,'## Утверждения и условия цен',claims.join('\n') || 'Не зафиксированы.','## Состояние исследований',research.join('\n') || 'Исследования не зафиксированы.','## Точные исходные реплики',...originals,'## Зависимости сохранённых материалов',dependencies.join('\n') || 'Не зафиксированы.'].join('\n\n');
}
