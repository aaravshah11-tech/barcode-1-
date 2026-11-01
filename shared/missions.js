// The mission catalogue, shared by HQ (server) and Agents (browser).
//
// To add a mission: add an entry here, then create public/agent/missions/<id>.js that exports
// `start(ctx)` (see public/agent/missions/README.md). The dashboard builds the settings form
// from `settings` automatically.
//
// Setting types: number (min, max, step, unit), toggle, select (options), text, grid (on-Agent zone picker).

export const MISSIONS = [
  {
    id: 'standby', name: 'STANDBY', glyph: '◌', needs: [],
    summary: 'Connected but inactive. Waiting for orders.',
    settings: [],
  },
  {
    id: 'motion', name: 'MOTION WATCH', glyph: '◉', needs: ['camera'], eventKinds: ['motion'],
    summary: 'Uses the camera to spot movement. HQ only hears “motion detected”.',
    settings: [
      { key: 'sensitivity', label: 'Sensitivity', type: 'number', min: 1, max: 10, step: 1, default: 6, help: 'Higher catches smaller movements.' },
      { key: 'cooldown', label: 'Cooldown', type: 'number', min: 5, max: 600, step: 5, default: 30, unit: 's', help: 'Quiet time after reporting motion.' },
      { key: 'camera', label: 'Camera', type: 'select', default: 'environment', options: [['environment', 'Back camera'], ['user', 'Front camera']] },
      { key: 'ignore', label: 'Ignore zones', type: 'grid', cols: 8, rows: 6, default: [], help: 'Pick zones on the Agent itself (tap “Ignore zones” on its screen). Only the grid cells are sent, never the picture.' },
    ],
  },
  {
    id: 'perimeter', name: 'PERIMETER WATCH', glyph: '⌂', needs: ['camera'], eventKinds: ['perimeter'], outside: true,
    summary: 'Looks outside through a window. Recognises people, vehicles and animals on the Agent itself. Must have privacy masks before it can be armed.',
    settings: [
      { key: 'watch', label: 'Area it watches', type: 'select', default: 'front', options: [['front', 'Front / driveway'], ['garden', 'Garden'], ['garage', 'Garage / shed']] },
      { key: 'classes', label: 'Report', type: 'select', default: 'people_vehicles', options: [['people', 'People only'], ['people_vehicles', 'People and vehicles'], ['all', 'People, vehicles and animals']] },
      { key: 'sensitivity', label: 'Sensitivity', type: 'number', min: 1, max: 10, step: 1, default: 5, help: 'Higher reacts to smaller movement before checking what it is.' },
      { key: 'confidence', label: 'Minimum certainty', type: 'number', min: 30, max: 90, step: 5, default: 55, unit: '%', help: 'How sure the Agent must be before it says “person” or “vehicle”.' },
      { key: 'cooldown', label: 'Cooldown', type: 'number', min: 10, max: 600, step: 5, default: 45, unit: 's' },
      { key: 'camera', label: 'Camera', type: 'select', default: 'environment', options: [['environment', 'Back camera'], ['user', 'Front camera']], help: 'Changing the camera clears the privacy masks: set them up again on the Agent.' },
      { key: 'mask', label: 'Privacy masks', type: 'grid', cols: 8, rows: 6, default: [], help: 'Blacked out on the Agent before anything is looked at: neighbours, the road, the pavement. Set in the Agent’s setup wizard.' },
      { key: 'ignore', label: 'Ignore zones', type: 'grid', cols: 8, rows: 6, default: [], help: 'Your own property, but not worth reporting (a tree that sways, a flag).' },
      { key: 'masksConfirmed', label: 'Privacy masks confirmed', type: 'toggle', default: false, agentOnly: true },
    ],
  },
  {
    id: 'door', name: 'DOOR TRIPWIRE', glyph: '⊓', needs: ['motion'], eventKinds: ['door'],
    summary: 'Stick the Agent to a door. It feels the door swing using its motion sensors — no camera.',
    settings: [
      { key: 'angle', label: 'Opening angle', type: 'number', min: 5, max: 60, step: 1, default: 12, unit: '°', help: 'How far the door must swing to count as opened.' },
      { key: 'cooldown', label: 'Cooldown', type: 'number', min: 2, max: 300, step: 1, default: 10, unit: 's' },
      { key: 'reportClose', label: 'Also report when it closes', type: 'toggle', default: true },
    ],
  },
  {
    id: 'sound', name: 'SOUND LEVEL', glyph: '◢', needs: ['microphone'], eventKinds: ['sound'],
    summary: 'Measures loudness in decibels on the Agent. Never records — HQ only receives numbers like “72 dB”.',
    settings: [
      { key: 'threshold', label: 'Alert above', type: 'number', min: 40, max: 110, step: 1, default: 75, unit: 'dB' },
      { key: 'minMs', label: 'Must last at least', type: 'number', min: 100, max: 5000, step: 100, default: 300, unit: 'ms' },
      { key: 'cooldown', label: 'Cooldown', type: 'number', min: 2, max: 600, step: 1, default: 20, unit: 's' },
      { key: 'calibration', label: 'Calibration offset', type: 'number', min: 60, max: 130, step: 1, default: 100, unit: 'dB', help: 'Phone mics differ. Raise if readings seem low.' },
    ],
  },
  {
    id: 'light', name: 'LIGHT CHECK', glyph: '☀', needs: ['camera'], eventKinds: ['light'],
    summary: 'Notices lights being switched on or off from the camera’s overall brightness. No images ever leave the Agent.',
    settings: [
      { key: 'threshold', label: 'On/off brightness', type: 'number', min: 5, max: 95, step: 1, default: 35, unit: '%', help: 'Brighter than this counts as lights on.' },
      { key: 'camera', label: 'Camera', type: 'select', default: 'environment', options: [['environment', 'Back camera'], ['user', 'Front camera']] },
    ],
  },
  {
    id: 'panel', name: 'DOOR PANEL', glyph: '◎', needs: [], eventKinds: ['knock'],
    summary: 'Shows one big button. Pressing it alerts HQ — a DIY doorbell.',
    settings: [
      { key: 'label', label: 'Button text', type: 'text', default: 'CALL HQ', max: 24 },
      { key: 'cooldown', label: 'Cooldown', type: 'number', min: 1, max: 120, step: 1, default: 5, unit: 's' },
    ],
  },
  {
    id: 'intel', name: 'INTEL SCREEN', glyph: '▤', needs: [],
    summary: 'Turns the Agent into a wall display of the Command Centre (view only).',
    settings: [
      { key: 'showLog', label: 'Show the Mission Log', type: 'toggle', default: true },
    ],
  },
];

