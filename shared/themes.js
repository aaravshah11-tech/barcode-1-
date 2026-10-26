// Themes: MI6 (cyan hologram, the default), CLASSIC (neon green) and RED OPS (red on black).
import { themeColors } from './radar.js';

export const THEMES = [['mi6', 'MI6 hologram'], ['classic', 'CLASSIC neon'], ['redops', 'RED OPS']];
export const DEFAULT_THEME = 'mi6';
export const validTheme = (t) => (THEMES.some(([k]) => k === t) ? t : DEFAULT_THEME);

export function applyTheme(t) {
  t = validTheme(t);
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('sentinel.theme', t); } catch { /* ignore */ }
  themeColors();
  return t;
}
