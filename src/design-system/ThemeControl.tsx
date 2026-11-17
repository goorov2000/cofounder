import { Moon, Sun } from 'lucide-react';
import { useTheme } from './theme';

export function ThemeControl() {
  const theme = useTheme();
  const next = theme.resolved === 'dark' ? 'light' : 'dark';
  const Icon = next === 'dark' ? Moon : Sun;
  const label = next === 'dark' ? 'Включить тёмную тему' : 'Включить светлую тему';
  return <button type="button" className="icon-button theme-toggle" aria-label={label} title={label} onClick={() => theme.setPreference(next)}><Icon size={21} aria-hidden="true" /></button>;
}