export const missionById = (id) => MISSIONS.find((m) => m.id === id) || null;

/** Is this Agent allowed to raise alerts? Outside Agents must have confirmed privacy masks first (non-negotiable). */
export function armable(agent = {}) {
  const m = missionById(agent.mission);
  if (m?.outside) return !!agent.settings?.masksConfirmed;
  if (agent.place?.zone && m?.needs.includes('camera')) return false; // a camera outside without masks: never armed
  return true;
}
/** Settings the operator may change from HQ (masks and their confirmation are only set on the Agent itself). */
export const hqEditable = (s) => s.type !== 'grid' && !s.agentOnly;

/** Settings for a mission with defaults filled in and values kept within range. */
export function cleanSettings(missionId, input = {}) {
  const m = missionById(missionId);
  const out = {};
  for (const s of m?.settings || []) {
    let v = input[s.key] ?? s.default;
    if (s.type === 'number') { v = Number(v); if (!Number.isFinite(v)) v = s.default; v = Math.min(s.max, Math.max(s.min, v)); }
    else if (s.type === 'toggle') v = !!v;
    else if (s.type === 'select') v = s.options.some(([k]) => k === v) ? v : s.default;
    else if (s.type === 'text') v = String(v ?? '').slice(0, s.max || 60);
    else if (s.type === 'grid') v = Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < s.cols * s.rows))].sort((a, b) => a - b) : [];
    out[s.key] = v;
  }
  return out;
}
