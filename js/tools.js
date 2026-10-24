// ============================================================
// Tool registry. Each tool lives in js/tools/<id>/index.js and
// exports default { routes, nav, exports }.
//
// To add a new tool: make a folder with an index.js, then add
// one line here. It appears on the start menu automatically.
//
// Optional `hooks`: a small module with search(q) and/or reminders(now)
// so the tool shows up in the start menu search and on the Reminders
// screen without loading the whole tool.
// ============================================================
export const TOOLS = [
  { id: 'library', name: 'Library', emoji: '📚', color: '#b4532a', dark: '#e3804f', desc: 'Scan and find books in the house', load: () => import('./tools/library/index.js'), hooks: () => import('./tools/library/hooks.js') },
  { id: 'inventory', name: 'Inventory', emoji: '📦', color: '#2f6f8f', dark: '#5fb0d6', desc: 'Track stuff, boxes and cupboards', load: () => import('./tools/inventory/index.js'), hooks: () => import('./tools/inventory/hooks.js') },
  { id: 'pantry', name: 'Pantry', emoji: '🥫', color: '#5b7a1f', dark: '#a7cf5b', desc: 'Food, use-by dates and the shopping list', load: () => import('./tools/pantry/index.js'), hooks: () => import('./tools/pantry/hooks.js') },
  { id: 'warranties', name: 'Warranties & documents', emoji: '🧾', color: '#46578a', dark: '#9fb2e8', desc: 'Receipts, warranty end dates, manuals and where the box is', load: () => import('./tools/warranties/index.js'), hooks: () => import('./tools/warranties/hooks.js') },
  { id: 'sports', name: 'Sports', emoji: '🏆', color: '#2e7d4f', dark: '#5cc489', desc: 'Rugby, cricket, hockey stats & match photography', load: () => import('./tools/sports/index.js'), hooks: () => import('./tools/sports/hooks.js') },
  // Match Photography is opened from the Sports menu (hidden from the start menu).
  { id: 'photo', name: 'Match Photography', emoji: '📸', color: '#a8324a', dark: '#ef7f95', desc: 'Touchline assistant for your camera', parent: 'sports', hidden: true, load: () => import('./tools/photo/index.js') },
  { id: 'golf', name: 'Golf Swing', emoji: '⛳', color: '#6b4fa8', dark: '#a98ce6', desc: 'Record and analyse swings with motion sensors', load: () => import('./tools/golf/index.js'), hooks: () => import('./tools/golf/hooks.js') },
  { id: 'reminders', name: 'Reminders', emoji: '🔔', color: '#8a5300', dark: '#f0b45a', desc: 'Lent-out things, warranties, food dates, upcoming matches', load: () => import('./tools/reminders/index.js') },
  { id: 'settings', name: 'Settings', emoji: '⚙️', color: '#5a5550', dark: '#b7afa5', desc: 'Locations, teams, pairing, backup', load: () => import('./settings/index.js') },
];

export const toolById = (id) => TOOLS.find((t) => t.id === id);

const cache = new Map();
export async function loadTool(id) {
  const t = toolById(id);
  if (!t) return null;
  if (!cache.has(id)) cache.set(id, t.load().then((m) => m.default));
  return cache.get(id);
}

/** Load every tool's hooks (search / reminders). Small modules, loaded once. */
const hookCache = new Map();
export function loadHooks() {
  return Promise.all(TOOLS.filter((t) => t.hooks).map((t) => {
    if (!hookCache.has(t.id)) hookCache.set(t.id, t.hooks().catch((e) => { console.warn(`${t.id} hooks`, e); return {}; }));
    return hookCache.get(t.id).then((h) => ({ tool: t, ...h }));
  }));
}
