import type {ChatRequest,ExternalEvidence} from '../shared/types.js';
import {invalidResponse} from './errors.js';
import {projectCitationAliases}from'./citationAliases.js';
import {VALIDATED_REPLY_BYTES}from'../shared/transportLimits.js';

type RecordValue=Record<string,unknown>;
const record=(value:unknown):value is RecordValue=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const key=(id:string,version:number)=>JSON.stringify([id,version]);
const failure=(path:(string|number)[],rule:string)=>Object.assign(invalidResponse(),{validationIssue:{path,rule}});

/** Exact, request-local model protocol. This is not a trust or semantic validator. */
export function createEvidenceAliases(evidence:ExternalEvidence[],request?:ChatRequest) {
 const userSnapshots=request?[request.message,...(request.coreContext?request.coreContext.sourceMessages.filter(m=>m.projectId===request.projectId&&m.role==='user').map(m=>m.content):request.context.history.filter(m=>m.role==='user').map(m=>m.content))]:[];
 const actual=new Map<string,{alias:string;source:ExternalEvidence}>();
 const aliases=new Map<string,ExternalEvidence>();
 for(const source of evidence) {
  const identity=key(source.id,source.version),previous=actual.get(identity);
  if(previous) {
   if(JSON.stringify(previous.source)!==JSON.stringify(source))throw failure([],'alias_catalog_conflict');
   continue;
  }
  const alias=`source_${actual.size+1}`;
  // Own an immutable snapshot: another completion cannot mutate this catalogue.
  const snapshot=structuredClone(source);
  actual.set(identity,{alias,source:snapshot});aliases.set(alias,snapshot);
 }
 const modelId=(id:unknown,version:unknown)=>typeof id==='string'&&typeof version==='number'?actual.get(key(id,version))?.alias:undefined;
 const projectInput=(input:RecordValue):RecordValue=>{
  const copy=JSON.parse(JSON.stringify(input)) as RecordValue;
  const catalogue=(value:unknown)=>{
   if(!Array.isArray(value))return;
   for(const source of value)if(record(source)) {
    const alias=modelId(source.id,source.version);
    if(!alias)throw failure([],'alias_catalog_missing_source');
    const entry=actual.get(key(String(source.id),Number(source.version)))!;
    if(JSON.stringify(source)!==JSON.stringify(entry.source))throw failure([],'alias_catalog_conflict');
    source.id=alias;
   }
  };
  const projectRefs=(entries:unknown)=>{
   if(!Array.isArray(entries))return;
   for(const entry of entries)if(record(entry)&&Array.isArray(entry.sources))for(const source of entry.sources) {
    if(record(source)&&source.type==='external') {
     const alias=modelId(source.evidenceId,source.version);
     // Missing historical evidence stays visibly unbacked, never gains an alias/trust.
     if(alias)source.evidenceId=alias;
     else if(typeof source.evidenceId==='string'&&aliases.has(source.evidenceId))throw failure([],'alias_catalog_conflict');
    }
   }
  };
  if(record(copy.research))catalogue(copy.research.evidence);
  if(record(copy.coreContext)) {
   catalogue(copy.coreContext.evidence);
   for(const field of ['entries','currentEntries','historicalEntries'])projectRefs(copy.coreContext[field]);
  }
  return copy;
 };
 const resolveReply=(input:RecordValue):RecordValue=>{
  const copy=JSON.parse(JSON.stringify(input)) as RecordValue;
  const issues:Array<{path:(string|number)[];rule:string}>=[];
  const resolve=(ref:RecordValue,path:(string|number)[])=>{
   if(typeof ref.evidenceId!=='string')return; // Ordinary schema validation handles malformed shapes.
   const source=aliases.get(ref.evidenceId);
   if(!source){issues.push({path:[...path,'evidenceId'],rule:'unknown_source_alias'});return;}
   if(ref.version!==source.version){issues.push({path:[...path,'version'],rule:'source_alias_version_mismatch'});return;}
   ref.evidenceId=source.id;
   // Typed refs keep quoteId, versions, text, amounts and status untouched.
   // Only separate restricted Markdown citation destinations are projected below.
  };
  if(Array.isArray(copy.externalClaims))copy.externalClaims.forEach((claim,index)=>{if(record(claim))resolve(claim,['externalClaims',index]);});
  if(Array.isArray(copy.memoryOperations))copy.memoryOperations.forEach((operation,index)=>{
   if(!record(operation)||!record(operation.value)||!Array.isArray(operation.value.sources))return;
   operation.value.sources.forEach((source,sourceIndex)=>{if(record(source)&&source.type==='external')resolve(source,['memoryOperations',index,'value','sources',sourceIndex]);});
  });
  if(issues.length){const [first,...related]=issues;throw Object.assign(invalidResponse(),{validationIssue:{...first,...(related.length?{relatedIssues:related.slice(0,9)}:{})}});}
  let used=Buffer.byteLength(JSON.stringify(copy),'utf8');
  const citations=(text:string,path:(string|number)[])=>{
   const old=Buffer.byteLength(JSON.stringify(text),'utf8')-2;
   const projected=projectCitationAliases(text,alias=>aliases.get(alias)?.url,path,Math.max(0,VALIDATED_REPLY_BYTES-used+old),false,userSnapshots);
   used+=Buffer.byteLength(JSON.stringify(projected),'utf8')-2-old;return projected;
  };
  if(typeof copy.message==='string')copy.message=citations(copy.message,['message']);
  if(record(copy.artifactDraft)&&typeof copy.artifactDraft.body==='string')copy.artifactDraft.body=citations(copy.artifactDraft.body,['artifactDraft','body']);
  return copy;
 };
 return {
  projectInput,resolveReply,
  projectPreview:(text:string)=>projectCitationAliases(text,alias=>aliases.get(alias)?.url,['message'],VALIDATED_REPLY_BYTES,true,userSnapshots),
  metadata:{sourceAliasProtocol:1,citationAliasProtocol:1,sourceAliases:[...actual.values()].map(({alias,source})=>({alias,id:source.id,version:source.version}))},
 };
}

/** Upper-bound only positive JSON string expansion; trusted real IDs normally shrink. */
export function evidenceAliasExpansionUpperBound(request:ChatRequest):number {
 const core=request.coreContext;
 if(!core)return 0;
 // At most six new reader pages can join the known historical catalogue.
 const aliasLength=7+String(core.evidence.length+6).length;
 const extra=(id:string)=>Math.max(0,aliasLength-Buffer.byteLength(id,'utf8'));
 return core.evidence.reduce((sum,source)=>sum+extra(source.id),0)+core.entries.reduce((sum,entry)=>sum+entry.sources.reduce((n,source)=>n+(source.type==='external'?extra(source.evidenceId):0),0),0);
}
