import { expect, it, vi } from 'vitest';
import http from 'supertest';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { BudgetLedger } from '../../server/ledger';
import { ServiceError } from '../../server/errors';
import type { ChatRequest } from '../../shared/types';
it('F06 stops the local evaluation cap before reservation or paid calls and leaves the full budget available',async()=>{
 const config=loadConfig({OPENAI_API_KEY:'test-placeholder',AI_BUDGET_USD:'5',APP_ORIGIN:'http://localhost:3010'}),ledger=new BudgetLedger(':memory:',config);
 const reserve=vi.spyOn(ledger,'reserve'),complete=vi.fn(async()=>({reply:{message:'Готово',choices:[],artifactDraft:null,proposedFacts:[]},usage:{inputTokens:1,outputTokens:1}}));
 const admit=vi.fn(()=>{throw new ServiceError('EVALUATION_LIMIT','Evaluation stopped before spending',409,false,true);});
 const app=createApp({ledger,config,provider:{complete},admit});
 const request:ChatRequest={requestId:'eval-limit-stop',projectId:'eval-project-1',moduleId:'idea',intent:'message',message:'Помоги',context:{name:'Тест',description:'',facts:[],artifacts:[],history:[]}};
 try{
  const client=http.agent(app);await client.get('/api/status');const result=await client.post('/api/chat').set('Origin',config.origin).send(request);
  expect(result.status).toBe(409);expect(result.body.error).toMatchObject({code:'EVALUATION_LIMIT',retryable:false});expect(admit).toHaveBeenCalledTimes(1);expect(complete).not.toHaveBeenCalled();expect(reserve).not.toHaveBeenCalled();
  expect(ledger.readOperations({session:'another',requestId:request.requestId})).toHaveLength(0);
  expect(ledger.reserve('another','full-five-still-free','hash',5).kind).toBe('reserved');
 }finally{ledger.close();}
});
