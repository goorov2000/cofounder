/** Offline diagnostic only: historical raw stays immutable and is never applied. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateReply } from '../../server/validation';
const archive=resolve(process.argv[2]??'.autopilot/2026-11-15-bot-core--wip/evidence/g4-first');
for(const dir of ['live','mock','ui','search-ui','b-ui']){
 const file=resolve(archive,dir,'failures.jsonl');if(!existsSync(file))continue;
 for(const line of readFileSync(file,'utf8').trim().split('\n').filter(Boolean)){
  const saved=JSON.parse(line),request=saved.request,reply=structuredClone(saved.raw);
  const operations=reply.memoryOperations??[];delete reply.memoryOperations;
  reply.proposedFacts=reply.proposedFacts.map((fact:Record<string,unknown>)=>Object.fromEntries(Object.entries(fact).filter(([key,value])=>!(['sourceUrl','checkedAt'].includes(key)&&value===null))));
  reply.memoryPatch={schemaVersion:1,projectId:request.projectId,moduleId:request.moduleId,generation:request.coreContext.generation,requestId:request.requestId,baseMemoryVersion:request.coreContext.revision,baseContextVersion:request.coreContext.contextVersion,sourceMessage:request.coreContext.sourceMessage,operations};
  if(saved.evidence?.length){reply.externalSources=saved.evidence;reply.research={status:'partial',limitations:[]};}
  let status='accepted';try{validateReply(reply,request,saved.evidence??[]);}catch{status='rejected';}
  console.info(JSON.stringify({directory:dir,id:saved.id,requestId:request.requestId,diagnosticReplay:status,claims:reply.externalClaims?.length??0,semanticStatus:'not_run',historicalOutcome:'unchanged'}));
 }
}
