import { useEffect, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { STORAGE_KEY, WorkspaceProvider, useWorkspace } from '../../src/state';
import { parseWorkspace } from '../../shared/validation';
import { decodeStoredWorkspace, COMPRESSED_WORKSPACE_PREFIX } from '../../src/state/workspaceStorage';
import { largePendingWorkspace } from '../fixtures/large-workspace';

function createLocks() {
  let tail = Promise.resolve();
  return {
    request: vi.fn((_name: string, _options: unknown, callback: () => unknown) => {
      const request = tail.then(callback);
      tail = request.then(() => undefined, () => undefined);
      return request;
    }),
  };
}
beforeEach(() => { Object.defineProperty(navigator, 'locks', { configurable: true, value: createLocks() }); });
afterEach(() => { Reflect.deleteProperty(navigator, 'locks'); });
const flushWrites = async () => { await act(async () => {}); };

it('loads legacy JSON near 4 MB and saves a larger result without losing the paid request snapshot', async()=>{
  const { workspace, pending } = largePendingWorkspace(), initial = JSON.stringify(workspace);
  const values = new Map([[STORAGE_KEY, initial]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const wrapper = ({ children }: { children: ReactNode }) => <WorkspaceProvider storage={storage}>{children}</WorkspaceProvider>;
  const first = renderHook(useWorkspace, { wrapper }); await flushWrites();
  expect(storage.getItem(STORAGE_KEY)?.startsWith(COMPRESSED_WORKSPACE_PREFIX)).toBe(true);
  act(()=>first.result.current.setProject(project=>({ ...project, modules: { ...project.modules, idea: { ...project.modules.idea, proposal: { message:'Готовый результат',choices:[],artifactDraft:{title:'Материал',body:'Содержательный материал для проекта.\n'.repeat(1800)},proposedFacts:[] } } } })));
  await flushWrites();
  expect(first.result.current.storageError).toBeNull();
  const exported = first.result.current.exportWorkspace();
  expect(new TextEncoder().encode(exported).byteLength).toBeGreaterThan(4_000_000);
  expect(decodeStoredWorkspace(storage.getItem(STORAGE_KEY)!)).toBe(exported);
  first.unmount();
  const reloaded = renderHook(useWorkspace, { wrapper }); await flushWrites();
  expect(reloaded.result.current.storageError).toBeNull();
  expect(reloaded.result.current.exportWorkspace()).toBe(exported);
  expect(reloaded.result.current.project.modules.idea.messages.at(-1)?.request).toEqual(pending);
  act(()=>reloaded.result.current.importWorkspace(exported)); await flushWrites();
  expect(reloaded.result.current.workspace.projects).toHaveLength(2);
  expect(reloaded.result.current.storageError).toBeNull();
  expect(reloaded.result.current.workspace.projects[0].modules.idea.messages.at(-1)?.request).toEqual(pending);
});

function memoryStorage(initial: string | null = null) {
  let value = initial;
  let quota = false;
  return { getItem: (_key: string) => value, setItem: (_key: string, next: string) => { if (quota) throw new DOMException('full', 'QuotaExceededError'); value = next; }, fail: (next: boolean) => { quota = next; } };
}

it('persists drafts, isolates projects and retains captured project targeting across reload and import', async () => {
  const storage = memoryStorage();
  const wrapper = ({ children }: { children: ReactNode }) => <WorkspaceProvider storage={storage}>{children}</WorkspaceProvider>;
  const hook = renderHook(useWorkspace, { wrapper });
  const first = hook.result.current.project.id;
  act(() => hook.result.current.setProject((project) => ({ ...project, name: 'Первый', modules: { ...project.modules, idea: { ...project.modules.idea, draft: 'Не отправлено' } } })));
  await flushWrites();
  expect(parseWorkspace(storage.getItem(STORAGE_KEY)!).projects[0].modules.idea.draft).toBe('Не отправлено');
  const backup = hook.result.current.exportWorkspace();
  act(() => hook.result.current.addProject());
  const second = hook.result.current.project.id;
  act(() => hook.result.current.setProject((project) => ({ ...project, description: 'Ответ для первого' }), first));
  expect(hook.result.current.project.id).toBe(second);
  expect(hook.result.current.project.description).toBe('');
  act(() => hook.result.current.importWorkspace(backup));
  await flushWrites();
  expect(hook.result.current.workspace.projects).toHaveLength(3);
  expect(hook.result.current.project.id).not.toBe(first);
  expect(hook.result.current.project.modules.idea.draft).toBe('Не отправлено');
  const saved = hook.result.current.exportWorkspace();
  hook.unmount();
  const reload = renderHook(useWorkspace, { wrapper });
  expect(reload.result.current.exportWorkspace()).toBe(saved);
  act(() => reload.result.current.deleteProject(first));
  expect(reload.result.current.workspace.projects.some((project) => project.id === first)).toBe(false);
  expect(reload.result.current.workspace.projects).toHaveLength(2);
});

it('never replaces an edit accepted by a child mount effect with the initial snapshot', async () => {
  const storage = memoryStorage();
  const wrapper = ({ children }: { children: ReactNode }) => <WorkspaceProvider storage={storage}>{children}</WorkspaceProvider>;
  const { result } = renderHook(() => {
    const workspace = useWorkspace();
    useEffect(() => {
      workspace.setProject((project) => ({ ...project, description: 'Принято при открытии' }));
    }, [workspace.setProject]);
    return workspace;
  }, { wrapper });
  await flushWrites();
  expect(result.current.project.description).toBe('Принято при открытии');
  expect(parseWorkspace(storage.getItem(STORAGE_KEY)!).projects[0].description).toBe('Принято при открытии');
});

it('keeps queued draft saves quiet and persists the latest text once the lock is available', async () => {
  const storage = memoryStorage();
  const wrapper = ({ children }: { children: ReactNode }) => <WorkspaceProvider storage={storage}>{children}</WorkspaceProvider>;
  const { result } = renderHook(useWorkspace, { wrapper });
  await flushWrites();
  let release!: () => void;
  const paused = navigator.locks.request(STORAGE_KEY, { mode: 'exclusive' }, () => new Promise<void>(resolve => { release = resolve; }));
  await flushWrites();
  try {
    for (const draft of ['Набираю', 'Набираю и диктую']) {
      act(() => result.current.setProject(project => ({ ...project, modules: {
        ...project.modules, idea: { ...project.modules.idea, draft },
      } })));
      expect(result.current.project.modules.idea.draft).toBe(draft);
      expect(parseWorkspace(result.current.exportWorkspace()).projects[0].modules.idea.draft).toBe(draft);
      expect(result.current.storageError).toBeNull();
      expect(parseWorkspace(storage.getItem(STORAGE_KEY)!).projects[0].modules.idea.draft).toBe('');
    }
  } finally {
    release();
    await paused;
    await flushWrites();
  }
  expect(parseWorkspace(storage.getItem(STORAGE_KEY)!).projects[0].modules.idea.draft).toBe('Набираю и диктую');
  expect(result.current.storageError).toBeNull();
});

it('keeps malformed source bytes for backup and requires an explicit reset before overwriting storage', async () => {
  const raw = '{"version":1,"myPreciousWork":"incomplete';
  const storage = memoryStorage(raw);
  const wrapper = ({ children }: { children: ReactNode }) => <WorkspaceProvider storage={storage}>{children}</WorkspaceProvider>;
  const { result } = renderHook(useWorkspace, { wrapper });
  expect(result.current.storageError).toMatch(/загрузить/);
  expect(result.current.exportStoredBackup()).toBe(raw);
  act(() => result.current.setProject((project) => ({ ...project, description: 'Работа в памяти' })));
  await flushWrites();
  expect(result.current.project.description).toBe('Работа в памяти');
  expect(storage.getItem(STORAGE_KEY)).toBe(raw);
  expect(result.current.storageError).toBeTruthy();
  const current = result.current.exportWorkspace();
  act(() => result.current.importWorkspace('{bad'));
  expect(result.current.exportWorkspace()).toBe(current);
  act(() => result.current.resetStorage());
  await flushWrites();
  expect(result.current.storageError).toBeNull();
  expect(parseWorkspace(storage.getItem(STORAGE_KEY)!).projects[0].description).toBe('Работа в памяти');
  expect(result.current.exportStoredBackup()).toBe(raw);
});

it('retains work after quota errors and does not overwrite another tab without explicit recovery', async () => {
  const storage = memoryStorage();
  const wrapper = ({ children }: { children: ReactNode }) => <WorkspaceProvider storage={storage}>{children}</WorkspaceProvider>;
  const { result } = renderHook(useWorkspace, { wrapper });
  await flushWrites();
  const persisted = storage.getItem(STORAGE_KEY)!;
  storage.fail(true);
  act(() => result.current.setProject((project) => ({ ...project, description: 'Важная работа' })));
  await flushWrites();
  expect(result.current.storageError).toMatch(/заполнено/);
  expect(storage.getItem(STORAGE_KEY)).toBe(persisted);
  expect(parseWorkspace(result.current.exportWorkspace()).projects[0].description).toBe('Важная работа');
  storage.fail(false);
  const other = parseWorkspace(persisted);
  other.projects[0].name = 'Изменение в другой вкладке';
  const otherRaw = JSON.stringify(other);
  storage.setItem(STORAGE_KEY, otherRaw);
  const saveError = result.current.storageError;
  act(() => result.current.setProject((project) => ({ ...project, description: 'Ещё работа' })));
  expect(result.current.storageError).toBe(saveError);
  await flushWrites();
  expect(storage.getItem(STORAGE_KEY)).toBe(otherRaw);
  expect(result.current.storageError).toMatch(/вкладк/);
  expect(result.current.exportStoredBackup()).toBe(otherRaw);
  expect(result.current.project.description).toBe('Ещё работа');
  act(() => result.current.resetStorage());
  await flushWrites();
  expect(result.current.storageError).toBeNull();
  expect(parseWorkspace(storage.getItem(STORAGE_KEY)!).projects[0].description).toBe('Ещё работа');
});

it('serializes two providers under one lock and preserves the competing edit on conflict', async () => {
  const storage = memoryStorage();
  const wrapper = ({ children }: { children: ReactNode }) => <WorkspaceProvider storage={storage}>{children}</WorkspaceProvider>;
  const first = renderHook(useWorkspace, { wrapper });
  await flushWrites();
  const second = renderHook(useWorkspace, { wrapper });
  await flushWrites();
  const locks = navigator.locks;
  let release!: () => void;
  const paused = locks.request('cofounder.workspace.v1', { mode: 'exclusive' }, () => new Promise<void>((resolve) => { release = resolve; }));
  await flushWrites();
  act(() => {
    second.result.current.setProject((project) => ({ ...project, description: 'Правка B' }));
    first.result.current.setProject((project) => ({ ...project, description: 'Правка A' }));
  });
  // Neither writer may enter getItem → setItem while the lock is held.
  expect(parseWorkspace(storage.getItem(STORAGE_KEY)!).projects[0].description).toBe('');
  release();
  await paused;
  await flushWrites();
  expect(parseWorkspace(storage.getItem(STORAGE_KEY)!).projects[0].description).toBe('Правка B');
  expect(second.result.current.storageError).toBeNull();
  expect(first.result.current.storageError).toMatch(/вкладк/);
  expect(first.result.current.project.description).toBe('Правка A');
  expect(parseWorkspace(first.result.current.exportStoredBackup()!).projects[0].description).toBe('Правка B');
  Reflect.deleteProperty(navigator, 'locks');
  act(() => second.result.current.setProject((project) => ({ ...project, description: 'Без блокировки' })));
  await flushWrites();
  expect(second.result.current.storageError).toMatch(/не поддерживает/);
  expect(parseWorkspace(storage.getItem(STORAGE_KEY)!).projects[0].description).toBe('Правка B');
  expect(parseWorkspace(second.result.current.exportWorkspace()).projects[0].description).toBe('Без блокировки');
});
it('rejects malformed calculator imports without changing existing work',async()=>{
 const {createProject}=await import('../../shared/domain');const {calculateMarket,calculateEconomics}=await import('../../shared/calculations');
 const storage=memoryStorage();const wrapper=({children}:{children:ReactNode})=><WorkspaceProvider storage={storage}>{children}</WorkspaceProvider>;
 const {result}=renderHook(useWorkspace,{wrapper});act(()=>result.current.setProject(project=>({...project,name:'Сохранить текущую работу'})));await flushWrites();
 const before=result.current.exportWorkspace();const saved=storage.getItem(STORAGE_KEY);
 const market=calculateMarket({totalBuyers:100,reachableBuyers:40,targetBuyers:10,price:20,period:'месяц'});
 const economics=calculateEconomics({customers:10,price:20,period:'месяц'});
 const corruptions=[{...market,inputs:{...market.inputs,price:null}},{...market,period:42},{...market,inputs:{...market.inputs,price:{...market.inputs.price,source:7}}},{...economics,results:{...economics.results,revenue:{value:200,formula:null,unit:'₽',period:'месяц'}}}];
 for(const [index,corrupt] of corruptions.entries()){
  const imported=createProject();imported.calculations[index===3?'economics':'market']=corrupt;
  act(()=>result.current.importWorkspace(JSON.stringify({version:1,activeProjectId:imported.id,projects:[imported]})));await flushWrites();
  expect(result.current.workspace.projects).toHaveLength(1);expect(result.current.storageError).toMatch(/формат|ошибк/i);expect(result.current.exportWorkspace()).toBe(before);expect(storage.getItem(STORAGE_KEY)).toBe(saved);
 }
 const valid=createProject();valid.calculations={market,economics};act(()=>result.current.importWorkspace(JSON.stringify({version:1,activeProjectId:valid.id,projects:[valid]})));
 expect(result.current.project.calculations).toEqual({market,economics});
});

it('backs up exact legacy bytes durably before migration and refuses a failed backup write', async () => {
  const { createProject } = await import('../../shared/domain');
  const legacy = createProject(); delete legacy.core;
  legacy.facts.price = { key: 'price', value: '5000', provenance: 'hypothesis', note: '' };
  legacy.modules.idea.draft = 'Черновик до миграции';
  const raw = JSON.stringify({ version: 1, activeProjectId: legacy.id, projects: [legacy] });
  const values = new Map([[STORAGE_KEY, raw]]), writes: string[] = [];
  let rejectBackup = true;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { writes.push(key); if (rejectBackup && key !== STORAGE_KEY) throw new DOMException('full', 'QuotaExceededError'); values.set(key, value); } };
  const wrapper = ({ children }: { children: ReactNode }) => <WorkspaceProvider storage={storage}>{children}</WorkspaceProvider>;
  const first = renderHook(useWorkspace, { wrapper }); await flushWrites();
  expect(storage.getItem(STORAGE_KEY)).toBe(raw);
  expect(first.result.current.storageError).toMatch(/заполнено|резерв/);
  expect(first.result.current.exportStoredBackup()).toBe(raw);
  rejectBackup = false;
  act(() => first.result.current.resetStorage()); await flushWrites();
  expect(writes[0]).toBe(`${STORAGE_KEY}.pre-core`);
  expect(storage.getItem(`${STORAGE_KEY}.pre-core`)).toBe(raw);
  expect(parseWorkspace(storage.getItem(STORAGE_KEY)!).projects[0].core!.entries).toHaveLength(1);
  first.unmount();
  const reload = renderHook(useWorkspace, { wrapper });
  expect(reload.result.current.exportStoredBackup()).toBe(raw);
});

it('remaps owned memory on import and disables old paid pending requests without changing snapshots', async () => {
  const { createProject } = await import('../../shared/domain');
  const { archiveMessage, buildCoreContext } = await import('../../shared/coreMemory');
  const original = createProject();
  const source = { id: 'import-user', role: 'user' as const, content: 'Запрос для копии', createdAt: original.createdAt, requestId: 'import-request-001', status: 'pending' as const };
  const incoming = archiveMessage(original, 'idea', source);
  const request = { contractVersion: 2 as const, coreContext: buildCoreContext(incoming, 'idea', source.id), projectId: original.id, requestId: source.requestId, moduleId: 'idea' as const, intent: 'message' as const, message: source.content, context: { name: 'Импорт', description: '', facts: [], artifacts: [], history: [] } };
  incoming.modules.idea.messages.push({ ...source, request });
  const raw = JSON.stringify({ version: 1, activeProjectId: incoming.id, projects: [incoming] });
  const storage = memoryStorage(raw);
  const wrapper = ({ children }: { children: ReactNode }) => <WorkspaceProvider storage={storage}>{children}</WorkspaceProvider>;
  const { result } = renderHook(useWorkspace, { wrapper }); await flushWrites();
  act(() => result.current.importWorkspace(raw));
  const copy = result.current.project;
  expect(copy.id).not.toBe(incoming.id);
  expect(copy.core?.sourceMessages[0].projectId).toBe(copy.id);
  expect(copy.modules.idea.messages[0]).toMatchObject({ status: 'failed', requestError: 'IMPORTED_REQUEST' });
  expect(copy.modules.idea.messages[0].request).toEqual(request);
  expect(result.current.workspace.projects[0].modules.idea.messages[0].request).toEqual(request);
});
