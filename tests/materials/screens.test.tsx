import { render, screen, fireEvent } from '@testing-library/react';
import { describe,it,expect,vi } from 'vitest';
import { WorkspaceProvider } from '../../src/state';
import { ProfileScreen, ToolsScreen, GalleryScreen } from '../../src/features/materials';
import { createProject } from '../../shared/domain';
import { serializeWorkspace } from '../../shared/validation';
const mount=(node:React.ReactNode)=>render(<WorkspaceProvider>{node}</WorkspaceProvider>);
it('recognizes automatic MVP drafts and existing conversation context without requiring a saved card',()=>{
 const p=createProject();
 p.modules.mvp.proposal={message:'Полный бриф.',choices:[],artifactDraft:{title:'Бриф MVP',body:'Сценарии, данные, границы и приёмка.'},proposedFacts:[]};
 p.modules.market.memory={updatedAt:p.createdAt,needsRefresh:true,content:{facts:[],hypotheses:['Условный рынок.'],openQuestions:[]}};
 localStorage.setItem('cofounder.workspace.v1',serializeWorkspace({version:1,activeProjectId:p.id,projects:[p]}));
 mount(<ProfileScreen/>);
 expect(screen.getByText(/Рабочее описание MVP — в контексте проекта/)).toBeVisible();
 expect(screen.getByText('Описание MVP · В контексте проекта')).toBeVisible();
 expect(screen.getByText('Размер рынка · Контекст требует пересмотра')).toBeVisible();
 expect(screen.queryByText(/Описание MVP ещё не сохранено/)).toBeNull();
 expect(p.modules.mvp.artifact).toBeNull();
});
describe('materials user actions',()=>{
 it('rejects unsafe prototype and keeps profile editable',()=>{mount(<ProfileScreen/>);fireEvent.change(screen.getByLabelText('Ссылка на прототип'),{target:{value:'javascript:alert(1)'}});fireEvent.click(screen.getByRole('button',{name:'Сохранить профиль'}));expect(screen.getByText('Адрес прототипа должен начинаться с http:// или https://.')).toBeVisible();expect(screen.queryByRole('link',{name:'Открыть прототип'})).toBeNull();});
 it('opens immediately available tools and explains gated interviews',()=>{const open=vi.fn();mount(<ToolsScreen onOpenModule={open}/>);fireEvent.click(screen.getByRole('button',{name:'Открыть Основы'}));expect(open).toHaveBeenCalledWith('basics');expect(screen.getByRole('button',{name:'Открыть Интервью'})).toBeDisabled();expect(screen.getByText(/MVP не требуется/)).toBeVisible();});
 it('opens a fictional card and creates a separate project',()=>{mount(<GalleryScreen/>);fireEvent.click(screen.getByRole('button',{name:'Посмотреть пример'}));fireEvent.click(screen.getByRole('button',{name:'Создать отдельную копию примера'}));expect(screen.getByText(/Отдельная копия примера создана/)).toBeVisible();});
});
it('shows gallery storage failures instead of hiding local saving errors',()=>{
 render(<WorkspaceProvider storage={{getItem:()=>{throw new Error('blocked');},setItem:()=>{}}}><GalleryScreen/></WorkspaceProvider>);
 expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить сохранённые данные');
});
