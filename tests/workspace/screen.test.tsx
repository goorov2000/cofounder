import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, it, expect } from 'vitest';
import { WorkspaceScreen } from '../../src/features/workspace';
import { WorkspaceProvider } from '../../src/state';
import { createProject } from '../../shared/domain';
import { serializeWorkspace } from '../../shared/validation';
import { sendChat, getStatus } from '../../src/lib/api';
vi.mock('../../src/lib/api', async () => ({ ...await vi.importActual('../../src/lib/api'), getStatus: vi.fn(), sendChat: vi.fn() }));
function mount() { const p=createProject(); const storage={getItem:()=>serializeWorkspace({version:1,activeProjectId:p.id,projects:[p]}),setItem:vi.fn()}; render(<WorkspaceProvider storage={storage}><WorkspaceScreen onOpenModule={vi.fn()}/></WorkspaceProvider>); }
it('keeps the local draft available offline without a result card or save requirement', async()=>{
 vi.mocked(sendChat).mockReset();
 vi.mocked(getStatus).mockResolvedValue({configured:false,reason:'Ключ не настроен',model:'',searchEnabled:false}); mount();
 expect(await screen.findByText(/AI пока не подключён/)).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Сообщение'),{target:{value:'Моя идея'}});
 expect(screen.getByLabelText('Сообщение')).toHaveValue('Моя идея');
 fireEvent.click(screen.getByRole('button',{name:'Как работать'}));
 expect(within(screen.getByRole('dialog')).getByText(/уже открытыми темами/)).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Сохранить итог'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Открыть материал этапа'})).not.toBeInTheDocument();
 expect(sendChat).not.toHaveBeenCalled();
});
it('does not pay again for the same text after an unknown AI outcome', async()=>{
 vi.mocked(getStatus).mockResolvedValue({configured:true,reason:'',model:'test',searchEnabled:false});
 const {ApiRequestError}=await import('../../src/lib/api'); vi.mocked(sendChat).mockReset().mockRejectedValue(new ApiRequestError('AI_TIMEOUT','Результат неизвестен',false)); mount();
 await screen.findByText(/AI подключён/); fireEvent.change(screen.getByLabelText('Сообщение'),{target:{value:'Новая идея'}});fireEvent.click(screen.getByRole('button',{name:'Отправить'}));
 await screen.findByText(/Повторная оплата не запускается/);expect(screen.getByLabelText('Сообщение')).toHaveValue('');fireEvent.change(screen.getByLabelText('Сообщение'),{target:{value:'Новая идея'}});fireEvent.click(screen.getByRole('button',{name:'Отправить'}));
 await waitFor(()=>expect(sendChat).toHaveBeenCalledTimes(1));
});
it('offers same-id manual retry after reloading a network failure without duplicating history',async()=>{
 const p=createProject(); const request={requestId:'saved-request',projectId:p.id,moduleId:'idea' as const,intent:'message' as const,message:'Идея после сбоя',context:{name:p.name,description:p.description,facts:[],artifacts:[],history:[]}};
 p.modules.idea.draft=request.message;
 p.modules.idea.messages=[{id:'original',role:'user',content:request.message,createdAt:new Date().toISOString(),status:'failed',requestId:request.requestId,request,requestError:'NETWORK_ERROR'} as any];
 vi.mocked(getStatus).mockResolvedValue({configured:true,reason:'',model:'test',searchEnabled:false});
 vi.mocked(sendChat).mockReset().mockResolvedValue({requestId:request.requestId,model:'test',reply:{message:'Восстановленный ответ',choices:[],artifactDraft:null,proposedFacts:[]}});
 const storage={getItem:()=>serializeWorkspace({version:1,activeProjectId:p.id,projects:[p]}),setItem:vi.fn()};render(<WorkspaceProvider storage={storage}><WorkspaceScreen onOpenModule={vi.fn()}/></WorkspaceProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Повторить тот же запрос'}));await screen.findByText('Восстановленный ответ');expect(sendChat).toHaveBeenCalledWith(request,expect.any(AbortSignal),expect.any(Function),expect.any(Function),expect.any(Function));expect(document.querySelector('.workspace-message.user')).toHaveTextContent(request.message);expect(screen.getByLabelText('Сообщение')).toHaveValue(request.message);
});
it('marks saved numerical material for review when calculator assumptions change',async()=>{
 const {saveArtifact}=await import('../../shared/domain');let p=saveArtifact(createProject(),'market',{title:'Рынок',body:'## TAM / SAM / SOM\n100 покупателей, гипотеза'});p.activeModule='market';
 vi.mocked(getStatus).mockResolvedValue({configured:false,reason:'Ключ не настроен',model:'',searchEnabled:false});const storage={getItem:()=>serializeWorkspace({version:1,activeProjectId:p.id,projects:[p]}),setItem:vi.fn()};render(<WorkspaceProvider storage={storage}><WorkspaceScreen onOpenModule={vi.fn()}/></WorkspaceProvider>);
 fireEvent.click(screen.getByRole('button',{name:/^Расчёт/}));fireEvent.change(screen.getByLabelText('Потенциальные покупатели'),{target:{value:'200'}});fireEvent.click(screen.getByRole('button',{name:'Закрыть'}));expect(await screen.findByText('Контекст изменился')).toBeInTheDocument();
});
it('consumes the current question choices when a free answer fails to reach the server',async()=>{
 const p=createProject();p.modules.idea.messages=[{id:'question',role:'assistant',content:'Кто платит?',createdAt:new Date().toISOString(),choices:[{id:'buyer',label:'Компания',description:'Оплата организацией'}]}];
 const {ApiRequestError}=await import('../../src/lib/api');vi.mocked(sendChat).mockReset().mockRejectedValue(new ApiRequestError('NETWORK_ERROR','Нет связи',true));vi.mocked(getStatus).mockResolvedValue({configured:true,reason:'',model:'test',searchEnabled:false});const storage={getItem:()=>serializeWorkspace({version:1,activeProjectId:p.id,projects:[p]}),setItem:vi.fn()};render(<WorkspaceProvider storage={storage}><WorkspaceScreen onOpenModule={vi.fn()}/></WorkspaceProvider>);
 await screen.findByText(/AI подключён/);fireEvent.change(screen.getByLabelText('Сообщение'),{target:{value:'Платит директор'}});fireEvent.click(screen.getByRole('button',{name:'Отправить'}));await screen.findByRole('button',{name:'Повторить тот же запрос'});expect(screen.queryByRole('button',{name:/Компания/})).not.toBeInTheDocument();
});
it('does not create another paid operation after PROVIDER_NETWORK, including after reload',async()=>{
 const {ApiRequestError}=await import('../../src/lib/api');
 vi.mocked(getStatus).mockResolvedValue({configured:true,reason:'',model:'test',searchEnabled:false});
 vi.mocked(sendChat).mockReset().mockRejectedValue(new ApiRequestError('PROVIDER_NETWORK','Связь с AI прервана',false));
 const p=createProject();let raw=serializeWorkspace({version:1,activeProjectId:p.id,projects:[p]});
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (_name:unknown,_options:unknown,fn:()=>unknown)=>fn()}});
 const storage={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;}};
 const mountScreen=()=>render(<WorkspaceProvider storage={storage}><WorkspaceScreen onOpenModule={vi.fn()}/></WorkspaceProvider>);
 const view=mountScreen();await screen.findByText(/AI подключён/);
 fireEvent.change(screen.getByLabelText('Сообщение'),{target:{value:'Новая идея после разрыва'}});fireEvent.click(screen.getByRole('button',{name:'Отправить'}));
 await screen.findByText(/Связь с AI прервана/);expect(screen.getByLabelText('Сообщение')).toHaveValue('');fireEvent.change(screen.getByLabelText('Сообщение'),{target:{value:'Новая идея после разрыва'}});fireEvent.click(screen.getByRole('button',{name:'Отправить'}));
 expect(sendChat).toHaveBeenCalledTimes(1);expect(screen.getByLabelText('Сообщение')).toHaveValue('Новая идея после разрыва');
 view.unmount();mountScreen();await screen.findByText(/AI подключён/);fireEvent.click(screen.getByRole('button',{name:'Отправить'}));
 expect(sendChat).toHaveBeenCalledTimes(1);expect(document.querySelectorAll('.workspace-message.user')).toHaveLength(1);
 Reflect.deleteProperty(navigator,'locks');
});
it('disables historical paid retries in an imported copy and allows an explicit new message without changing its original',async()=>{
 const {useWorkspace}=await import('../../src/state');
 const p=createProject();const request={requestId:'imported-request',projectId:p.id,moduleId:'idea' as const,intent:'message' as const,message:'Восстановить копию',context:{name:p.name,description:p.description,facts:[],artifacts:[],history:[]}};
 p.modules.idea.draft=request.message;p.modules.idea.messages=[{id:'failed-original',role:'user',content:request.message,createdAt:new Date().toISOString(),status:'failed',requestId:request.requestId,request,requestError:'NETWORK_ERROR'}];
 const original=structuredClone(p);let raw=serializeWorkspace({version:1,activeProjectId:p.id,projects:[p]});const backup=raw;
 const storage={getItem:()=>raw,setItem:(_key:string,next:string)=>{raw=next;}};
 let current:ReturnType<typeof useWorkspace>;
 function Harness(){current=useWorkspace();return <><button onClick={()=>current.importWorkspace(backup)}>Импорт копии</button><WorkspaceScreen onOpenModule={vi.fn()}/></>;}
 vi.mocked(getStatus).mockResolvedValue({configured:true,reason:'',model:'test',searchEnabled:false});
 vi.mocked(sendChat).mockReset().mockResolvedValue({requestId:request.requestId,model:'test',reply:{message:'Ответ только для копии',choices:[],artifactDraft:null,proposedFacts:[]}});
 const view=render(<WorkspaceProvider storage={storage}><Harness/></WorkspaceProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Импорт копии'}));const copyId=current!.project.id;expect(copyId).not.toBe(p.id);
 // Exercise the restored payload after a browser reload, as well as collision remapping.
 raw=current!.exportWorkspace();view.unmount();render(<WorkspaceProvider storage={storage}><Harness/></WorkspaceProvider>);
 await screen.findByText(/Незавершённые запросы из копии не повторяются/);
 expect(screen.queryByRole('button',{name:'Повторить тот же запрос'})).not.toBeInTheDocument();
 expect(sendChat).not.toHaveBeenCalled();
 expect(current!.project.modules.idea.messages[0]).toMatchObject({request,requestError:'IMPORTED_REQUEST',status:'failed'});
 await screen.findByText(/AI подключён/);
 fireEvent.change(screen.getByLabelText('Сообщение'),{target:{value:'Продолжить в новом проекте'}});fireEvent.click(screen.getByRole('button',{name:'Отправить'}));
 await waitFor(()=>expect(current!.workspace.projects.find(project=>project.id===copyId)?.modules.idea.messages.filter(message=>message.role==='assistant')).toHaveLength(1));
 expect(sendChat).toHaveBeenCalledTimes(1);
 const fresh=vi.mocked(sendChat).mock.calls[0][0];expect(fresh.requestId).not.toBe(request.requestId);expect(fresh.projectId).toBe(copyId);
 expect(current!.workspace.projects.find(project=>project.id===p.id)).toEqual(original);
 expect(current!.project.modules.idea.messages.filter(message=>message.role==='user')).toHaveLength(2);
 expect(current!.project.modules.idea.messages[0].request).toEqual(request);
});
it('continues AI dialogue with an accepted 24000-character artifact and persists the exact pending context',async()=>{
 const {useWorkspace}=await import('../../src/state');const {parseWorkspace}=await import('../../shared/validation');const {requestSchema,validateReply}=await import('../../server/validation');
 const p=createProject();let current:ReturnType<typeof useWorkspace>;
 const body='Д'.repeat(24000);const reply={message:'Итог подготовлен',choices:[],artifactDraft:{title:'Большой итог',body},proposedFacts:[]};
 const storage={getItem:()=>serializeWorkspace({version:1,activeProjectId:p.id,projects:[p]}),setItem:vi.fn()};
 function Harness(){current=useWorkspace();return <WorkspaceScreen onOpenModule={vi.fn()}/>;}
 vi.mocked(getStatus).mockResolvedValue({configured:true,reason:'',model:'test',searchEnabled:false});
 let finish!:()=>void;
 vi.mocked(sendChat).mockReset().mockImplementationOnce(async request=>({requestId:request.requestId,model:'test',reply:validateReply(reply,request)})).mockImplementationOnce(request=>new Promise(resolve=>{finish=()=>resolve({requestId:request.requestId,model:'test',reply:{message:'Продолжаем',choices:[],artifactDraft:null,proposedFacts:[]}});}));
 render(<WorkspaceProvider storage={storage}><Harness/></WorkspaceProvider>);await screen.findByText(/AI подключён/);
 fireEvent.change(screen.getByLabelText('Сообщение'),{target:{value:'Подготовь материал'}});fireEvent.click(screen.getByRole('button',{name:'Отправить'}));await screen.findByText('Итог подготовлен');
 expect(screen.queryByRole('region',{name:'Итог этапа · Идея'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Сообщение'),{target:{value:'Продолжим обсуждение'}});fireEvent.click(screen.getByRole('button',{name:'Отправить'}));
 expect(sendChat).toHaveBeenCalledTimes(2);const sent=vi.mocked(sendChat).mock.calls[1][0];expect(requestSchema.safeParse(sent).success).toBe(true);
 const restored=parseWorkspace(current!.exportWorkspace()).projects[0];const pending=restored.modules.idea.messages.find(message=>message.status==='pending');
 expect(restored.modules.idea.artifact).toBeNull();expect(restored.modules.idea.proposal?.artifactDraft?.body).toBe(body);expect(pending?.request).toEqual(sent);expect(sent.context.currentDraft?.body).toBe(body);
 finish();await screen.findByText('Продолжаем');
});
it('starts the market from saved decisions without asking for its geography again or calling AI',async()=>{
 const {saveArtifact,updateFacts}=await import('../../shared/domain');
 let p=saveArtifact(createProject(),'idea',{title:'Идея доставки',body:'Доставка фермерских наборов по подписке.'});
 p=saveArtifact(p,'audience',{title:'Покупатели наборов',body:'Семьи с детьми; старт в выбранном городе.'});
 p=updateFacts(p,[
  {key:'idea',value:'Фермерские наборы',provenance:'user',note:''},
  {key:'price',value:'2400 ₽ за набор',provenance:'hypothesis',note:'Цену ещё проверим'},
  {key:'audience',value:'Семьи с детьми',provenance:'user',note:''},
  {key:'geography',value:'Ярославль',provenance:'user',note:'Выбран пользователем'},
 ]);p.activeModule='market';
 vi.mocked(getStatus).mockResolvedValue({configured:true,reason:'',model:'mock-only',searchEnabled:false});vi.mocked(sendChat).mockReset();
 const storage={getItem:()=>serializeWorkspace({version:1,activeProjectId:p.id,projects:[p]}),setItem:vi.fn()};
 render(<WorkspaceProvider storage={storage}><WorkspaceScreen onOpenModule={vi.fn()}/></WorkspaceProvider>);
 await screen.findByText(/AI подключён/);const welcome=document.querySelector('.workspace-welcome')!;
 expect(welcome).not.toHaveTextContent('В какой географии вы хотите начать');
 expect(welcome).toHaveTextContent('TAM / SAM / SOM');
 expect(welcome).not.toHaveTextContent('Ярославль');expect(welcome).not.toHaveTextContent('2400 ₽ за набор');
 expect(within(welcome as HTMLElement).getByRole('button',{name:'Начать этап'})).toBeInTheDocument();
 expect(sendChat).not.toHaveBeenCalled();
});
