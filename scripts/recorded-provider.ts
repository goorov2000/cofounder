/** Diagnostic wrapper for synthetic acceptance runs. Calls still use the normal paid provider. */
import { OpenAIProvider, type Provider, type ResponseTransport } from '../server/provider';
import type { ServerConfig } from '../server/config';
import { ServiceError } from '../server/errors';
import { createResponseTransport } from '../server/responseTransport';

type Recorder = (name:string,value:unknown)=>void;
export function createRecordedProvider(config:ServerConfig,record:Recorder,transport?:ResponseTransport):Provider {
 return {async complete(request,signal,onText,execution){
  // Per-request closure prevents a concurrent request from taking another log identity.
  const identity={requestId:request.requestId,projectId:request.projectId,moduleId:request.moduleId};
  const send=transport??createResponseTransport(config,trace=>record('stream-trace',{...identity,...trace}));
  const provider=new OpenAIProvider(config,{transport:async(params,bounded,text)=>{
   const response=await send(params,bounded,text);
   const step=params.text?.format?.type==='json_schema'?params.text.format.name:params.tools?'search':'unknown';
   record('model-output',{...identity,step,status:response.status,incompleteDetails:response.incomplete_details,errorCode:response.error?.code,usage:response.usage,outputText:response.output_text,output:(response.output??[]).filter(item=>item.type!=='reasoning')});
   return response;
  }});
  try{return await provider.complete(request,signal,onText,{...execution,onOperation(event){execution?.onOperation?.(event);record('operations',{...identity,event});}});}
  catch(error){record('provider-failure',{...identity,code:error instanceof ServiceError?error.code:'UNKNOWN'});throw error;}
 }};
}
