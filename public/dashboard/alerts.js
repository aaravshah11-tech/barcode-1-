// Settings › Alerts tab — built in a later step.
import { registerTab } from '/dashboard/settings.js';
registerTab('alerts', (body) => { body.innerHTML = '<p class="muted">Coming in a later step.</p>'; });
