import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createProject } from '../../shared/domain';
import { ensureCore } from '../../shared/coreMemory';
import { projectToMarkdown } from '../../shared/exports';
import { AnswerSources } from '../../src/features/workspace/AnswerSources';
import type { ExternalEvidence, Message } from '../../shared/types';

const evidence: ExternalEvidence = { id:'page-1', version:1, projectId:'p1', moduleId:'competitors', generation:1, requestId:'r1',operationId:'read-1',url:'https://example.org/pricing',title:'Тариф команды',retrievedAt:'2026-11-15T12:00:00Z',publishedAt:null,effectiveAt:'2026-01-01',retrieval:'read',contentHash:'hash',quotes:[{id:'q1',text:'12 USD за пользователя в месяц при годовой оплате.',start:0,end:55}],limitations:['Тариф не показывает фактический средний чек.'] };
const message: Message = { id:'a1',role:'assistant',createdAt:'2026-11-15T12:00:01Z',content:'Часть исследования готова.',reply:{message:'Часть исследования готова.',choices:[],artifactDraft:null,proposedFacts:[],research:{status:'partial',limitations:['Вторая страница недоступна.']},externalSources:[evidence],externalClaims:[{text:'Командный тариф',evidenceId:'page-1',version:1,quoteId:'q1',price:{amount:'12',currency:'USD',unit:'пользователь',period:'месяц',paymentTerms:'годовая оплата'}}]} };

describe('reviewable evidence outside model prose', () => {
 it('shows read provenance, exact quotation, dates and price conditions in the existing sources view', () => {
  render(<AnswerSources message={message}/>);
  expect(screen.queryByText(/Веб-поиск не использовался/)).not.toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Тариф команды'})).toHaveAttribute('href',evidence.url);
  expect(screen.getByText(evidence.quotes[0].text)).toBeInTheDocument();
  expect(screen.getByText(/Вторая страница недоступна/)).toBeInTheDocument();
  expect(screen.getByText(/Получено:.*2026-11-15/)).toBeInTheDocument();
  expect(screen.getByText(/Оплата: годовая оплата/)).toBeInTheDocument();
 });
 it('exports exact historical and current decisions with sources, evidence and claims without pretending a web search never happened', () => {
  const project=ensureCore(createProject()); project.core!.evidence=[{...evidence,projectId:project.id}];
  const base={id:'price',key:'price',kind:'decision' as const,scope:{subject:'our_project' as const,entityId:null,area:'project' as const,stageId:null,scenario:null},origin:'user' as const,epistemic:'hypothesis' as const,acceptance:'accepted' as const,sources:[{type:'legacy' as const,label:'Импорт',quote:'Принята гипотеза'}],dependsOn:[],createdAt:'2026-11-15',requestId:null};
  project.core!.entries=[{...base,text:'5000 ₽',version:1,previousVersion:null},{...base,text:'3500 ₽',version:2,previousVersion:1}];
  project.modules.competitors.messages=[message];
  const output=projectToMarkdown(project);
  expect(output).toContain('price · версия 1 · история'); expect(output).toContain('price · версия 2 · текущая');
  expect(output).toContain('5000 ₽'); expect(output).toContain('3500 ₽'); expect(output).toContain('Принята гипотеза');
  expect(output).toContain(evidence.quotes[0].text); expect(output).toContain(evidence.url); expect(output).toContain('годовая оплата');
  expect(output).not.toContain('автоматического веб-поиска нет');
 });
});
