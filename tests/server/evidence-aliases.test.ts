import{readFileSync}from'node:fs';
import{expect,it}from'vitest';
import{createEvidenceAliases,evidenceAliasExpansionUpperBound}from'../../server/evidenceAliases.js';
import{OpenAIProvider,usageCost,estimateMaxCost}from'../../server/provider.js';
import{validateReply}from'../../server/validation.js';
import{loadConfig}from'../../server/config.js';
import type{ChatRequest,ExternalEvidence}from'../../shared/types.js';
import type{OperationEvent}from'../../server/ledger.js';
const base=JSON.parse(readFileSync('tests/server/fixtures/grouped-price-own-price-02.json','utf8'));
const source=(id='web-actual-long-source-id-00001',version=1,amount='5000'):ExternalEvidence=>({projectId:base.request.projectId,moduleId:'competitors',generation:0,id,version,requestId:'historical-request',operationId:'read-1',url:'https://vendor.example/pricing',title:'Actual tariff',retrievedAt:'2026-10-01T00:00:00.000Z',publishedAt:null,effectiveAt:null,retrieval:'read',contentHash:'a'.repeat(64),quotes:[{id:'quote-1',text:`Plan ${amount} RUB per month`,start:0,end:25}],limitations:[]});
const claim=(id:string,version=1,amount='5000')=>({text:`Plan ${amount} RUB per month`,evidenceId:id,version,quoteId:'quote-1',price:{amount,currency:'RUB',unit:'unknown',period:'month',paymentTerms:'unknown'}});
const reply=(id:string,version=1,amount='5000')=>({message:`Ранее прочитан Plan ${amount} RUB per month.`,choices:[],artifactDraft:null,proposedFacts:[],memoryOperations:[],externalClaims:[claim(id,version,amount)]});
const request:ChatRequest=base.request;
const response=(value:unknown)=>({status:'completed',error:null,output:[],output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:50}}as never);
it('projects only source identity and structured external refs, preserving exact content and all versions',()=>{
 const actual=source(),codec=createEvidenceAliases([actual]);const input={research:{evidence:[actual]},coreContext:{evidence:[actual],currentEntries:[{id:'atom-actual',sources:[{type:'external',evidenceId:actual.id,version:1,quoteId:'quote-1'},{type:'message',messageId:actual.id}]}],historicalEntries:[]}};
 const before=JSON.stringify(input),model=codec.projectInput(input)as typeof input;
 expect(model.research.evidence[0]).toEqual({...actual,id:'source_1'});expect(model.coreContext.currentEntries[0].sources[0]).toMatchObject({evidenceId:'source_1',quoteId:'quote-1',version:1});expect(model.coreContext.currentEntries[0].id).toBe('atom-actual');expect(model.coreContext.currentEntries[0].sources[1]).toEqual({type:'message',messageId:actual.id});expect(JSON.stringify(input)).toBe(before);
 expect(codec.resolveReply(reply('source_1')).externalClaims).toEqual([claim(actual.id)]);
});
it('rejects unknown aliases, actual IDs in the alias field and wrong versions without fuzzy correction',()=>{
 const actual=source(),codec=createEvidenceAliases([actual]);
 for(const id of ['source_2','source_01',actual.id,actual.id.slice(0,-1)])expect(()=>codec.resolveReply(reply(id))).toThrow(expect.objectContaining({validationIssue:{path:['externalClaims',0,'evidenceId'],rule:'unknown_source_alias'}}));
 expect(()=>codec.resolveReply(reply('source_1',2))).toThrow(expect.objectContaining({validationIssue:{path:['externalClaims',0,'version'],rule:'source_alias_version_mismatch'}}));
});
it('collects safe alias issues across claims and memory refs but never repairs quote IDs or content',()=>{
 const actual=source(),codec=createEvidenceAliases([actual]);const raw={...reply('source_99'),memoryOperations:[{value:{sources:[{type:'external',evidenceId:'source_1',version:2,quoteId:'quote-1'}]}}]};
 expect(()=>codec.resolveReply(raw)).toThrow(expect.objectContaining({validationIssue:{path:['externalClaims',0,'evidenceId'],rule:'unknown_source_alias',relatedIssues:[{path:['memoryOperations',0,'value','sources',0,'version'],rule:'source_alias_version_mismatch'}]}}));
 const wrongQuote=reply('source_1');wrongQuote.externalClaims[0].quoteId='quote-9';const decoded=codec.resolveReply(wrongQuote);expect((decoded.externalClaims as typeof wrongQuote.externalClaims)[0].quoteId).toBe('quote-9');expect(()=>validateReply(decoded,request,[actual])).toThrow();
 const wrongNumber=reply('source_1',1,'7000');expect(()=>validateReply(codec.resolveReply(wrongNumber),request,[actual])).toThrow();
});
it('deduplicates identical catalog entries but rejects conflicting identities and altered projection catalogues',()=>{
 const actual=source();const codec=createEvidenceAliases([actual,structuredClone(actual)]);expect(codec.metadata.sourceAliases).toHaveLength(1);
 expect(()=>createEvidenceAliases([actual,{...actual,title:'Different'}])).toThrow(expect.objectContaining({validationIssue:{path:[],rule:'alias_catalog_conflict'}}));
 expect(()=>codec.projectInput({research:{evidence:[{...actual,title:'Forged'}]}})).toThrow(expect.objectContaining({validationIssue:{path:[],rule:'alias_catalog_conflict'}}));
});
it('keeps maps request-local and rejects reserved namespace collisions in untrusted historical refs',()=>{
 const first=source(),second=source('web-other-project-source',2),a=createEvidenceAliases([first]),b=createEvidenceAliases([second]);
 expect((a.resolveReply(reply('source_1')).externalClaims as ReturnType<typeof claim>[])[0].evidenceId).toBe(first.id);
 expect((b.resolveReply(reply('source_1',2)).externalClaims as ReturnType<typeof claim>[])[0].evidenceId).toBe(second.id);
 expect(()=>b.resolveReply(reply('source_1',1))).toThrow();
 expect(()=>a.projectInput({coreContext:{evidence:[first],entries:[{sources:[{type:'external',evidenceId:'source_1',version:1,quoteId:'quote-1'}]}]}})).toThrow(expect.objectContaining({validationIssue:{path:[],rule:'alias_catalog_conflict'}}));
 const model=a.projectInput({coreContext:{evidence:[first],entries:[{sources:[{type:'external',evidenceId:'web-untrusted-original',version:1,quoteId:'quote-1'}]}]}});
 expect(JSON.stringify(model)).toContain('web-untrusted-original');expect(()=>a.resolveReply(reply('web-untrusted-original'))).toThrow();
});
it('preserves historical versions and dates through one alias repair, SSE reset and canonical final refs',async()=>{
 const old=source('web-historical-same-identity',1,'4000'),current=source(old.id,2,'5000'),req=structuredClone(request),core=req.coreContext!;
 const atom=(version:number,amount:string)=>({...core.entries[0],id:'external-history-atom',version,previousVersion:version===1?null:1,key:'external_tariff',scope:{subject:'external_entity' as const,entityId:'vendor',area:'project' as const,stageId:null,scenario:null},text:`Plan ${amount} RUB per month`,origin:'external' as const,epistemic:'observed' as const,acceptance:'proposed' as const,sources:[{type:'external' as const,evidenceId:old.id,version,quoteId:'quote-1'}]});
 core.entries.push(atom(1,'4000'),atom(2,'5000'));core.currentEntryRefs.push({id:'external-history-atom',version:2});core.evidence=[old,current];
 const before=JSON.stringify(req),events:OperationEvent[]=[],previews:string[]=[],resets:number[]=[],sent:Array<{input:string;instructions:string;text:unknown;max_output_tokens:number}>=[];let calls=0;
 const config=loadConfig({OPENAI_API_KEY:'test-placeholder'});
 const provider=new OpenAIProvider(config,{transport:async(params,_signal,onText)=>{calls++;if(calls===1)return response({action:'answer',query:''});sent.push(params as never);const input=JSON.parse(String(params.input)),context=(calls===2?input:input.originalInput).coreContext;expect(context.currentEntries.find((e:{id:string})=>e.id==='external-history-atom').sources[0].evidenceId).toBe('source_2');expect(context.historicalEntries.find((e:{id:string})=>e.id==='external-history-atom').sources[0].evidenceId).toBe('source_1');const value=reply(calls===2?'source_999':'source_1',1,'4000');onText?.(value.message);return response(value);}});
 const result=await provider.complete(req,new AbortController().signal,text=>previews.push(text),{trustedEvidence:[old,current],onTextReset:()=>resets.push(previews.length),onOperation:e=>events.push(e)});
 expect(calls).toBe(3);expect(resets).toEqual([1]);expect(result.reply.externalClaims).toEqual([claim(old.id,1,'4000')]);expect(result.reply.externalSources).toEqual([old]);expect(result.reply.externalSources?.[0].retrievedAt).toBe('2026-10-01T00:00:00.000Z');expect(JSON.stringify(req)).toBe(before);
 const paid=events.filter(e=>e.kind==='generate'&&e.state==='completed');expect(paid[0].metadata).toMatchObject({validation:'failed',validationIssue:{rule:'unknown_source_alias'},sourceAliasProtocol:1});expect(paid[1].metadata).toMatchObject({validation:'passed',sourceAliases:[{alias:'source_1',id:old.id,version:1},{alias:'source_2',id:old.id,version:2}]});
 for(const[id,params]of sent.entries()){const bytes=Buffer.byteLength(params.instructions+params.input+JSON.stringify(params.text),'utf8');const reserve=events.find(e=>e.id===(id===0?'generate':'generate-repair')&&e.state==='started')!.reservedUsd!;expect(reserve).toBeGreaterThan(usageCost({inputTokens:bytes,outputTokens:params.max_output_tokens},config));}
 expect(result.costUsd).toBeLessThan(estimateMaxCost(req,config));
});
it('bounds positive expansion for short injected IDs as well as shrinking real server IDs',()=>{
 const req=structuredClone(request),tiny=source('x');req.coreContext!.evidence=[tiny];req.coreContext!.entries[0].sources=[{type:'external',evidenceId:'x',version:1,quoteId:'quote-1'}];const input={coreContext:{evidence:[tiny],entries:req.coreContext!.entries}},codec=createEvidenceAliases([tiny]);expect(Buffer.byteLength(JSON.stringify(codec.projectInput(input)))-Buffer.byteLength(JSON.stringify(input))).toBeLessThanOrEqual(evidenceAliasExpansionUpperBound(req));
 const actual=source(),realInput={research:{evidence:[actual]}};expect(Buffer.byteLength(JSON.stringify(createEvidenceAliases([actual]).projectInput(realInput)))).toBeLessThan(Buffer.byteLength(JSON.stringify(realInput)));
});
