import{createHash}from'node:crypto';
import{expect,it}from'vitest';
import fixture from'./fixtures/grounding/research13-month-abbreviation.json';
import{groundedQuantities}from'../../shared/coreValidation';
import{createEvidenceAliases}from'../../server/evidenceAliases';
import{validateReply}from'../../server/validation';
import type{ChatRequest,ExternalEvidence}from'../../shared/types';
it('accepts a complete unchanged first raw with actual /мес quote and в месяц claim, preserving known period and all claims',()=>{
 const request=fixture.request as unknown as ChatRequest,sources=fixture.catalogue as ExternalEvidence[],codec=createEvidenceAliases(sources,request),raw=fixture.attempts[0];expect(codec.metadata.sourceAliases).toEqual(fixture.sourceAliases);expect(createHash('sha256').update(raw.outputText).digest('hex')).toBe(raw.sha256);const value=codec.resolveReply(JSON.parse(raw.outputText));delete value.memoryOperations;value.proposedFacts=(value.proposedFacts as Record<string,unknown>[]).map(f=>Object.fromEntries(Object.entries(f).filter(([k,v])=>!(['sourceUrl','checkedAt'].includes(k)&&v===null))));
 const result=validateReply({...value,externalSources:sources},request,sources);expect(result.externalClaims).toEqual(value.externalClaims);expect(result.message).toBe(value.message);expect(result.artifactDraft).toEqual(value.artifactDraft);
 expect(result.externalClaims![1].price?.period).toBe('/мес');
});
it('recognizes exact Russian monthly abbreviations and Unicode word boundaries',()=>{
 for(const quote of ['1500 ₽/мес','1500 ₽ / мес.','1500 ₽/месяц','1500 ₽ в месяц'])expect(groundedQuantities('1500 ₽ в месяц',quote),quote).toBe(true);
 for(const quote of ['1500 ₽/месенджер','1500 ₽ в месяцамида','1500 ₽/monthIdentifier','1500 ₽/нетmonth','1500 ₽/year'])expect(groundedQuantities('1500 ₽ в месяц',quote),quote).toBe(false);
 expect(groundedQuantities('Негодовой тариф 1500 ₽','1500 ₽/мес')).toBe(true);
 for(const quote of ['Негодовой тариф 1500 ₽','Годовщина: 1500 ₽','1500 ₽/мес'])expect(groundedQuantities('Годовой тариф 1500 ₽',quote),quote).toBe(false);
 expect(groundedQuantities('Годовой тариф 1500 ₽','1500 ₽/год')).toBe(true);
});
it('keeps amount, currency, unit and source ownership guards unchanged',()=>{
 for(const text of ['2000 ₽ в месяц','1500 EUR в месяц','1500 ₽ за сотрудника в месяц','1500 ₽ в год'])expect(groundedQuantities(text,'1500 ₽ / мес.')).toBe(false);
 const request=fixture.request as unknown as ChatRequest,sources=fixture.catalogue as ExternalEvidence[],value=createEvidenceAliases(sources,request).resolveReply(JSON.parse(fixture.attempts[0].outputText));delete value.memoryOperations;value.proposedFacts=(value.proposedFacts as Record<string,unknown>[]).map(f=>Object.fromEntries(Object.entries(f).filter(([k,v])=>!(['sourceUrl','checkedAt'].includes(k)&&v===null))));
 expect(()=>validateReply({...value,externalSources:sources},request,sources.map(s=>({...s,projectId:'foreign-project'})))).toThrow();
});
