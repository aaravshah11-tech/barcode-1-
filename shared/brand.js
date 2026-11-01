// SENTINEL's own branding (no real agency or TV-show names or marks anywhere).
// The emblem is "Meridian": a broken ring with bearing marks around a centre point.
export const CALLSIGN = 'FIRST DESK';
export const classification = (callsign = CALLSIGN, extra = '') => `SENTINEL // OFFICIAL – HOUSEHOLD // ${String(callsign || CALLSIGN).toUpperCase()}${extra ? ` // ${extra}` : ''}`;
export const CLASSIFICATION = classification();
export const EMBLEM = '<svg class="logo" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M32 3 A29 29 0 1 1 3 32"/><path d="M32 3v10M61 32H51M32 61V51"/><circle cx="32" cy="32" r="11"/><circle cx="32" cy="32" r="2.5" fill="currentColor" stroke="none"/></svg>';
