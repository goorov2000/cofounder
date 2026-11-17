import OpenAI from 'openai';
import type { ServerConfig } from './config.js';
import type { ResponseTransport } from './provider.js';
import { invalidResponse, ServiceError } from './errors.js';
import { streamingMessageState } from './streamingMessage.js';
import { MODEL_OUTPUT_BYTES } from '../shared/transportLimits.js';

export interface StreamTrace {
  responseId:string|null; step:string; terminal:boolean; outputBytes:number;
  eventTypes:Record<string,number>; previewStopped:boolean; partialOutput?:string; partialTruncated?:boolean;
}
/** The diagnostic recorder and ordinary server use the same stream boundary. */
export function createResponseTransport(config:ServerConfig,onTrace?:(trace:StreamTrace)=>void,responses?:Pick<OpenAI['responses'],'create'>):ResponseTransport {
 const api=responses??new OpenAI({apiKey:config.apiKey,baseURL:'https://api.openai.com/v1',maxRetries:0,logLevel:'off',timeout:config.timeoutMs}).responses;
 return async(params,signal,onText,onMessageComplete)=>{
  if(!onText)return api.create({...params,stream:false},{signal});
  const stream=await api.create({...params,stream:true},{signal});
  let response:OpenAI.Responses.Response|undefined,responseId:string|null=null,json='',preview='',previewStopped=false,messageCompleted=false;
  const eventTypes:Record<string,number>={};
  try {
   for await(const event of stream){
    eventTypes[event.type]=(eventTypes[event.type]??0)+1;
    if('response' in event&&event.response?.id)responseId=event.response.id;
    if(event.type==='response.output_text.delta'){
     json+=event.delta;if(Buffer.byteLength(json)>MODEL_OUTPUT_BYTES)throw invalidResponse();
     if(previewStopped)continue;
     let state:ReturnType<typeof streamingMessageState>;
     try{state=streamingMessageState(json);}catch{previewStopped=true;continue;}
     const next=state.text;
     if(!next.startsWith(preview)||/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(next)){previewStopped=true;continue;}
     if(next.length>preview.length)onText(next.slice(preview.length));preview=next;
     if(state.complete&&!messageCompleted){messageCompleted=true;onMessageComplete?.();}
    }else if(event.type==='response.completed'||event.type==='response.incomplete'||event.type==='response.failed'){
     response={...event.response,output_text:event.response.output.flatMap(item=>item.type==='message'?item.content.flatMap(part=>part.type==='output_text'?[part.text]:[]):[]).join('')};
    }else if(event.type==='error')throw new ServiceError('PROVIDER_ERROR','AI не завершил ответ. Автоматического повтора нет.',502);
   }
   if(!response)throw new ServiceError('PROVIDER_NETWORK','Поток завершился без подтверждённого исхода. Повторная оплата не запускается.',502);
   return response;
  }finally{
   const bytes=Buffer.byteLength(json),format=params.text?.format;
   onTrace?.({responseId,step:format?.type==='json_schema'?format.name:'unknown',terminal:Boolean(response),outputBytes:bytes,eventTypes,previewStopped,...(!response?{partialOutput:Buffer.from(json).subarray(0,MODEL_OUTPUT_BYTES).toString('utf8'),partialTruncated:bytes>MODEL_OUTPUT_BYTES}:{})});
  }
 };
}
