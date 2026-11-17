import {expect,it} from 'vitest';
import fixtures from './fixtures/grounding/control-final-02-k05-history.json';
import {validateReply} from '../../server/validation';
function run(f:typeof fixtures[number]){
 const request=f.request as never,raw=structuredClone(f.raw) as Record<string,any>,core=f.request.coreContext;
 const operations=raw.memoryOperations;delete raw.memoryOperations;
 raw.proposedFacts=raw.proposedFacts.map((x:any)=>Object.fromEntries(Object.entries(x).filter(([k,v])=>!(['sourceUrl','checkedAt'].includes(k)&&v===null))));
 raw.memoryPatch={schemaVersion:1,projectId:f.request.projectId,moduleId:f.request.moduleId,generation:core.generation,requestId:f.requestId,baseMemoryVersion:core.revision,baseContextVersion:core.contextVersion,sourceMessage:core.sourceMessage,operations};
 const evidence=core.evidence.filter(e=>raw.externalClaims.some((c:any)=>c.evidenceId===e.id&&c.version===e.version));raw.externalSources=evidence;
 return {raw,check:()=>validateReply(raw,request,evidence as never)};
}
for(const f of fixtures)it(`accepts unchanged actual ${f.generation} K05 historical date as exact metadata`,()=>{const {raw,check}=run(f);expect(check().externalClaims).toEqual(raw.externalClaims);});
it('does not exempt a wrong Russian metadata date, an unlabelled price, or a made-up effective date',()=>{
 for(const changed of ['14 ноября 2026 года','15 ноября 2025 года','31 февраля 2026 года']){
  const f=structuredClone(fixtures[0]);f.raw.externalClaims[0].text=f.raw.externalClaims[0].text.replace('15 ноября 2026 года',changed);expect(run(f).check).toThrow();
 }
 const f=structuredClone(fixtures[0]);f.raw.externalClaims[0].text+=' Действует с 15 ноября 2026 года.';expect(run(f).check).toThrow();
 const price=structuredClone(fixtures[0]);price.raw.externalClaims[0].text+=' Цена 15 RUB.';expect(run(price).check).toThrow();
});

it('accepts the exact numeric Russian retrieval date but rejects a wrong day and effective-date reuse',()=>{
 const correct=structuredClone(fixtures[0]);correct.raw.externalClaims[0].text=correct.raw.externalClaims[0].text.replace('15 ноября 2026 года','15.11.2026');
 expect(run(correct).check).not.toThrow();
 const wrong=structuredClone(correct);wrong.raw.externalClaims[0].text=wrong.raw.externalClaims[0].text.replace('15.11.2026','14.11.2026');expect(run(wrong).check).toThrow();
 const effective=structuredClone(correct);effective.raw.externalClaims[0].text+=' Действует с 15.11.2026.';expect(run(effective).check).toThrow();
});

it('recognizes a zero-padded Russian day only when it exactly formats the trusted date',async()=>{
 const {stripGroundedReadDates}=await import('../../shared/coreValidation');
 expect(stripGroundedReadDates('Страница прочитана 01 ноября 2026 года.',new Set(['2026-11-01']))).toBe('Страница .');
 expect(stripGroundedReadDates('Страница прочитана 02 ноября 2026 года.',new Set(['2026-11-01']))).toBeNull();
});
