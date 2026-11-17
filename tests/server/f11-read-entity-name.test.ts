import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import fixture from './fixtures/grounding/full03-d07-entity.json';
import {createEvidenceAliases} from '../../server/evidenceAliases';
import {validateReply} from '../../server/validation';
import type {AssistantReply,ChatRequest,ExternalEvidence} from '../../shared/types';
const request=fixture.request as ChatRequest,sources=fixture.sources as ExternalEvidence[];
function decoded(i:number){const raw=fixture.attempts[i];expect(createHash('sha256').update(raw.outputText).digest('hex')).toBe(raw.sha256);const codec=createEvidenceAliases(sources);expect(codec.metadata.sourceAliases).toEqual(raw.metadata.sourceAliases);const result=codec.resolveReply(JSON.parse(raw.outputText));delete result.memoryOperations;return result as unknown as AssistantReply;}
for(const index of [0,1])it(`accepts unchanged exact full D07 raw generation${index+1} when embedded entity digits are actual owned host metadata`,()=>{const raw=decoded(index);const result=validateReply(raw,request,sources);expect(result.externalClaims).toEqual(raw.externalClaims);expect(result.externalClaims).toHaveLength(4);expect(result.message).toBe(raw.message);});
it('keeps standalone numbers, unsupported prices, wrong brands, year assertions, unread and foreign source guards',()=>{
 for(const text of ['В описании Bitrix240 упомянуты учёт рабочего времени и графики.','В описании Bitrix24 упомянуты учёт рабочего времени и графики. Число сотрудников: 24.','В описании Bitrix24 указана цена 5000 RUB.','В описании Bitrix24 описан годовой тариф 2026 года.','Bitrix24: учёт рабочего времени.']){const raw=decoded(0);raw.externalClaims![3].text=text;expect(()=>validateReply(raw,request,sources)).toThrow();}
 const sourceId=decoded(0).externalClaims![3].evidenceId;
 for(const change of [{projectId:'foreign'},{retrieval:'search_snippet' as const}])expect(()=>validateReply(decoded(0),request,sources.map(s=>s.id===sourceId?{...s,...change}:s))).toThrow();
 const wrong=sources.map(s=>s.id===sourceId?{...s,url:'https://other.example/read',title:'Отчёт2026',quotes:s.quotes.map(q=>({...q,text:q.text.replace(/Битрикс24|Bitrix24/gi,'Другой сервис')}))}:s);expect(()=>validateReply(decoded(0),request,wrong)).toThrow();
});
