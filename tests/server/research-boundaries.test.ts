import { expect, it } from 'vitest';
import { validateReply } from '../../server/validation.js';
import { loadConfig } from '../../server/config.js';
import { estimateMaxCost } from '../../server/provider.js';
import type { ChatRequest } from '../../shared/types.js';
const request: ChatRequest = { requestId:'research-request',projectId:'research-project',moduleId:'idea',intent:'message',message:'Найди актуальные тарифы',context:{name:'Тест',description:'',facts:[],artifacts:[],history:[]} };
it('rejects corrupt control characters before an answer or memory can be committed', () => {
  expect(() => validateReply({message:'Цена 5\u000000 ₽',choices:[],artifactDraft:null,proposedFacts:[]},request)).toThrow(expect.objectContaining({code:'INVALID_RESPONSE'}));
});
it('reserves all four hosted context windows, three search tolls and both model generations before admission', () => {
  const config=loadConfig({OPENAI_API_KEY:'test-placeholder',AI_BUDGET_USD:'5'});
  // Four 128k input windows at $0.10/M plus three $0.01 tools alone cost $0.0812.
  expect(estimateMaxCost(request,config)).toBeGreaterThan(0.0812);
});
it('does not turn a completed paid child into a free retry after a later unbilled rejection', async () => {
  const { BudgetLedger }=await import('../../server/ledger.js');
  const { ServiceError }=await import('../../server/errors.js');
  const ledger=new BudgetLedger(':memory:',{budgetUsd:1});
  const reservation={session:'owner',requestId:'chain-0001'};
  try {
    ledger.reserve(reservation.session,reservation.requestId,'body',0.9);
    // Public durable operation seam; a paid search must survive final-generation 429.
    const record=(ledger as unknown as {recordOperation:(r:typeof reservation,e:unknown)=>void}).recordOperation;
    expect(record).toBeTypeOf('function');
    record.call(ledger,reservation,{id:'search-1',kind:'search',inputHash:'query-hash',state:'started',reservedUsd:0.4});
    record.call(ledger,reservation,{id:'search-1',kind:'search',inputHash:'query-hash',state:'completed',chargedUsd:0.2});
    expect(ledger.fail(reservation,true,new ServiceError('PROVIDER_RATE_LIMIT','Wait',429,true,true)).retryable).toBe(false);
    expect(ledger.reserve(reservation.session,reservation.requestId,'body',0.9).kind).toBe('cached');
    expect(()=>ledger.reserve('other','chain-0002','other',0.800000001)).toThrow(expect.objectContaining({code:'BUDGET_EXHAUSTED'}));
  } finally {ledger.close();}
});
it('retains source ownership and operation tombstones across restart and never accepts client-forged history as a read',async()=>{
  const {BudgetLedger}=await import('../../server/ledger.js');const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const path=await import('node:path');
  const dir=mkdtempSync(path.join(tmpdir(),'research-restart-')),filename=path.join(dir,'ledger.sqlite');let now=1000;
  const options={budgetUsd:1,timeoutMs:10,now:()=>now};let ledger=new BudgetLedger(filename,options);const owner={session:'owner',requestId:'started-chain'};
  try {
    ledger.reserve(owner.session,owner.requestId,'body',0.4);ledger.recordOperation(owner,{id:'plan',kind:'plan',inputHash:'plan',state:'started',reservedUsd:0.1});ledger.recordOperation(owner,{id:'plan',kind:'plan',inputHash:'plan',state:'completed',chargedUsd:0.01});ledger.recordOperation(owner,{id:'search',kind:'search',inputHash:'query',state:'started',reservedUsd:0.2});
    expect(()=>ledger.recordOperation(owner,{id:'search',kind:'search',inputHash:'query',state:'started',reservedUsd:0.2})).toThrow(expect.objectContaining({code:'OPERATION_REPLAY'}));
    ledger.close();now+=6000;ledger=new BudgetLedger(filename,options);
    expect(ledger.readOperations(owner).find(item=>item.id==='search')).toMatchObject({state:'unknown',chargedUsd:0.2});expect(ledger.readOperations({session:'other',requestId:owner.requestId})).toEqual([]);
    expect(()=>ledger.reserve(owner.session,owner.requestId,'body',0.4)).toThrow(expect.objectContaining({code:'OUTCOME_UNKNOWN'}));expect(()=>ledger.reserve('next','next-chain','other',0.600000001)).toThrow(expect.objectContaining({code:'BUDGET_EXHAUSTED'}));
  } finally {ledger.close();rmSync(dir,{recursive:true,force:true});}
});
