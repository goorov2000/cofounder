export const PALETTES = [
  { id: 'sber', name: 'Сбер', description: 'Зелёная' },
  { id: 'sber-business', name: 'СберБизнес', description: 'Бирюзовая' },
  { id: 'plasma', name: 'Плазма', description: 'Синяя' },
  { id: 'giga', name: 'Гига', description: 'Графитовая' },
  { id: 'iris', name: 'Ирис', description: 'Фиолетовая' },
] as const;

export type Palette = typeof PALETTES[number]['id'];
export const DEFAULT_PALETTE: Palette = 'sber-business';
export const PALETTE_KEY = 'cofounder.palette.v1';
export function isPalette(value: unknown): value is Palette {
  return PALETTES.some(palette => palette.id === value);
}
