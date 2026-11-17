import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { ModuleId, ViewId } from '../shared/types';
import { MAX_WORKSPACE_BYTES } from '../shared/validation';
import { WorkspaceProvider, useWorkspace } from './state';
import { AppShell } from './components/layout/AppShell';
import { RoutePanel } from './components/layout/RoutePanel';
import { Modal } from './components/ui/Modal';
import { WorkspaceScreen } from './features/workspace';
import { PresentationScreen, ToolsScreen, ProfileScreen, GalleryScreen } from './features/materials';
import { downloadText } from './lib/download';
import { getAccess, getUnlockedStages } from '../shared/domain';
export default function App(){return <WorkspaceProvider><Application /></WorkspaceProvider>;}
function Application(){
 const store=useWorkspace(); const {project,workspace,storageError}=store;
 const [route,setRoute]=useState<ViewId>('workspace'); const [projects,setProjects]=useState(false);
 const [confirm,setConfirm]=useState<'delete'|'reset'|null>(null); const [importError,setImportError]=useState('');
 // MVP shares the workspace screen, but its menu item needs a way back to the
 // previous conversation. Keep that destination separate for each project.
 const workshopModules=useRef(new Map<string,ModuleId>());
 useEffect(()=>{
  if(project.activeModule!=='mvp')workshopModules.current.set(project.id,project.activeModule);
 },[project.id,project.activeModule]);
 const openModule=(id:ModuleId)=>{if(!getAccess(project,id).allowed)return;store.setProject(p=>({...p,unlockedStages:getUnlockedStages(p),activeModule:id}));setRoute('workspace');};
 const openRoute=(view:ViewId)=>{
  if(view==='workspace'&&project.activeModule==='mvp')openModule(workshopModules.current.get(project.id)??'idea');
  else setRoute(view);
 };
 const exportWork=()=>downloadText(store.exportWorkspace(),'cofounder-workspace.json','application/json');
 return <><AppShell route={route} onRouteChange={openRoute} activeModule={project.activeModule} onModuleChange={openModule} projectName={project.name}
 projectControls={<button className="project-picker" aria-label="Проекты" title={`Проекты · ${project.name}`} onClick={()=>setProjects(true)}><FolderOpen size={21} aria-hidden="true"/><span>Проекты</span></button>}
 routePanel={<RoutePanel project={project} onModuleChange={openModule}/>}>
 {storageError&&<div className="storage-warning" role="alert"><p>{storageError}</p><button onClick={exportWork}>Скачать текущую работу</button><button disabled={store.exportStoredBackup()===null} onClick={()=>{const raw=store.exportStoredBackup();if(raw!==null)downloadText(raw,'cofounder-original-backup.txt');}}>Скачать исходную запись</button><button onClick={()=>setConfirm('reset')}>Восстановить сохранение</button></div>}
 {route==='workspace'&&<WorkspaceScreen onOpenModule={openModule}/>}
 {route==='presentation'&&<PresentationScreen onOpenModule={openModule}/>}
 {route==='tools'&&<ToolsScreen onOpenModule={openModule}/>}
 {route==='profile'&&<ProfileScreen onOpenModule={openModule} onOpenGallery={()=>setRoute('gallery')}/>}
 {route==='gallery'&&<GalleryScreen onOpenModule={openModule} onOpenPresentation={()=>setRoute('presentation')} onOpenProfile={()=>setRoute('profile')}/>}
 </AppShell>
 <Modal open={projects} title="Проекты в этом браузере" onClose={()=>setProjects(false)}><p className="muted">Без аккаунта и синхронизации. Скачивайте JSON для переноса и резервного копирования. Подготовленный пример — вымышленные данные, не ответы живого AI.</p><div className="project-list">{workspace.projects.map(p=><button key={p.id} aria-pressed={p.id===project.id} onClick={()=>{store.selectProject(p.id);setProjects(false);setRoute('workspace');}}><strong>{p.name}</strong><span>{p.isDemo?'Подготовленный пример':'Свой проект'}</span></button>)}</div><div className="project-modal-actions"><button onClick={()=>{store.addProject();setProjects(false);setRoute('workspace');}}>Новый проект</button><button onClick={()=>{store.addProject(true);setProjects(false);setRoute('workspace');}}>Открыть подготовленный пример</button><button onClick={exportWork}>Экспорт всех проектов JSON</button><label className="import-control">Импорт JSON<input type="file" accept=".json,application/json" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>MAX_WORKSPACE_BYTES)throw new Error('Файл больше 64 МиБ.');store.importWorkspace(await file.text());setImportError('');}catch{setImportError('Не удалось прочитать файл.');}e.target.value='';}}/></label><button className="danger-button" onClick={()=>{setProjects(false);setConfirm('delete');}}>Удалить текущий проект</button></div>{importError&&<p role="alert">{importError}</p>}</Modal>
 <Modal open={confirm!==null} title={confirm==='delete'?'Удалить текущий проект?':'Перезаписать сохранённые данные?'} onClose={()=>setConfirm(null)}><p>{confirm==='delete'?`Проект «${project.name}» и его разговоры будут удалены из этого браузера. Сначала можно отменить и скачать JSON.`:'Текущая временная работа заменит запись в браузере, включая данные другой вкладки или повреждённую копию. Сначала скачайте текущую работу и исходную запись.'}</p><div className="project-modal-actions"><button onClick={()=>setConfirm(null)}>Отмена</button><button className="danger-button" onClick={()=>{if(confirm==='delete')store.deleteProject(project.id);else store.resetStorage();setConfirm(null);}}>Подтвердить {confirm==='delete'?'удаление проекта':'перезапись'}</button></div></Modal></>;
}
