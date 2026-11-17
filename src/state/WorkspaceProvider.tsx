import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Project, Workspace } from '../../shared/types';
import { importProjectCopy } from '../../shared/coreMemory';
import { createDemoProject, createProject } from '../../shared/domain';
import { MAX_PROJECTS, parseWorkspace, serializeWorkspace } from '../../shared/validation';
import { decodeStoredWorkspace, encodeStoredWorkspace } from './workspaceStorage';

export const STORAGE_KEY = 'cofounder.workspace.v1';
export const MIGRATION_BACKUP_KEY = `${STORAGE_KEY}.pre-core`;
export interface WorkspaceContextValue {
  workspace: Workspace; project: Project; storageError: string | null;
  setProject: (updater: (project: Project) => Project, projectId?: string) => boolean;
  selectProject: (id: string) => void;
  addProject: (demo?: boolean) => void;
  deleteProject: (id: string) => void;
  exportWorkspace: () => string;
  importWorkspace: (raw: string) => void;
  exportStoredBackup: () => string | null;
  resetStorage: () => void;
}
export type WorkspaceStorage = Pick<Storage, 'getItem' | 'setItem'>;
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
function emptyWorkspace(): Workspace {
  const project = createProject();
  return { version: 1, projects: [project], activeProjectId: project.id };
}
function loadWorkspace(provided?: WorkspaceStorage | null) {
  let storage: WorkspaceStorage | null = null;
  let raw: string | null = null;
  try {
    storage = provided === undefined ? (typeof window === 'undefined' ? null : window.localStorage) : provided;
    if (!storage) throw new Error('Хранилище браузера недоступно.');
    raw = storage.getItem(STORAGE_KEY);
    const decoded = raw === null ? null : decodeStoredWorkspace(raw);
    const workspace = decoded === null ? emptyWorkspace() : parseWorkspace(decoded);
    const migrationRaw = decoded && (JSON.parse(decoded) as Workspace).projects.some(project => !project.core) ? raw : null;
    return { storage, raw, workspace, migrationRaw, durableBackup: storage.getItem(MIGRATION_BACKUP_KEY), error: null as string | null };
  } catch {
    return { storage, raw, migrationRaw: null, durableBackup: null, workspace: emptyWorkspace(), error: 'Не удалось загрузить сохранённые данные. Исходная запись не удалена. Работа доступна в текущей сессии; экспортируйте резервную копию.' };
  }
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : 'Не удалось сохранить изменение.'; }
export function WorkspaceProvider({ children, storage }: { children: ReactNode; storage?: WorkspaceStorage | null }) {
  const [initial] = useState(() => loadWorkspace(storage));
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [storageError, setStorageError] = useState<string | null>(initial.error);
  const current = useRef(workspace);
  const backup = useRef(initial.durableBackup ?? initial.raw);
  const migrationRaw = useRef(initial.migrationRaw);
  const lastSaved = useRef(initial.raw);
  const blocked = useRef(initial.error);
  const writeRevision = useRef(0);
  const persist = useCallback((next: Workspace, force = false) => {
    const revision = ++writeRevision.current;
    try {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      if (!locks?.request) throw new Error('Браузер не поддерживает безопасную блокировку хранилища. Работа остаётся в памяти; скачайте экспорт JSON перед закрытием страницы. Существующие данные не изменены.');
      // Waiting for an autosave is not an error. Keep any existing failure visible
      // until a write succeeds, without flashing alert banners on every draft edit.
      // The read/compare/write transaction must use the same origin-wide lock in every tab.
      // A separate getItem check is not a compare-and-swap and can lose another tab's edit.
      void locks.request(STORAGE_KEY, { mode: 'exclusive' }, () => {
        if (revision !== writeRevision.current && !force) return;
        if (blocked.current && !force) {
          setStorageError(`${blocked.current} Автосохранение остановлено. Экспортируйте текущую работу и исходную запись. Для нового сохранения явно подтвердите восстановление хранилища.`);
          return;
        }
        if (!initial.storage) throw new Error('Хранилище недоступно.');
        const stored = initial.storage.getItem(STORAGE_KEY);
        if (!force && stored !== lastSaved.current) {
          backup.current = stored;
          blocked.current = 'Данные изменены в другой вкладке. Её запись сохранена без изменений; текущая работа остаётся в этой сессии.';
          setStorageError(blocked.current);
          return;
        }
        const raw = encodeStoredWorkspace(serializeWorkspace(next));
        if (force && stored !== raw) backup.current = stored;
        if (migrationRaw.current) {
          const existingBackup = initial.storage.getItem(MIGRATION_BACKUP_KEY);
          if (existingBackup !== null && existingBackup !== migrationRaw.current) throw new Error('Резерв миграции уже занят. Экспортируйте исходную запись.');
          if (existingBackup === null) initial.storage.setItem(MIGRATION_BACKUP_KEY, migrationRaw.current);
          if (initial.storage.getItem(MIGRATION_BACKUP_KEY) !== migrationRaw.current) throw new Error('Не удалось проверить резерв миграции.');
          backup.current = migrationRaw.current;
        }
        initial.storage.setItem(STORAGE_KEY, raw);
        migrationRaw.current = null;
        lastSaved.current = raw;
        blocked.current = null;
        setStorageError(null);
      }).catch(() => {
        setStorageError('Не удалось сохранить данные в браузере: хранилище недоступно или заполнено, либо блокировка отклонена. Текущая работа остаётся в сессии; скачайте экспорт JSON перед закрытием страницы. Старые данные не удалены.');
      });
    } catch (error) {
      setStorageError(errorText(error));
    }
  }, [initial]);
  const commit = useCallback((next: Workspace) => {
    try {
      const validated = parseWorkspace(serializeWorkspace(next));
      current.current = validated;
      setWorkspace(validated);
      // State and exports update synchronously; durable writes are queued under Web Locks.
      persist(validated);
      return true;
    } catch (error) { setStorageError(errorText(error)); return false; }
  }, [persist]);
  useEffect(() => { if (!initial.error) persist(current.current); }, [initial, persist]);
  const setProject = useCallback((updater: (project: Project) => Project, projectId?: string) => {
    try {
      const before = current.current;
      const id = projectId ?? before.activeProjectId;
      const previous = before.projects.find((project) => project.id === id);
      if (!previous) throw new Error('Проект уже удалён. Ответ не перенесён в другой проект.');
      const updated = updater(structuredClone(previous));
      if (updated.id !== id) throw new Error('Нельзя изменить идентификатор проекта.');
      return commit({ ...before, projects: before.projects.map((project) => project.id === id ? { ...updated, updatedAt: new Date().toISOString() } : project) });
    } catch (error) { setStorageError(errorText(error)); return false; }
  }, [commit]);
  const selectProject = useCallback((id: string) => {
    if (current.current.projects.some((project) => project.id === id)) commit({ ...current.current, activeProjectId: id });
  }, [commit]);
  const addProject = useCallback((demo = false) => {
    if (current.current.projects.length >= MAX_PROJECTS) { setStorageError(`Можно хранить до ${MAX_PROJECTS} проектов. Экспортируйте резервную копию и явно удалите ненужный проект, чтобы добавить новый.`); return; }
    const project = demo ? createDemoProject() : createProject();
    commit({ ...current.current, activeProjectId: project.id, projects: [...current.current.projects, project] });
  }, [commit]);
  const deleteProject = useCallback((id: string) => {
    const before = current.current;
    const projects = before.projects.filter((project) => project.id !== id);
    if (projects.length === before.projects.length) return;
    if (!projects.length) { commit(emptyWorkspace()); return; }
    commit({ ...before, projects, activeProjectId: before.activeProjectId === id ? projects[0].id : before.activeProjectId });
  }, [commit]);
  const exportWorkspace = useCallback(() => serializeWorkspace(current.current), []);
  const importWorkspace = useCallback((raw: string) => {
    try {
      const incoming = parseWorkspace(raw);
      const before = current.current;
      if (before.projects.length + incoming.projects.length > MAX_PROJECTS) throw new Error(`Импорт превысит лимит ${MAX_PROJECTS} проектов. Экспортируйте копию и явно удалите ненужные проекты. Ничего не удалено.`);
      const ids = new Set(before.projects.map((project) => project.id));
      let activeProjectId = incoming.activeProjectId;
      const projects = incoming.projects.map((project) => {
        const id = ids.has(project.id) ? globalThis.crypto.randomUUID() : project.id;
        ids.add(id);
        if (project.id === incoming.activeProjectId) activeProjectId = id;
        return importProjectCopy(project, id);
      });
      commit({ ...before, activeProjectId, projects: [...before.projects, ...projects] });
    } catch (error) { setStorageError(errorText(error)); }
  }, [commit]);
  const exportStoredBackup = useCallback(() => backup.current, []);
  const resetStorage = useCallback(() => { persist(current.current, true); }, [persist]);
  const value = useMemo<WorkspaceContextValue>(() => ({
    workspace, project: workspace.projects.find((project) => project.id === workspace.activeProjectId)!, storageError,
    setProject, selectProject, addProject, deleteProject, exportWorkspace, importWorkspace, exportStoredBackup, resetStorage,
  }), [workspace, storageError, setProject, selectProject, addProject, deleteProject, exportWorkspace, importWorkspace, exportStoredBackup, resetStorage]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace должен использоваться внутри WorkspaceProvider.');
  return context;
}
