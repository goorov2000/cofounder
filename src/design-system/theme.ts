import { useLayoutEffect, useSyncExternalStore } from 'react';
import { DEFAULT_PALETTE, isPalette, PALETTE_KEY, type Palette } from './palettes';
import { updateBrandFavicon } from './brand';

export type ThemePreference = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';
export const THEME_KEY = 'cofounder.theme.v1';
const EVENT = 'cofounder:theme';
let memoryPreference: ThemePreference | undefined;
let memoryPalette: Palette | undefined;

function preference(): ThemePreference {
  if (memoryPreference) return memoryPreference;
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}
function palettePreference(): Palette {
  if (memoryPalette) return memoryPalette;
  try {
    const value = localStorage.getItem(PALETTE_KEY);
    return isPalette(value) ? value : DEFAULT_PALETTE;
  } catch { return DEFAULT_PALETTE; }
}
function snapshot() {
  const mode = preference();
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return `${mode}:${dark ? 'dark' : 'light'}:${palettePreference()}`;
}
function subscribe(update: () => void) {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const storage = (event: StorageEvent) => {
    if (event.key === THEME_KEY || event.key === null) memoryPreference = undefined;
    if (event.key === PALETTE_KEY || event.key === null) memoryPalette = undefined;
    if (event.key === THEME_KEY || event.key === PALETTE_KEY || event.key === null) update();
  };
  window.addEventListener(EVENT, update);
  window.addEventListener('storage', storage);
  media?.addEventListener('change', update);
  return () => {
    window.removeEventListener(EVENT, update);
    window.removeEventListener('storage', storage);
    media?.removeEventListener('change', update);
  };
}
export function setThemePreference(value: ThemePreference) {
  try { localStorage.setItem(THEME_KEY, value); memoryPreference = undefined; }
  catch { memoryPreference = value; }
  window.dispatchEvent(new Event(EVENT));
}
export function setPalettePreference(value: Palette) {
  try { localStorage.setItem(PALETTE_KEY, value); memoryPalette = undefined; }
  catch { memoryPalette = value; }
  window.dispatchEvent(new Event(EVENT));
}
export function useTheme() {
  const value = useSyncExternalStore(subscribe, snapshot, () => `system:light:${DEFAULT_PALETTE}`);
  const [mode, resolved, palette] = value.split(':') as [ThemePreference, Theme, Palette];
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.palette = palette;
    const style = getComputedStyle(document.documentElement);
    const canvas = style.getPropertyValue('--ds-canvas').trim();
    if (canvas) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', canvas);
    updateBrandFavicon(style.getPropertyValue('--ds-favicon-light').trim(), style.getPropertyValue('--ds-favicon-dark').trim());
  }, [resolved, palette]);
  return { preference: mode, resolved, palette, setPreference: setThemePreference, setPalette: setPalettePreference };
}
