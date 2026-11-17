import { expect, it, vi } from 'vitest';
import { createPublicReader, pageReadFailure, publicAddress, PUBLIC_HTML_BYTES } from '../../server/publicReader.js';
it('classifies TLS and native timeout failures without exposing exception messages',()=>{
  for(const code of ['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','ERR_TLS_CERT_ALTNAME_INVALID']){
    const failure=pageReadFailure(Object.assign(new Error('private request details'),{code}));
    expect(failure.code).toBe(code);expect(failure.reason).toContain('TLS');
    expect(JSON.stringify(failure)).not.toContain('private');
  }
  const timeout=Object.assign(new Error('private timeout details',{cause:new DOMException('timed out','TimeoutError')}),{name:'AbortError',code:'ABORT_ERR'});
  expect(pageReadFailure(timeout)).toEqual({code:'PAGE_TIMEOUT',reason:'истекло время чтения'});
  expect(pageReadFailure(Object.assign(new Error('private cancellation'),{name:'AbortError',code:'ABORT_ERR'}))).toMatchObject({code:'ABORT_ERR'});
  expect(pageReadFailure(new Error('private unknown failure'))).toMatchObject({code:'PAGE_UNAVAILABLE'});
});
it('rejects every private/reserved DNS answer and validates redirects before any pinned request', async()=>{
  for(const address of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','198.18.1.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])expect(publicAddress(address)).toBe(false);
  const fetch=vi.fn().mockResolvedValue({status:302,headers:{location:'http://127.0.0.1/private'},body:''});
  const reader=createPublicReader({resolve:async()=>[{address:'93.184.216.34',family:4}],fetch});
  await expect(reader('https://example.com',new AbortController().signal)).rejects.toThrow('UNSAFE_ADDRESS');
  expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1]).toEqual({address:'93.184.216.34',family:4});
  const mixed=createPublicReader({resolve:async()=>[{address:'93.184.216.34',family:4},{address:'10.0.0.2',family:4}],fetch});
  await expect(mixed('https://example.com',new AbortController().signal)).rejects.toThrow('UNSAFE_ADDRESS');expect(fetch).toHaveBeenCalledTimes(1);
});
it('bounds body, redirects and extracted text; returns exact visible text, not scripts or private URLs',async()=>{
  const resolve=async()=>[{address:'93.184.216.34',family:4}];
  const fetch=vi.fn().mockResolvedValue({status:200,headers:{'content-type':'text/html'},body:'<title>Price &amp; terms</title><script>SECRET</script><p>5000 ₽ за месяц при оплате года</p><div>'+ 'x'.repeat(13_000)+'</div>'});
  const page=await createPublicReader({resolve,fetch})('https://example.com/pricing',new AbortController().signal);
  expect(page.title).toBe('Price & terms');expect(page.text).toContain('5000 ₽ за месяц при оплате года');expect(page.text).not.toContain('SECRET');expect(page.text.length).toBe(12_000);expect(page.limitations).toContain('Дата публикации не указана.');
  for(const url of ['https://user:secret@example.com/','file:///etc/passwd','http://example.com:8080/'])await expect(createPublicReader({resolve,fetch})(url,new AbortController().signal)).rejects.toThrow('UNSAFE_URL');
  fetch.mockResolvedValue({status:302,headers:{location:'/again'},body:''});fetch.mockClear();await expect(createPublicReader({resolve,fetch})('https://example.com',new AbortController().signal)).rejects.toThrow('REDIRECT_LIMIT');expect(fetch).toHaveBeenCalledTimes(4);
  fetch.mockResolvedValue({status:200,headers:{},body:'x'.repeat(PUBLIC_HTML_BYTES+1)});await expect(createPublicReader({resolve,fetch})('https://example.com',new AbortController().signal)).rejects.toThrow('PAGE_UNAVAILABLE');
});
it('accepts normal script-heavy HTML above 1MiB while keeping the model text and injected response body bounded',async()=>{
  const resolve=async()=>[{address:'93.184.216.34',family:4}];
  const fetch=vi.fn().mockResolvedValue({status:200,headers:{},body:'<title>Official pricing</title><script>'+ 'x'.repeat(1_300_000)+'</script><p>Visible tariff and its conditions</p>'});
  const reader=createPublicReader({resolve,fetch}),page=await reader('https://example.com/pricing',new AbortController().signal);
  expect(page.text).toContain('Visible tariff and its conditions');expect(page.text).not.toContain('xxx');expect(page.text.length).toBeLessThanOrEqual(12_000);
  fetch.mockResolvedValue({status:200,headers:{},body:'я'.repeat(PUBLIC_HTML_BYTES/2+1)});
  await expect(reader('https://example.com/pricing',new AbortController().signal)).rejects.toMatchObject({code:'PAGE_TOO_LARGE'});
});
it('enforces the same finite HTML bound on native content-length and chunked streams',async()=>{
  const http=await import('node:http');
  const server=http.default.createServer((request,response)=>{
    response.writeHead(200,{'Content-Type':'text/html',...(request.url==='/declared'?{'Content-Length':PUBLIC_HTML_BYTES+1}:{})});
    response.end(Buffer.alloc(PUBLIC_HTML_BYTES+1,'x'));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as {port:number}).port,originalGet=http.default.get;
  const spy=vi.spyOn(http.default,'get').mockImplementation(((url:URL,options:import('node:http').RequestOptions,callback:(response:import('node:http').IncomingMessage)=>void)=>originalGet(new URL(url.pathname,`http://127.0.0.1:${port}`),{...options,lookup:undefined},callback)) as typeof http.default.get);
  try{
    const reader=createPublicReader({resolve:async()=>[{address:'93.184.216.34',family:4}]});
    for(const suffix of ['declared','chunked'])await expect(reader(`http://example.com/${suffix}`,new AbortController().signal)).rejects.toMatchObject({code:'PAGE_TOO_LARGE'});
  }finally{spy.mockRestore();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it('closes a native redirect response before consuming its oversized body',async()=>{
  const http=await import('node:http');
  const server=http.default.createServer((request,response)=>{
    if(request.url==='/start'){response.writeHead(302,{Location:'/final','Content-Type':'text/plain','Content-Length':4*1_048_576});response.end(Buffer.alloc(4*1_048_576,'x'));}
    else{response.writeHead(200,{'Content-Type':'text/html'});response.end('<p>Readable final page</p>');}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as {port:number}).port,originalGet=http.default.get;
  let redirectBytes=0,closed!:()=>void;const redirectClosed=new Promise<void>(resolve=>{closed=resolve;});
  // Route only the fixture socket to localhost; exercise the real native reader and its response stream.
  const spy=vi.spyOn(http.default,'get').mockImplementation(((url:URL,options:import('node:http').RequestOptions,callback:(response:import('node:http').IncomingMessage)=>void)=>originalGet(new URL(url.pathname,`http://127.0.0.1:${port}`),{...options,lookup:undefined},incoming=>{
    if(incoming.statusCode===302){incoming.on('data',(chunk:Buffer)=>{redirectBytes+=chunk.length;});incoming.once('close',closed);}
    callback(incoming);
  })) as typeof http.default.get);
  try{
    const reader=createPublicReader({resolve:async()=>[{address:'93.184.216.34',family:4}]});
    const page=await reader('http://example.com/start',new AbortController().signal);await redirectClosed;
    expect(page.text).toContain('Readable final page');expect(redirectBytes).toBeLessThanOrEqual(1_048_576);
  }finally{spy.mockRestore();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
