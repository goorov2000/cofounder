import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Compass, GalleryHorizontalEnd, Menu, PanelsTopLeft, Presentation, Route, Settings2, Wrench } from 'lucide-react';
import type { ModuleId, ViewId } from '../../../shared/types';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import { ThemeControl } from '../../design-system/ThemeControl';
import { PaletteControl } from '../../design-system/PaletteControl';
import { BrandMark } from '../../design-system/BrandMark';
import { useMedia } from '../../hooks/useMedia';

export interface AppShellProps {
  children: ReactNode;
  route: ViewId;
  onRouteChange: (view: ViewId) => void;
  activeModule: ModuleId;
  onModuleChange: (module: ModuleId) => void;
  projectName: string;
  routePanel: ReactNode;
  projectControls?: ReactNode;
}
export function AppShell({ children, route, onRouteChange, activeModule, onModuleChange, projectName, routePanel, projectControls }: AppShellProps) {
  const [expanded, setExpanded] = useState(true);
  const [routeVisible, setRouteVisible] = useState(true);
  const [drawer, setDrawer] = useState<'nav' | 'route' | null>(null);
  const narrow = useMedia('(max-width: 899px)');
  const mobile = useMedia('(max-width: 639px)');
  const showRoute = route !== 'workspace' && !narrow && routeVisible;
  useEffect(() => { setDrawer(null); }, [narrow, mobile]);
  const goTo = (view: ViewId) => { onRouteChange(view); setDrawer(null); };
  const goToModule = (module: ModuleId) => { onModuleChange(module); setDrawer(null); };
  const nav = <>
    <a href="#main-content" className="skip-link">К рабочей области</a>
    <div className="brand" aria-label="CoFounder"><span className="brand-mark"><BrandMark size={32} /></span><span className="brand-name">CoFounder<span>мастерская стартапа</span></span></div>
    <nav className="primary-nav" aria-label="Основная навигация">
      {([
        ['workspace', 'Мастерская', Compass],
        ['presentation', 'Презентация', Presentation],
        ['mvp', 'MVP', PanelsTopLeft],
        ['tools', 'Инструменты', Wrench],
        ['gallery', 'Витрина', GalleryHorizontalEnd],
        ['profile', 'Свой стартап', Settings2],
      ] as const).map(([id, label, Icon]) => {
        const active = id === 'mvp' ? route === 'workspace' && activeModule === 'mvp' : route === id && !(id === 'workspace' && activeModule === 'mvp');
        return <button key={id} className={`nav-item${active ? ' is-active' : ''}`} type="button" title={label} aria-label={label} aria-current={active ? 'page' : undefined}
          onClick={() => id === 'mvp' ? goToModule('mvp') : goTo(id)}><Icon size={21} strokeWidth={1.65} /><span>{label}</span></button>;
      })}
    </nav>
    {projectControls && <div className="project-controls" onClick={() => setDrawer(null)}>{projectControls}</div>}
    <div className="nav-footer">
      {!mobile && <div className="nav-bottom"><ThemeControl /><PaletteControl /></div>}
      <div className="nav-footer-row">
        <div className="nav-user"><span className="nav-user-avatar" aria-hidden="true">Г</span><span className="nav-user-name">Григорий</span></div>
        {!mobile && <IconButton className="nav-toggle" label={expanded ? 'Свернуть меню' : 'Развернуть меню'} aria-expanded={expanded} aria-controls="desktop-navigation" onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronLeft size={19} /> : <ChevronRight size={19} />}</IconButton>}
      </div>
    </div>
  </>;
  return <div className={`app-shell${expanded ? ' nav-expanded' : ''}${showRoute ? ' with-route' : ''}`}>
    {!mobile && <aside id="desktop-navigation" className="nav-rail">{nav}</aside>}
    <div className={`app-body${showRoute ? ' has-route' : ''}`}>
    <div className="app-column">
      {(mobile || route !== 'workspace') && <header className="app-header">
        {mobile && <IconButton label="Открыть меню" aria-expanded={drawer === 'nav'} aria-haspopup="dialog" onClick={() => setDrawer('nav')}><Menu size={21} /></IconButton>}
        <div className="project-heading"><h1>{projectName}</h1></div>
        {mobile && <><ThemeControl /><PaletteControl /></>}
        {route !== 'workspace' && <IconButton className="route-toggle" label={narrow ? 'Открыть маршрут' : routeVisible ? 'Скрыть маршрут' : 'Показать маршрут'} aria-expanded={narrow ? drawer === 'route' : routeVisible} aria-controls={narrow ? undefined : 'project-route'} aria-haspopup={narrow ? 'dialog' : undefined} onClick={() => narrow ? setDrawer('route') : setRouteVisible(!routeVisible)}><Route size={21} /></IconButton>}
      </header>}
      <main id="main-content" tabIndex={-1} className="main-content">{children}</main>
    </div>
    {showRoute && <aside id="project-route" className="route-panel" aria-label="Маршрут проекта">{routePanel}</aside>}
    </div>
    <Modal open={drawer === 'nav'} title="Навигация" onClose={() => setDrawer(null)} className="nav-drawer"><div className="mobile-navigation">{nav}</div></Modal>
    <Modal open={drawer === 'route'} title="Маршрут проекта" onClose={() => setDrawer(null)} className="route-drawer"><div onClick={(event) => { if ((event.target as HTMLElement).closest('button[data-module]:not([aria-disabled="true"])')) setDrawer(null); }}>{routePanel}</div></Modal>
  </div>;
}
