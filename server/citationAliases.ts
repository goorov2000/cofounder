import {VALIDATED_REPLY_BYTES}from'../shared/transportLimits.js';
import {invalidResponse}from'./errors.js';
import {literalHistoryQuote}from'./historySources.js';
const failure=(path:(string|number)[],rule='invalid_citation_alias')=>Object.assign(invalidResponse(),{validationIssue:{path,rule}});
const escaped=(text:string,at:number)=>{let n=0;while(at>0&&text[--at]==='\\')n++;return n%2===1;};
// Code is data, not a citation destination. Unclosed fenced code remains code;
// an unmatched inline backtick does not hide an otherwise active Markdown link.
export function markdownCodeRanges(text:string):Array<[number,number]>{
 const ranges:Array<[number,number]>=[];const fences=/^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gm;let m:RegExpExecArray|null;
 while((m=fences.exec(text))){
  if(ranges.some(([a,b])=>m!.index>=a&&m!.index<b))continue;
  const closing=new RegExp('^ {0,3}'+m[1][0]+'{'+m[1].length+',}[ \\t]*(?:\\n|$)','gm');closing.lastIndex=fences.lastIndex;
  const end=closing.exec(text),stop=end?closing.lastIndex:text.length;ranges.push([m.index,stop]);fences.lastIndex=stop;
 }
 const ticks=/`+/g;
 while((m=ticks.exec(text))){
  if(escaped(text,m.index)||ranges.some(([a,b])=>m!.index>=a&&m!.index<b))continue;
  const run=m[0],closing=/`+/g;closing.lastIndex=ticks.lastIndex;let end:RegExpExecArray|null;
  while((end=closing.exec(text))){if(end[0]===run&&!ranges.some(([a,b])=>end!.index>=a&&end!.index<b)){ranges.push([m.index,closing.lastIndex]);ticks.lastIndex=closing.lastIndex;break;}}
 }
 return ranges;
}
/** Restricted inline citation protocol. No URL normalization or label rewriting. */
export function projectCitationAliases(text:string,resolve:(alias:string)=>string|undefined,path:(string|number)[],maxJsonBytes=VALIDATED_REPLY_BYTES,preview=false,userSnapshots:readonly string[]=[]):string{
 const ranges=markdownCodeRanges(text);
 for(const match of text.matchAll(/«([^«»\n]+)»|“([^“”\n]+)”|"([^"\n]+)"|^> ?([^\n]+)$/gmu)){
  const quote=match[1]??match[2]??match[3]??match[4];
  if(userSnapshots.some(source=>literalHistoryQuote(source,quote)))ranges.push([match.index!,match.index!+match[0].length]);
 }
 const inside=(at:number)=>ranges.some(([a,b])=>at>=a&&at<b);
 let stop=text.length;
 if(preview){
  // A quote cannot be classified as an exact user quotation until it closes.
  for(const [open,close]of [['«','»'],['“','”'],['"','"']]){
   let at=0;while(at<text.length){const start=text.indexOf(open,at);if(start<0)break;if(inside(start)||escaped(text,start)){at=start+1;continue;}const end=text.indexOf(close,start+1);if(end<0){stop=Math.min(stop,start);break;}at=end+1;}
  }
  const lastLine=text.lastIndexOf('\n')+1;if(/^> /u.test(text.slice(lastLine)))stop=Math.min(stop,lastLine);
  // Do not expose a relative source_N link while its destination is incomplete.
  // Hold any unfinished bracket expression until it can be classified safely.
  for(const tick of text.matchAll(/`+/g))if(!escaped(text,tick.index!)&&!inside(tick.index!))stop=Math.min(stop,tick.index!);
  const open=text.lastIndexOf('[');
  if(open>=0&&!escaped(text,open)&&!inside(open)){
   const close=text.indexOf(']',open),dest=close>=0&&text[close+1]==='('?text.indexOf(')',close+2):-1;
   if(close<0||close===text.length-1||(text[close+1]==='('&&dest<0))stop=Math.min(stop,open);
  }
 }
 const edits:Array<{start:number;end:number;url:string}>=[];const destinations=/\]\(([^)\n]*)(\)|$|\n)/g;let m:RegExpExecArray|null;
 while((m=destinations.exec(text))){
  if(m.index>=stop||inside(m.index)||escaped(text,m.index))continue;
  const raw=m[1];if(!/^\s*<?source_/iu.test(raw))continue;
  let start=text.lastIndexOf('[',m.index);while(start>=0&&escaped(text,start))start=text.lastIndexOf('[',start-1);if(start<0||inside(start))continue;
  // Only a simple, single-line, non-image label belongs to this protocol.
  if((start>0&&text[start-1]==='!')||/[\[\]\n]/u.test(text.slice(start+1,m.index)))throw failure(path);
  if(preview&&m[2]!==')')continue;
  if(m[2]!==')'||!/^source_[1-9]\d*$/u.test(raw))throw failure(path);
  const url=resolve(raw);if(!url)throw failure(path,'unknown_citation_alias');
  if(/[\s<>]/u.test(url))throw failure(path,'invalid_citation_catalog_url');
  edits.push({start:m.index+2,end:m.index+2+raw.length,url:`<${url}>`});
 }
 const chunks:string[]=[];let cursor=0,bytes=0;
 const add=(chunk:string)=>{bytes+=Buffer.byteLength(JSON.stringify(chunk),'utf8')-2;if(bytes>maxJsonBytes)throw failure(path,'citation_expansion_limit');chunks.push(chunk);};
 for(const edit of edits){if(edit.start>=stop)break;add(text.slice(cursor,edit.start));add(edit.url);cursor=edit.end;}
 add(text.slice(cursor,stop));return chunks.join('');
}
