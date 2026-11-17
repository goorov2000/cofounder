import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatRequest, Message, ModuleId, Project, ResearchProgress, TopicCoverage } from '../../../shared/types';
import { MODULES, STAGE_IDS } from '../../../shared/modules';
import { collectMemories } from '../../../shared/memory';
import { savedCoverage, isTopicComplete } from '../../../shared/coverage';
import { allowsChatContext, collectArtifacts, collectCurrentDraft, collectProjectFacts } from '../../../shared/chatContext';
import { archiveMessage } from '../../../shared/coreMemory';
import { CoreMemoryError } from '../../../shared/coreValidation';
import { getStageWelcome } from '../../../shared/welcome';
import { getAccess, getUnlockedStages, parseNavigation, restartChat } from '../../../shared/domain';
import { useWorkspace } from '../../state';
import { ApiRequestError, getStatus, sendChat, assertRequestFits, type ApiStatus, type RequestPreparationDiagnostics } from '../../lib/api';
import { RequestNotice } from './RequestNotice';
import { downloadText } from '../../lib/download';
import { formatConversation } from '../../lib/conversation';
import { Markdown } from '../../components/ui/Markdown';
import { Modal } from '../../components/ui/Modal';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { Calculator } from './Calculator';
import { Button } from '../../design-system/components';
import { ChatComposer } from '../../design-system/ChatComposer';
import { CopyConversationButton } from '../../design-system/CopyConversationButton';
import { IconButton } from '../../components/ui/IconButton';
import { AnswerChoices } from '../../design-system/AnswerChoices';
import { AssistantActions } from '../../design-system/AssistantActions';
import { UserMessage } from '../../design-system/UserMessage';
import { AIDisclaimer } from '../../design-system/AIDisclaimer';
import { ThinkingIndicator } from '../../design-system/ThinkingIndicator';
import { StageIntro } from '../../design-system/StageIntro';
import { useStageTitleTransition } from '../../design-system/useStageTitleTransition';
import { useReadAloud } from '../../hooks/useReadAloud';
import { applyAnswer, bindCoreRequest, createRegenerationRequest, findAnswer } from './answerRequests';
import { AnswerSources } from './AnswerSources';
import { CircleHelp, PanelRightClose, PanelRightOpen, RotateCcw } from 'lucide-react';
import { ProjectPanel } from '../../design-system/ProjectPanel';
import { TopicCompletion, topicCompletionText } from '../../design-system/TopicCompletion';
import { useMedia } from '../../hooks/useMedia';
import './workspace.css';
const uid=()=>crypto.randomUUID();
interface Flight {targetProjectId:string;replaceMessageId?:string;editMessageId?:string;request:ChatRequest;controller:AbortController;error?:ApiRequestError;previousCoverage?:TopicCoverage}
export function WorkspaceScreen({onOpenModule}:{onOpenModule(module:ModuleId):void}) {
 const {project,setProject,exportWorkspace}=useWorkspace();const moduleId=project.activeModule;const module=MODULES[moduleId];const state=project.modules[moduleId];
 const {introTitle,headerTitle,captureTitle}=useStageTitleTransition(`${project.id}:${moduleId}`,Boolean(state.messages.length));
 const [tab,setTab]=useState('chat');const [status,setStatus]=useState<ApiStatus|null>(null);const [statusError,setStatusError]=useState('');const [help,setHelp]=useState(false);const [notice,setNoticeValue]=useState('');const [noticeDetails,setNoticeDetails]=useState<RequestPreparationDiagnostics|undefined>(undefined);const [busy,setBusy]=useState(false);const [retry,setRetry]=useState<Flight|null>(null);const flight=useRef<Flight|null>(null);const visible=useRef({projectId:project.id,moduleId});visible.current={projectId:project.id,moduleId};const [jump,setJump]=useState(false);const scroller=useRef<HTMLDivElement>(null);const input=useRef<HTMLTextAreaElement>(null);const nearBottom=useRef(true);
 function setNotice(text:string,details?:RequestPreparationDiagnostics){setNoticeValue(text);setNoticeDetails(details);}
 const [panelVisible,setPanelVisible]=useState(true);const [panelDrawer,setPanelDrawer]=useState(false);
 const [restart,setRestart]=useState(false);
 const [streamText,setStreamText]=useState('');
 const [researchProgress,setResearchProgress]=useState<ResearchProgress|null>(null);
 const [requestStartedAt,setRequestStartedAt]=useState<number|undefined>();
 const body=useRef<HTMLDivElement>(null);const composeArea=useRef<HTMLDivElement>(null);
 const narrow=useMedia('(max-width: 899px)');const panel=useRef<HTMLDivElement>(null);const heading=useRef<HTMLDivElement>(null);
 function closePanelView(close:()=>void){close();if(narrow)requestAnimationFrame(()=>heading.current?.querySelector<HTMLButtonElement>('.workspace-panel-toggle')?.focus());}
 const showPanel=panelVisible&&!narrow;
 // A tall expanded panel uses the same scroll area as the conversation. Its
 // sticky offset lets the bottom remain reachable without a nested scrollbar.
 useLayoutEffect(()=>{
  const history=scroller.current;const card=panel.current;if(!history||!card)return;
  const measure=()=>{const top=`${Math.min(16,history.clientHeight-card.offsetHeight-16)}px`;if(card.style.top!==top)card.style.top=top;};
  measure();if(typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(measure);observer.observe(history);observer.observe(card);
  return()=>observer.disconnect();
 },[showPanel]);
 // Reserve space only under the conversation. The shared scroll area and route
 // continue to the bottom of the workspace, beside the pinned composer.
 useLayoutEffect(()=>{
  const area=composeArea.current;const container=body.current;if(!area||!container)return;
  let previousHeight=0;
  const measure=()=>{
   const height=area.offsetHeight;if(height===previousHeight)return;
   container.style.setProperty('--workspace-compose-height',`${height}px`);
   if(previousHeight&&nearBottom.current)scrollToLatest();
   previousHeight=height;
  };
  measure();if(typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(measure);observer.observe(area);
  return()=>observer.disconnect();
 },[]);
 useEffect(()=>setPanelDrawer(false),[narrow,project.id,moduleId]);
 const patch=(updater:(p:Project)=>Project,id=project.id)=>setProject(updater,id);
 const draft=(text:string)=>patch(p=>({...p,modules:{...p.modules,[moduleId]:{...p.modules[moduleId],draft:text}}}));
 const voice=useSpeechRecognition(draft);
 const reader=useReadAloud(project.id+moduleId+tab);
 useEffect(()=>{let live=true;getStatus().then(v=>{if(live)setStatus(v);}).catch(()=>{if(live)setStatusError('Не удалось проверить AI. Локальная работа доступна.');});return()=>{live=false;};},[]);
 useEffect(()=>{voice.cancel();setTab('chat');setNotice('');setRetry(null);setRestart(false);},[project.id,moduleId]);
 // Pending is recoverable after reload, but a live request is still waiting, not interrupted.
 const persisted=busy?undefined:state.messages.findLast(m=>m.requestError!=='IMPORTED_REQUEST'&&(m.role==='user'?m.request:m.regenerationRequest)&&(m.status==='pending'||m.status==='failed'));
 const persistedRequest=persisted?.role==='assistant'?persisted.regenerationRequest:persisted?.request;
 const recovered:Flight|null=persistedRequest?{targetProjectId:project.id,replaceMessageId:persisted?.role==='assistant'?persisted.id:persisted?.replacesAnswerId,editMessageId:persisted?.replacesAnswerId?persisted.id:undefined,request:persistedRequest,controller:new AbortController(),error:new ApiRequestError(persisted?.requestError??'NETWORK_ERROR','Запрос прерван или его результат неизвестен. Исходный текст сохранён.',true)}:null;
 const retryItem=busy?null:retry?.targetProjectId===project.id&&retry.request.moduleId===moduleId?retry:recovered;
 const waitingHere=busy&&flight.current?.targetProjectId===project.id&&flight.current.request.moduleId===moduleId;
 const replacingMessageId=waitingHere?flight.current?.replaceMessageId:undefined;
 const conversationText=useMemo(()=>formatConversation({projectName:project.name,stageTitle:module.title,messages:state.messages,notice,stream:waitingHere&&streamText?{text:streamText,replacesMessageId:replacingMessageId}:undefined}),[project.name,module.title,state.messages,notice,waitingHere,streamText,replacingMessageId]);
 const visibleStreamText=waitingHere?streamText:'';
 useEffect(()=>()=>{flight.current?.controller.abort();},[]);
 function scrollToLatest(){const el=scroller.current;const thread=el?.querySelector('.workspace-thread');if(el&&thread)el.scrollTop=Math.max(0,el.scrollTop+thread.getBoundingClientRect().bottom-el.getBoundingClientRect().top-el.clientHeight);}
 useEffect(()=>{if(nearBottom.current){if(state.messages.length||notice)scrollToLatest();else if(scroller.current)scroller.current.scrollTop=0;}else setJump(true);},[state.messages.length,busy,visibleStreamText,notice]);
 const access=getAccess(project,moduleId);
 const hasChatContent=Boolean(state.messages.length||state.draft||state.memory||state.proposal||state.artifact||project.calculations[moduleId]);
 function restartCurrentChat(){
  const active=flight.current;
  if(active?.targetProjectId===project.id&&active.request.moduleId===moduleId){flight.current=null;active.controller.abort();setBusy(false);setStreamText('');setResearchProgress(null);setRequestStartedAt(undefined);}
  voice.cancel();reader.stop();setRetry(null);setNotice('');setTab('chat');setRestart(false);
  nearBottom.current=true;setJump(false);patch(p=>restartChat(p,moduleId));
  requestAnimationFrame(()=>input.current?.focus());
 }
 async function execute(item:Flight){if(flight.current)return;item.previousCoverage=item.targetProjectId===project.id?savedCoverage(project,item.request.moduleId):undefined;flight.current=item;setBusy(true);setRequestStartedAt(Date.now());setRetry(null);setNotice('');setStreamText('');setResearchProgress(null);
 try{const response=await sendChat(item.request,item.controller.signal,delta=>{if(flight.current===item&&!item.controller.signal.aborted)setStreamText(text=>text+delta);},progress=>{if(flight.current===item&&!item.controller.signal.aborted)setResearchProgress(progress);},()=>{if(flight.current===item&&!item.controller.signal.aborted)setStreamText('');});if(flight.current!==item)return;patch(p=>{try{return applyAnswer(p,item.request,response.reply,item.replaceMessageId,item.editMessageId);}catch(error){if(!(error instanceof CoreMemoryError))throw error;if(visible.current.projectId===item.targetProjectId)setNotice(error.message);return {...p,modules:{...p.modules,[item.request.moduleId]:{...p.modules[item.request.moduleId],messages:p.modules[item.request.moduleId].messages.map(m=>m.requestId===item.request.requestId||m.id===item.replaceMessageId?{...m,status:'failed' as const,requestError:error.code}:m)}}};}},item.targetProjectId);
 }catch(error){if(flight.current!==item)return;const err=error instanceof ApiRequestError?error:new ApiRequestError('OUTCOME_UNKNOWN','Результат неизвестен. Автоматического повтора нет.',false);const req=item.request;patch(p=>({...p,modules:{...p.modules,[req.moduleId]:{...p.modules[req.moduleId],messages:p.modules[req.moduleId].messages.map(m=>(m.requestId===req.requestId||m.id===item.replaceMessageId)?{...m,status:'failed' as const,requestError:err.code}:m)}}}),item.targetProjectId);item.error=err;setRetry(item);if(visible.current.projectId===item.targetProjectId&&visible.current.moduleId===req.moduleId)setNotice(err.message+(err.code==='AI_TIMEOUT'||err.code==='OUTCOME_UNKNOWN'||err.code==='PROVIDER_NETWORK'?' Повторная оплата не запускается.':''));
 }finally{if(flight.current===item){flight.current=null;setBusy(false);setStreamText('');setResearchProgress(null);}}}
 function submit(text=state.draft,intent:ChatRequest['intent']='message',choiceId?:string){if(flight.current||!text.trim())return;const navigation=parseNavigation(text);if(navigation){const a=getAccess(project,navigation);if(a.allowed)onOpenModule(navigation);else setNotice(`Сначала проработайте: ${a.missing.map(id=>MODULES[id].shortTitle).join(', ')}`);return;}
 if(retryItem&&retryItem.request.message===text.trim()&&['AI_TIMEOUT','OUTCOME_UNKNOWN','REQUEST_ABORTED','NETWORK_ERROR','PROVIDER_NETWORK'].includes(retryItem.error?.code??'')){setNotice(retryItem.error?.code==='NETWORK_ERROR'?'Используйте «Повторить тот же запрос»: исходный идентификатор защищает от дубля.':'Результат предыдущего запроса неизвестен. Повторная оплата не запускается.');return;}
 if(!status?.configured){setNotice('AI пока не подключён. Черновик сообщения можно сохранить здесь и отправить после подключения.');return;}if(!access.allowed)return;
 const question=[...state.messages].reverse().find(m=>m.role==='assistant');if(choiceId&&(!question||question.id!==choiceId||question.choiceConsumed))return;
 voice.cancel();const sourceMessage:Message={id:uid(),role:'user',content:text.trim(),createdAt:new Date().toISOString(),revision:1,status:'pending'};let request:ChatRequest={requestId:uid(),projectId:project.id,moduleId,intent,message:text.trim(),context:{memories:collectMemories(project),name:project.name,description:project.description,facts:collectProjectFacts(project),artifacts:collectArtifacts(project),currentDraft:collectCurrentDraft(project,moduleId),history:state.messages.filter(m=>m.role==='assistant'||(m.status!=='pending'&&m.status!=='failed')).slice(-40).map(m=>({role:m.role,content:m.content.slice(0,8000)}))}};
 sourceMessage.requestId=request.requestId;
 request=bindCoreRequest(project,request,sourceMessage).request;
 // Calculation scenarios retain their formula, input provenance and period in the request context.
 for(const key of ['market','economics'] as const){if(!allowsChatContext(project,key))continue;const value=project.calculations[key] as {inputs?:Record<string,unknown>;results?:Record<string,unknown>;period?:string;currency?:string;stale?:boolean;staleReason?:string}|undefined;if(!value)continue;for(const [field,data] of Object.entries({...value.inputs,...value.results}))request.context.facts.push({key:`scenario_${key}_${field}`,value:JSON.stringify(data).slice(0,2000),provenance:'calculation',note:`${value.stale?'Расчёт устарел: '+value.staleReason+'. ':''}Локальный сценарий, период: ${value.period||'неизвестно'}, валюта: ${value.currency||'неизвестно'}. Допущения не подтверждают спрос.`});}
 try{assertRequestFits(request);}catch(error){setNotice(error instanceof Error?error.message:'Не удалось подготовить сообщение.',error instanceof ApiRequestError?error.diagnostics:undefined);return;}
 captureTitle();nearBottom.current=true;setJump(false);
 const accepted=patch(p=>({...archiveMessage(p,moduleId,sourceMessage),unlockedStages:getUnlockedStages(p),modules:{...p.modules,[moduleId]:{...p.modules[moduleId],draft:intent==='draft'||p.modules[moduleId].draft!==text?p.modules[moduleId].draft:'',messages:[...p.modules[moduleId].messages.map(m=>m.id===(choiceId??question?.id)?{...m,choiceConsumed:true}:m),{...sourceMessage,request}]}}}));if(!accepted)return;void execute({targetProjectId:project.id,request,controller:new AbortController()});}
 function editMessage(message:Message,text:string):string|undefined{
  if(flight.current)return 'Дождитесь текущего ответа.';
  if(!access.allowed||!status?.configured)return 'AI пока недоступен. Правку можно отправить после подключения.';
  const answer=findAnswer(state.messages,message.id);
  if(!answer)return 'Для этого сообщения ещё нет ответа. Дождитесь завершения запроса.';
  const unfinished=message.replacesAnswerId?message:answer.regenerationRequest?answer:null;
  if(unfinished&&['NETWORK_ERROR','AI_TIMEOUT','OUTCOME_UNKNOWN','REQUEST_ABORTED','PROVIDER_NETWORK'].includes(unfinished.requestError??'NETWORK_ERROR'))return unfinished.requestError==='NETWORK_ERROR'?'Сначала закройте окно и нажмите «Повторить тот же запрос», чтобы восстановить прерванную правку.':'Результат предыдущего запроса неизвестен. Повторная оплата не запускается.';
  let request=createRegenerationRequest(project,moduleId,answer);
  if(!request)return 'Не найден исходный вопрос.';
  request=bindCoreRequest(project,request,message,text.trim()).request;
  try{assertRequestFits(request);}catch(error){return error instanceof Error?error.message:'Контекст превышает лимит AI. Экспортируйте JSON.';}
  voice.cancel();reader.stop();
  const accepted=patch(p=>({...archiveMessage(p,moduleId,message),modules:{...p.modules,[moduleId]:{...p.modules[moduleId],messages:p.modules[moduleId].messages.map(m=>m.id===message.id?{...m,request,requestId:request.requestId,replacesAnswerId:answer.id,status:'pending' as const,requestError:undefined}:m)}}}));
  if(!accepted)return 'Не удалось принять изменение. Исходный текст сохранён; новый запрос не отправлен.';
  void execute({targetProjectId:project.id,replaceMessageId:answer.id,editMessageId:message.id,request,controller:new AbortController()});
 }
 function regenerate(message:Message){
  if(flight.current||!access.allowed||!status?.configured)return;
  const pendingEdit=state.messages.find(m=>m.replacesAnswerId===message.id);
  if(pendingEdit){setNotice((pendingEdit.requestError??'NETWORK_ERROR')==='NETWORK_ERROR'?'Сначала восстановите правку сообщения через «Повторить тот же запрос». Старый ответ сохранён.':'Предыдущая правка ещё не завершена. Старый ответ сохранён; повторная оплата не запускается.');return;}
  if(message.regenerationRequest&&['NETWORK_ERROR','AI_TIMEOUT','OUTCOME_UNKNOWN','REQUEST_ABORTED','PROVIDER_NETWORK'].includes(message.requestError??'NETWORK_ERROR')){setNotice(message.requestError==='NETWORK_ERROR'?'Используйте «Повторить тот же запрос»: исходный идентификатор защищает от дубля.':'Результат предыдущего запроса неизвестен. Повторная оплата не запускается.');return;}
  let request=createRegenerationRequest(project,moduleId,message);
  if(!request){setNotice('Не найден исходный вопрос. Напишите новое сообщение.');return;}
  const source=state.messages.slice(0,state.messages.findIndex(m=>m.id===message.id)).findLast(m=>m.role==='user')!;
  request=bindCoreRequest(project,request,source).request;
  try{assertRequestFits(request);}catch(error){setNotice(error instanceof Error?error.message:'Не удалось подготовить сообщение.',error instanceof ApiRequestError?error.diagnostics:undefined);return;}
  voice.cancel();reader.stop();
  const accepted=patch(p=>({...archiveMessage(p,moduleId,source),modules:{...p.modules,[moduleId]:{...p.modules[moduleId],messages:p.modules[moduleId].messages.map(m=>m.id===message.id?{...m,regenerationRequest:request,status:'pending' as const,requestError:undefined}:m)}}}));
  if(!accepted)return;
  void execute({targetProjectId:project.id,replaceMessageId:message.id,request,controller:new AbortController()});
 }
 const next=STAGE_IDS[STAGE_IDS.indexOf(moduleId as typeof STAGE_IDS[number])+1];
 const lastQuestion=[...state.messages].reverse().find(m=>m.role==='assistant');
 const unanswered=state.messages.at(-1)?.role==='user'||Boolean(state.messages.at(-1)?.status&&state.messages.at(-1)?.status!=='sent');
 const canFinalize=isTopicComplete(project,moduleId)&&!waitingHere&&!unanswered;
 const nextTitle=STAGE_IDS.includes(moduleId as typeof STAGE_IDS[number])&&next?MODULES[next].shortTitle:undefined;
 const welcome=getStageWelcome(project,moduleId);
 const projectPanel=<ProjectPanel key={`${project.id}:${moduleId}`} project={project} coverageUpdate={waitingHere?{reviewing:researchProgress?.phase==='reviewing',previous:flight.current?.previousCoverage}:undefined} onModuleChange={id=>{setPanelDrawer(false);onOpenModule(id);}}
   onCalculator={()=>{setPanelDrawer(false);setTab('calculator');}}/>;
 return <section className={`workspace-screen${showPanel?' has-project-panel':''}`} aria-label={module.title}>
 <div className="workspace-heading" ref={heading}><div className="workspace-stage">{!!state.messages.length&&<h1 className="ds-stage-title" ref={headerTitle} title={module.title}>{module.title}</h1>}<span className="sr-only" role="status" aria-label="Подключение AI">{status?.configured?'AI подключён · '+status.model:status?`Подключение AI отсутствует. ${status.reason}`:statusError||'Проверяем подключение AI…'}</span></div>
 <CopyConversationButton key={`${project.id}:${moduleId}`} text={conversationText+(canFinalize?'\n\nПомощник\n'+topicCompletionText(nextTitle):'')} disabled={!state.messages.length}/>
 <IconButton label="Начать чат заново" aria-haspopup="dialog" disabled={!hasChatContent} onClick={()=>setRestart(true)}><RotateCcw size={20}/></IconButton>
 <IconButton label="Как работать" aria-haspopup="dialog" onClick={()=>setHelp(true)}><CircleHelp size={20}/></IconButton>
 <IconButton className="workspace-panel-toggle" label={narrow?'Открыть панель проекта':panelVisible?'Скрыть панель проекта':'Показать панель проекта'} aria-expanded={narrow?panelDrawer:panelVisible} aria-controls={narrow?undefined:'project-panel'} aria-haspopup={narrow?'dialog':undefined} onClick={()=>narrow?setPanelDrawer(true):setPanelVisible(!panelVisible)}>{showPanel?<PanelRightClose size={21}/>:<PanelRightOpen size={21}/>}</IconButton></div>
 {!access.allowed&&<p role="alert">Для открытия этой темы проработайте: {access.missing.map(id=><button key={id} onClick={()=>onOpenModule(id)}>{MODULES[id].shortTitle}</button>)}</p>}
 <div className="workspace-body" ref={body}><div className={`workspace-history${!state.messages.length?' is-empty':''}`} ref={scroller} onScroll={()=>{const e=scroller.current;const thread=e?.querySelector('.workspace-thread');if(e&&thread){nearBottom.current=thread.getBoundingClientRect().bottom-e.getBoundingClientRect().bottom<80;if(nearBottom.current)setJump(false);}}}><div className="workspace-content"><div className="workspace-thread">
 {!state.messages.length&&<div className="workspace-welcome"><StageIntro title={module.title} description={welcome.message} titleRef={introTitle} actions={moduleId==='idea'&&!welcome.prompt?<><Button disabled={busy||!access.allowed} onClick={()=>{submit('У меня есть идея. Помоги мне её сформулировать.');input.current?.focus();}}>Есть идея</Button><Button disabled={busy||!access.allowed} onClick={()=>{submit('Помоги найти идею. Пока не знаю, с чего начать.');input.current?.focus();}}>Найти идею</Button></>:<Button disabled={busy||!access.allowed} onClick={()=>{submit(welcome.prompt??`Начнём этап «${module.title}». Помоги пройти его шаг за шагом.`);input.current?.focus();}}>Начать этап</Button>}>
 {project.isDemo&&<p className="workspace-demo-note">{project.name} · Вымышленный демонстрационный проект</p>}
 {status&&!status.configured&&<p className="workspace-offline">AI пока не подключён. Черновик сообщения можно сохранить здесь и отправить после подключения.</p>}
 </StageIntro></div>}
 {state.messages.map(m=>{const updating=waitingHere&&flight.current?.replaceMessageId===m.id&&Boolean(streamText);return m.role==='user'?<UserMessage key={m.id} className="workspace-message user" text={m.content} status={m.status==='pending'?'ожидаем ответ':m.status==='failed'?'ответ не получен':undefined} onRead={text=>{voice.cancel();reader.read(m.id,text);}} speaking={reader.speakingId===m.id} voiceError={reader.error?.id===m.id?reader.error.text:undefined} onEdit={text=>editMessage(m,text)} editDisabled={busy||!status?.configured||!access.allowed||!findAnswer(state.messages,m.id)} pendingEdit={m.replacesAnswerId?m.request?.message:undefined}/>:<article className={`workspace-message ${m.role}${updating?' is-streaming':''}`} key={m.id} aria-busy={updating||undefined}>{(m.status==='pending'||m.status==='failed')&&<p className="eyebrow">{m.status==='pending'?'Обновляем ответ':'Не удалось обновить'}</p>}<Markdown allowLinks={!updating}>{updating?streamText:m.content}</Markdown>{updating&&<span className="sr-only" role="status">Помощник отвечает</span>}{!updating&&m.role==='assistant'&&m.id===lastQuestion?.id&&!m.choiceConsumed&&!canFinalize&&!!m.choices?.length&&<AnswerChoices className="workspace-choices" choices={m.choices!} disabled={busy} onChoose={choice=>{submit(choice.label,'message',m.id);input.current?.focus();}}/>}{!updating&&m.role==='assistant'&&<AssistantActions text={m.content} feedback={m.feedback} onFeedback={feedback=>patch(p=>({...p,modules:{...p.modules,[moduleId]:{...p.modules[moduleId],messages:p.modules[moduleId].messages.map(item=>item.id===m.id?{...item,feedback}:item)}}}))} onRegenerate={()=>regenerate(m)} regenerateDisabled={busy||!status?.configured||!access.allowed||!state.messages.slice(0,state.messages.indexOf(m)).some(item=>item.role==='user')} onRead={text=>{voice.cancel();reader.read(m.id,text);}} speaking={reader.speakingId===m.id} voiceError={reader.error?.id===m.id?reader.error.text:undefined} sources={<AnswerSources message={m}/>} />}</article>;})}
 {waitingHere&&!streamText&&!researchProgress&&<ThinkingIndicator startedAt={requestStartedAt}/>}
 {waitingHere&&!!streamText&&!flight.current?.replaceMessageId&&<article className="workspace-message assistant is-streaming" aria-busy="true"><span className="sr-only" role="status">Помощник отвечает</span><Markdown allowLinks={false}>{streamText}</Markdown></article>}
 {waitingHere&&researchProgress&&<ThinkingIndicator message={researchProgress.message} startedAt={requestStartedAt}/>}
 {canFinalize&&<TopicCompletion nextTitle={nextTitle} onContinue={nextTitle?()=>onOpenModule(next):undefined}/>}
 {notice&&<RequestNotice message={notice} diagnostics={noticeDetails} onClose={()=>setNotice('')} onExport={noticeDetails||retryItem?.error?.code==='BUDGET_EXHAUSTED'?()=>{try{downloadText(exportWorkspace(),'cofounder-backup.json','application/json');}catch{setNotice('Не удалось скачать копию. Разрешите скачивание в браузере и повторите.');}}:undefined}/>}
 {retryItem&&retryItem.error?.code==='NETWORK_ERROR'&&<button disabled={busy} onClick={()=>void execute({...retryItem,controller:new AbortController()})}>Повторить тот же запрос</button>}
 </div>{showPanel&&<aside id="project-panel" className="workspace-project" aria-label="Панель проекта"><div className="workspace-project-sticky" ref={panel}>{projectPanel}</div></aside>}</div></div>
 <div className="workspace-footer"><div className="workspace-compose-area" ref={composeArea}>{jump&&<button className="workspace-jump" onClick={()=>{nearBottom.current=true;scrollToLatest();setJump(false);}}>К последнему сообщению</button>}<ChatComposer className="workspace-composer" inputRef={input} value={state.draft} onChange={text=>{voice.cancel();draft(text);}} onSend={()=>submit()} disabled={!access.allowed} busy={busy} onCancel={()=>flight.current?.controller.abort()} onDictate={()=>{reader.stop();voice.listening?voice.stop():voice.start(state.draft);}} listening={voice.listening} voiceSupported={voice.supported} voiceStatus={voice.status}/><AIDisclaimer/></div></div></div>
 {state.messages.some(m=>m.requestError==='IMPORTED_REQUEST')&&<p role="status">Незавершённые запросы из копии не повторяются автоматически. Исходные тексты сохранены; для продолжения отправьте новое сообщение.</p>}
 <Modal open={tab==='calculator'} onClose={()=>closePanelView(()=>setTab('chat'))} title={`Расчёт · ${module.shortTitle}`} className="workspace-calculator-modal">{(moduleId==='market'||moduleId==='economics')&&<Calculator moduleId={moduleId} onDiscuss={()=>setTab('chat')}/>}</Modal>
 <Modal open={narrow&&panelDrawer} onClose={()=>setPanelDrawer(false)} title="Панель проекта" className="workspace-panel-drawer">{projectPanel}</Modal>
 <Modal open={help} onClose={()=>setHelp(false)} title="Как работать"><p>{module.description}</p><ol><li>Обсудите вопрос в чате. Важные вводные появятся в «Контексте проекта» автоматически.</li><li>Когда тема проработана, можно перейти дальше или продолжить обсуждение.</li><li>Переключайтесь между уже открытыми темами в маршруте в любой момент. Следующие темы используют накопленный контекст; отдельно сохранять карточку не нужно.</li></ol><p>Поиск и чтение публичных страниц доступны по запросу, пока включены на сервере. Основания ответа можно открыть в меню «Источники». Гипотезы не становятся проверенными автоматически. Диктовка не отправляет сообщение.</p></Modal>
 <Modal open={restart} onClose={()=>setRestart(false)} title="Начать чат заново?" className="workspace-restart-modal"><p>Переписка, черновик, память разговора и сохранённый итог этапа «{module.shortTitle}» будут удалены.{project.calculations[moduleId]?' Расчёт этого этапа тоже очистится.':''}</p><p>Остальные чаты и профиль проекта сохранятся. Связанные итоги потребуется пересмотреть.</p><div className="workspace-actions"><Button onClick={()=>setRestart(false)}>Отмена</Button><Button variant="danger" onClick={restartCurrentChat}>Начать заново</Button></div></Modal>

 </section>;
}
