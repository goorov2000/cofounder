import { describe, expect, it } from 'vitest';
import { createProject } from '../../shared/domain';
import { projectToMarkdown, mvpToMarkdown } from '../../shared/exports';
describe('portable saved materials', () => {
 it('preserves complete MVP, provenance, sources and stale warnings', () => {
  const p=createProject(); p.name='Тест'; p.prototypeUrl='https://example.com/prototype';
  p.modules.mvp.artifact={title:'MVP',body:'Две недели\nОбмен после публикации\nTelegram mini-app',revision:1,savedAt:'2026-11-14',stale:true,staleReason:'Изменена аудитория'};
  p.facts.market={key:'market',value:'100',provenance:'verified',note:'Источник пользователя',sourceUrl:'https://example.com/source',checkedAt:'2026-11-14'};
  const md=mvpToMarkdown(p);
  for(const text of ['Две недели\nОбмен после публикации\nTelegram mini-app','https://example.com/prototype','Изменена аудитория','Проверено пользователем','https://example.com/source','2026-11-14']) expect(md).toContain(text);
  expect(projectToMarkdown(p)).toContain('Неизвестно');
 });
});
it('exports reproducible market and economics scenarios with sources, periods and unknowns',async()=>{
 const {calculateMarket,calculateEconomics}=await import('../../shared/calculations');
 const p=createProject();p.calculations={
  market:{...calculateMarket({totalBuyers:1000,reachableBuyers:200,targetBuyers:20,price:150,period:'месяц',pricePeriod:'месяц',currency:'₽',sources:{totalBuyers:'Опрос владельца от 14 ноября',price:'Прайс пользователя'}}),pricePeriod:'месяц'},
  economics:calculateEconomics({customers:20,price:150,variableCostPerCustomer:50,fixedCost:500,acquisitionCost:600,newCustomers:3,period:'месяц',currency:'₽'}),
 };
 for(const markdown of [projectToMarkdown(p),mvpToMarkdown(p)]){
  for(const content of ['Опрос владельца от 14 ноября','Прайс пользователя','1000','150000','TAM = все покупатели × цена = 1000 × 150','Период расчёта: месяц','Период цены: месяц','₽ / покупатель / месяц','Со слов пользователя','Гипотеза','Прибыль = маржинальный доход − постоянные затраты = 2000 − 500','1500','LTV','неизвестно','Нет данных об удержании.','Расчёт не подтверждает спрос'])expect(markdown).toContain(content);
 }
});


it('exports internal formulations and conversation context without a manual card, preserving uncertainty', () => {
 const p=createProject();
 p.modules.idea.proposal={message:'В целом понял.',choices:[],artifactDraft:{title:'Ремонт рядом',body:'Ремонт велосипедов на выезде. Готовность платить неизвестна.'},proposedFacts:[]};
 p.modules.mvp.memory={updatedAt:p.createdAt,needsRefresh:true,content:{facts:[{text:'Начинаем с записи на выезд.',evidence:'Начинаем с записи на выезд.'}],hypotheses:['Достаточно формы записи.'],openQuestions:['Как подтверждать время?']}};
 const before=structuredClone(p);
 const presentation=projectToMarkdown(p),mvp=mvpToMarkdown(p);
 expect(presentation).toContain(p.modules.idea.proposal.artifactDraft!.body);
 expect(presentation).toContain('Предложение не является подтверждённым фактом.');
 for(const text of ['Начинаем с записи на выезд.','Достаточно формы записи.','Как подтверждать время?','Контекст требует пересмотра.'])expect(mvp).toContain(text);
 expect(p).toEqual(before);expect(p.modules.idea.artifact).toBeNull();
});
