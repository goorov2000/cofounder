import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Palette as PaletteIcon, X } from 'lucide-react';
import { PALETTES } from './palettes';
import { useTheme } from './theme';

export function PalettePicker() {
  const theme = useTheme();
  const groupName = useId();
  return <fieldset className="ds-palette-picker">
    <legend className="sr-only">Цветовая палитра</legend>
    {PALETTES.map(palette => <label className="ds-palette-option" key={palette.id}>
      <span className="ds-palette-preview" data-palette={palette.id} data-theme={theme.resolved} aria-hidden="true">
        <span className="ds-palette-preview-panel"><span /><i /></span>
      </span>
      <span className="ds-palette-option-copy"><strong>{palette.name}</strong><span>{palette.description}</span></span>
      <input type="radio" name={groupName} value={palette.id} aria-label={palette.name} checked={theme.palette === palette.id} onChange={() => theme.setPalette(palette.id)} />
    </label>)}
  </fieldset>;
}

export function PaletteControl() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const theme = useTheme();
  const name = PALETTES.find(palette => palette.id === theme.palette)!.name;
  const position = useCallback(() => {
    if (!trigger.current || !panel.current?.matches(':popover-open')) return;
    const anchor = trigger.current.getBoundingClientRect();
    const { width, height } = panel.current.getBoundingClientRect();
    const rail = trigger.current.closest('.nav-rail')?.getBoundingClientRect();
    const left = rail ? rail.right + 8 : anchor.right - width;
    const top = rail ? anchor.bottom - height : anchor.bottom + 8;
    panel.current.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
    panel.current.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
  }, []);
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, position]);
  return <>
    <button ref={trigger} type="button" className="icon-button palette-toggle" aria-label="Выбрать цветовую палитру" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popoverTarget={id} title={`Цветовая палитра: ${name}`}><PaletteIcon size={21} aria-hidden="true" /></button>
    <div ref={panel} id={id} popover="auto" role="dialog" aria-labelledby={`${id}-title`} className="ds-palette-popover"
      onToggle={event => {
        setOpen(event.newState === 'open');
        if (event.newState === 'open') {
          position();
          panel.current?.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true });
        }
      }}
      onBlur={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) panel.current?.hidePopover();
      }}>
      <div className="ds-palette-popover-heading"><h2 id={`${id}-title`}>Цветовая палитра</h2><button type="button" className="icon-button" aria-label="Закрыть палитру" onClick={() => { panel.current?.hidePopover(); trigger.current?.focus({ preventScroll: true }); }}><X size={17} aria-hidden="true" /></button></div>
      <PalettePicker />
    </div>
  </>;
}
