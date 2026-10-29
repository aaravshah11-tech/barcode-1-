// Two restrained themes: GRAPHITE (default) and NAVY. Older theme names fall back to graphite.
import { themeColors } from './radar.js';

export const THEMES = [['graphite', 'Graphite'], ['navy', 'Navy']];
export const DEFAULT_THEME = 'graphite';
export const validTheme = (t) => (THEMES.some(([k]) => k === t) ? t : DEFAULT_THEME);

export function applyTheme(t) {
  t = validTheme(t);
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('sentinel.theme', t); } catch { /* ignore */ }
  themeColors();
  return t;
}
