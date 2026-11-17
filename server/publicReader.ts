import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';

export interface ProvenanceExcerpt { text:string; start:number; end:number }
// Offsets and contentHash refer to the same full normalized HTTP snapshot.
// text remains its bounded prefix; provenanceExcerpts contains at most one exact slice.
export interface ReadPage { normalizedLength?:number; provenanceExcerpts?:ProvenanceExcerpt[]; url: string; title: string; text: string; contentHash: string; publishedAt: string | null; effectiveAt: string | null; limitations: string[] }
export interface ReaderDependencies {
  resolve?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  fetch?: (url: URL, address: {address: string; family: number}, signal: AbortSignal) => Promise<{status: number; headers: http.IncomingHttpHeaders; body: string}>;
}
export type PageReader = (url: string, signal: AbortSignal) => Promise<ReadPage>;
export const PUBLIC_HTML_BYTES=4*1024*1024;
export const PUBLIC_READER_GUIDANCE='Сервер читает только публичные HTML-страницы и обычный текст. PDF, XLS/XLSX и другие вложения не поддерживаются: ищи HTML-публикацию автора или текстовую таблицу с нужными данными. Ошибка чтения, TLS или таймаут не доказывают отсутствие опубликованных данных. Если первая подборка целиком не прочитана, проверь другие доступные первичные страницы до завершения исследования; не переноси эту доступную проверку на следующий ход пользователя.';
export class PageReadError extends Error {
  constructor(public readonly code: string, public readonly httpStatus?: number) { super('PAGE_UNAVAILABLE'); }
}
/** Allowlisted diagnostics only: raw exception messages may contain private data. */
export function pageReadFailure(error: unknown): { code: string; httpStatus?: number; reason: string } {
  const codes: Record<string,string> = {
    PAGE_HTTP_STATUS: 'страница вернула ошибку HTTP', PAGE_TOO_LARGE: 'страница превышает предел чтения',
    PAGE_UNSUPPORTED_TYPE: 'неподдерживаемый формат страницы', PAGE_ENCODING: 'неподдерживаемое сжатие страницы',
    PAGE_TIMEOUT: 'истекло время чтения', EMPTY_PAGE: 'не удалось извлечь текст', REDIRECT_LIMIT: 'слишком много перенаправлений',
    UNSAFE_URL: 'адрес не прошёл проверку безопасности', UNSAFE_ADDRESS: 'сетевой адрес не прошёл проверку безопасности',
    ENOTFOUND: 'не удалось найти адрес сайта', EAI_AGAIN: 'временная ошибка определения адреса сайта',
    ECONNRESET: 'сайт прервал соединение', ECONNREFUSED: 'сайт отклонил соединение', ETIMEDOUT: 'истекло время соединения',
    ENETUNREACH: 'сеть сайта недоступна', EHOSTUNREACH: 'сервер сайта недоступен',
    ABORT_ERR: 'чтение страницы прервано',
    SELF_SIGNED_CERT_IN_CHAIN: 'не удалось проверить цепочку TLS-сертификатов сайта',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'сайт вернул самоподписанный TLS-сертификат',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'не удалось проверить подпись TLS-сертификата сайта',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'не найден доверенный издатель TLS-сертификата сайта',
    CERT_HAS_EXPIRED: 'срок TLS-сертификата сайта истёк',
    CERT_NOT_YET_VALID: 'TLS-сертификат сайта ещё не вступил в силу',
    ERR_TLS_CERT_ALTNAME_INVALID: 'TLS-сертификат не соответствует адресу сайта',
  };
  const value=error as {code?:unknown;message?:unknown;name?:unknown;cause?:{name?:unknown}}|null;
  const raw=error instanceof PageReadError?error.code:typeof value?.code==='string'?value.code:typeof value?.message==='string'?value.message:'';
  // Native HTTP wraps AbortSignal.timeout in AbortError/ABORT_ERR.
  const timedOut=value?.name==='TimeoutError'||value?.name==='AbortError'&&value.cause?.name==='TimeoutError';
  const code=timedOut?'PAGE_TIMEOUT':Object.hasOwn(codes,raw)?raw:'PAGE_UNAVAILABLE';
  const httpStatus=error instanceof PageReadError&&Number.isInteger(error.httpStatus)&&error.httpStatus!>=100&&error.httpStatus!<=599?error.httpStatus:undefined;
  return {code,...(httpStatus?{httpStatus}:{}),reason:httpStatus?`сервер ответил HTTP ${httpStatus}`:codes[code] ?? 'причину чтения установить не удалось'};
}
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) || (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && (b===168 || b===0 || (b===88 && c===99) || (b===2))) || (a===198 && (b===18 || b===19 || (b===51 && c===100))) || (a===203 && b===0 && c===113));
  }
  // Restrict IPv6 to globally routable unicast; reject mapped IPv4, local, multicast and special/documentation prefixes.
  if (isIP(address) === 6) {const prefix=parseInt(address.split(':')[0],16);return prefix>=0x2000 && prefix<=0x3fff && !/^(2001:|2002:|3fff:)/i.test(address);}
  return false;
}
function safeUrl(value: string): URL {
  const url=new URL(value);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || (url.port && url.port !== (url.protocol==='https:' ? '443':'80')) || url.hostname.endsWith('.') || /(^|\.)(localhost|local|internal|invalid|test)$/i.test(url.hostname)) throw new Error('UNSAFE_URL');
  url.hash=''; return url;
}
async function fetchPinned(url: URL, address: {address: string; family: number}, signal: AbortSignal): Promise<{status:number;headers:http.IncomingHttpHeaders;body:string}> {
  return new Promise((resolve,reject)=>{
    const transport=url.protocol==='https:' ? https:http;
    const request=transport.get(url,{signal,headers:{'User-Agent':'CoFounderResearch/1.0','Accept':'text/html,text/plain','Accept-Encoding':'identity'},lookup:((_hostname: string,options: {all?:boolean},callback: (error:Error|null,address:unknown,family?:number)=>void)=>options.all ? callback(null,[address]) : callback(null,address.address,address.family)) as never},response=>{
      const status=response.statusCode ?? 0;
      if (status>=300 && status<400) {response.destroy();resolve({status,headers:response.headers,body:''});return;}
      const failure=status!==200?new PageReadError('PAGE_HTTP_STATUS',status)
        :!/^(text\/html|text\/plain|application\/xhtml\+xml)(?:;|$)/i.test(String(response.headers['content-type'] ?? ''))?new PageReadError('PAGE_UNSUPPORTED_TYPE')
        :response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'?new PageReadError('PAGE_ENCODING')
        :Number(response.headers['content-length'] ?? 0)>PUBLIC_HTML_BYTES?new PageReadError('PAGE_TOO_LARGE'):null;
      if(failure){response.destroy();reject(failure);return;}
      const chunks:Buffer[]=[];let size=0;
      response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>PUBLIC_HTML_BYTES) {response.destroy(new PageReadError('PAGE_TOO_LARGE'));return;}chunks.push(chunk);});
      response.on('error',reject);response.on('end',()=>resolve({status,headers:response.headers,body:Buffer.concat(chunks).toString('utf8')}));
    });
    request.on('error',reject);
  });
}
function decode(text:string):string {
  const named:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_match,entity:string)=>{if(entity[0]!=='#')return named[entity.toLowerCase()] ?? '';const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);return n>0 && n<=0x10ffff?String.fromCodePoint(n):'';});
}
function provenanceExcerpt(all:string):ProvenanceExcerpt[] {
  // Explicit self-disclosures only. No domain/vendor inference and no inference
  // that a page without a disclosure is operator-owned or official.
  const patterns=[
    /(?:сайт[^.!?\n]{0,100}не\s+является[^.!?\n]{0,120}официальн|not\s+(?:an?\s+|the\s+)?official\s+(?:web)?site)/giu,
    /(?:мы\s*[—–:-]?\s*(?:являемся\s+)?(?:официальн[а-яё]*\s+)?(?:дилер|реселлер)|we\s+(?:are|act\s+as)\s+(?:(?:an?|the)\s+)?(?:official\s+|authorized\s+)?(?:dealer|reseller))/giu,
    /(?:партн[её]рск[а-яё]*\s+(?:соглашени|договор)|partner(?:ship)?\s+agreement)/giu,
  ];
  for(const pattern of patterns){
    const match=pattern.exec(all);if(!match)continue;
    const start=Math.max(0,match.index-100),end=Math.min(all.length,Math.max(start+500,match.index+match[0].length));
    // The longest finite disclosure pattern is shorter than the 500-char window.
    const boundedStart=Math.max(start,end-500),text=all.slice(boundedStart,end);
    if(text&&text.length<=500&&all.slice(boundedStart,end)===text)return [{text,start:boundedStart,end}];
  }
  return [];
}
export function extractPage(html:string,url:string):ReadPage {
  const title=decode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? new URL(url).hostname).replace(/<[^>]+>/g,'').slice(0,500);
  const all=decode(html.replace(/<!--([\s\S]*?)-->/g,' ').replace(/<(script|style|noscript|svg|iframe|template)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<\/(?:p|div|h[1-6]|li|tr|section)>|<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu,' ').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  const rawDate=html.match(/<meta\b[^>]*(?:property|name)=["'](?:article:published_time|datePublished)["'][^>]*content=["']([^"']+)/i)?.[1];
  const publishedAt=rawDate && Number.isFinite(Date.parse(rawDate))?new Date(rawDate).toISOString():null;
  const text=all.slice(0,12_000);
  const provenanceExcerpts=provenanceExcerpt(all);
  return {url,title,text,normalizedLength:all.length,provenanceExcerpts,contentHash:createHash('sha256').update(all).digest('hex'),publishedAt,effectiveAt:null,limitations:[...(all.length>text.length?[provenanceExcerpts.some(q=>q.end>text.length)?'Основной текст ограничен первыми 12000 символами; дополнительно прочитан один точный фрагмент заявления страницы о принадлежности или посредничестве за пределами этого начала. Остальные условия могут отсутствовать.':'Страница ограничена первыми 12000 символами; часть условий может отсутствовать.']:[]),...(!publishedAt?['Дата публикации не указана.']:[])]};
}
export function createPublicReader(dependencies:ReaderDependencies={}):PageReader {
  const resolve=dependencies.resolve ?? (hostname=>lookup(hostname,{all:true,verbatim:true}));
  const fetch=dependencies.fetch ?? fetchPinned;
  return async(value,signal)=>{
    const boundedSignal=AbortSignal.any([signal,AbortSignal.timeout(10_000)]);
    let url=safeUrl(value);
    for(let redirect=0;redirect<=3;redirect++) {
      boundedSignal.throwIfAborted();
      const hostname=url.hostname.replace(/^\[|\]$/g,'');
      const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await Promise.race([resolve(hostname),new Promise<never>((_,reject)=>boundedSignal.addEventListener('abort',()=>reject(new Error('PAGE_TIMEOUT')),{once:true}))]);
      if(!addresses.length || addresses.some(item=>!publicAddress(item.address)))throw new Error('UNSAFE_ADDRESS');
      const response=await fetch(url,addresses[0],boundedSignal);
      if(response.status>=300 && response.status<400) {if(redirect===3 || !response.headers.location)throw new Error('REDIRECT_LIMIT');url=safeUrl(new URL(response.headers.location,url).href);continue;}
      if(response.status!==200)throw new PageReadError('PAGE_HTTP_STATUS',response.status);
      if(Buffer.byteLength(response.body)>PUBLIC_HTML_BYTES)throw new PageReadError('PAGE_TOO_LARGE');
      const page=extractPage(response.body,url.href);if(!page.text)throw new Error('EMPTY_PAGE');return page;
    }
    throw new Error('REDIRECT_LIMIT');
  };
}
