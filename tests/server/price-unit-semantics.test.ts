import{readFileSync}from'node:fs';
import{expect,it}from'vitest';
import{validateReply}from'../../server/validation';
import{createEvidenceAliases}from'../../server/evidenceAliases';
import type{ChatRequest,ExternalEvidence,ExternalClaim}from'../../shared/types';
const fixture=JSON.parse(readFileSync('tests/server/fixtures/price-components/staffkit-invented-unit.json','utf8'))as{source:ExternalEvidence;claim:ExternalClaim};
const request:ChatRequest={requestId:fixture.source.requestId!,projectId:fixture.source.projectId,moduleId:'competitors',intent:'message',message:'Сравни тарифы',context:{name:'Проверка',description:'',facts:[],artifacts:[],history:[]}};
// Isolates the exact rejected field. This is not an assertion that a plan label
// literally present in a quote is a valid billing unit, nor evidence of prompt efficacy.
it('keeps the actual repaired invented plan-label unit rejected; an unknown unit preserves its supported free-plan claim',()=>{
 const aliases=createEvidenceAliases([fixture.source]);
 const claim=aliases.resolveReply({externalClaims:[{...fixture.claim,evidenceId:'source_1'}]}).externalClaims as ExternalClaim[];
 const reply={message:'Проверка фрагмента тарифа.',choices:[],artifactDraft:null,proposedFacts:[],externalSources:[fixture.source],externalClaims:claim};
 expect(()=>validateReply(reply,request,[fixture.source])).toThrowError(expect.objectContaining({validationIssue:{path:['externalClaims',0,'price','unit'],rule:'ungrounded_price_term'}}));
 const corrected={...reply,externalClaims:claim.map(c=>({...c,price:{...c.price!,unit:'unknown'}}))};
 const accepted=validateReply(corrected,request,[fixture.source]);expect(accepted.externalClaims).toHaveLength(1);expect(accepted.externalClaims![0].text).toBe(fixture.claim.text);expect(accepted.externalClaims![0].price).toMatchObject({amount:'0',unit:'unknown',period:'без ограничения срока',paymentTerms:'Банковская карта не нужна.'});
});
