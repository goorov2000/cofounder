import{createHash}from'node:crypto';
import{expect,it}from'vitest';
import fixture from'./fixtures/price-components/target13-non-numeric-free.json';
import{createEvidenceAliases}from'../../server/evidenceAliases';
import{validateReply}from'../../server/validation';
import type{AssistantReply,ChatRequest,ExternalEvidence}from'../../shared/types';
for(const [index,attempt]of fixture.attempts.entries())it(`keeps exact nonnumeric free amount rejected in actual attempt${index+1}; a nonprice free fact preserves all claims`,()=>{
 const request=fixture.request as unknown as ChatRequest,sources=fixture.catalogue as ExternalEvidence[],codec=createEvidenceAliases(sources,request);expect(codec.metadata.sourceAliases).toEqual(fixture.sourceAliases);expect(createHash('sha256').update(attempt.outputText).digest('hex')).toBe(attempt.sha256);
 const decoded=codec.resolveReply(JSON.parse(attempt.outputText));delete decoded.memoryOperations;const value={...decoded,externalSources:sources};
 expect(()=>validateReply(value,request,sources)).toThrow(expect.objectContaining({validationIssue:{path:['externalClaims',1,'price','amount'],rule:'non_numeric_price_amount'}}));
 const fixed=structuredClone(value)as unknown as AssistantReply;const original=structuredClone(fixed.externalClaims!);expect(original[1].price!.amount).toBe('БЕСПЛАТНО');fixed.externalClaims![1].price=null;
 const result=validateReply(fixed,request,sources);expect(result.externalClaims).toEqual(original.map((c,i)=>i===1?{...c,price:null}:c));expect(result.externalClaims).toHaveLength(original.length);expect(result.externalClaims![1].text).toBe(original[1].text);expect(result.message).toBe(decoded.message);expect(result.artifactDraft).toEqual(decoded.artifactDraft);
 const invented=structuredClone(fixed);invented.externalClaims![1].price={...original[1].price!,amount:'0'};expect(()=>validateReply(invented,request,sources)).toThrow(expect.objectContaining({validationIssue:expect.objectContaining({path:['externalClaims',1,'price','amount'],rule:'ungrounded_amount'})}));
});
