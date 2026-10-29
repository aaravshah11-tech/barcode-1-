// The audit trail kept by HQ (see shared/audit.js for how the hash chain works).
import { nextEntry, verifyChain } from '../../shared/audit.js';

export function makeAudit({ db, now }) {
  return {
    add(e) { const entry = nextEntry(db.lastAudit(), db.auditAnchor(), { ts: now(), ...e }); db.addAudit(entry); return entry; },
    list: ({ limit = 300, before = null } = {}) => db.auditEntries({ limit, before }),
    verify: () => verifyChain(db.allAudit(), db.auditAnchor()),
    all: () => db.allAudit(),
  };
}

/** What a request did, in words (never includes PINs, codes or message text). */
export function describe(m, p, body = {}, result = null) {
  const id = (re) => (p.match(re) || [])[1] || '';
  const keys = (o) => Object.keys(o || {}).filter((k) => !/pin|otp|code|secret|session|text/i.test(k)).join(', ');
  const R = (action, target = '', detail = '') => ({ action, target, detail });
  if (p === '/auth/unlock') return R('Sign in', String(body.codename || '').toUpperCase().slice(0, 24));
  if (p === '/auth/lock') return R('Sign out');
  if (p === '/auth/setup') return R('Director account created', String(body.codename || '').toUpperCase());
  if (p === '/auth/change') return R('Own username/PIN changed');
  if (p.startsWith('/auth/totp/')) return R(`Two-step sign-in ${p.split('/').pop()}`);
  if (p === '/auth/sessions' && m === 'GET') return R('Sessions viewed');
  if (p === '/auth/sessions') return R('All other sessions ended');
  if (p.startsWith('/auth/sessions/')) return R('Session ended', id(/\/auth\/sessions\/(.+)$/));
  if (p === '/settings') return body.mode ? R('Alert state changed', String(body.mode).toUpperCase(), body.reason || '') : R('Settings changed', '', keys(body));
  if (p === '/alerts/bulk') return R(`Alerts ${body.action}d (bulk)`, `${(body.ids || []).length} alerts`, body.reason || '');
  if (/^\/alerts\//.test(p)) return R(`Alert ${p.split('/').pop()}`, id(/\/alerts\/([^/]+)/), body.reason || '');
  if (p === '/incidents') return R('Incident opened', result?.ref || '', (body.alertIds || []).join(', '));
  if (/^\/incidents\/[^/]+\/notes$/.test(p)) return R('Incident note added', id(/\/incidents\/([^/]+)/));
  if (/^\/incidents\/[^/]+\/alerts$/.test(p)) return R('Alerts linked to incident', id(/\/incidents\/([^/]+)/), (body.alertIds || []).join(', '));
  if (/^\/incidents\//.test(p)) return R('Incident updated', result?.ref || id(/\/incidents\/([^/]+)/), keys(body));
  if (p === '/users') return R('User added', String(body.username || '').toUpperCase(), body.role || '');
  if (/^\/users\//.test(p)) return R(m === 'DELETE' ? 'User removed' : 'User changed', decodeURIComponent(id(/\/users\/([^/]+)/)), keys(body));
  if (/^\/agents\/[^/]+\/live$/.test(p)) return R(body.on ? 'Live view opened' : 'Live view closed', id(/\/agents\/([^/]+)/));
  if (/^\/agents\/[^/]+\/command$/.test(p)) return R('Agent command', id(/\/agents\/([^/]+)/), body.action || '');
  if (/^\/agents\/[^/]+\/(place|facing)$/.test(p)) return R('Agent position changed', id(/\/agents\/([^/]+)/));
  if (/^\/agents\//.test(p)) return R(m === 'DELETE' ? 'Agent removed' : 'Agent changed', id(/\/agents\/([^/]+)/), keys(body));
  if (p === '/pair') return R(body.role === 'viewer' ? 'Phone link code created' : 'Recruit code created');
  if (/^\/viewers\//.test(p)) return R('Linked phone removed', id(/\/viewers\/([^/]+)/));
  if (p === '/comms') return R('Message sent to Agents', String(body.target || 'all'));
  if (p === '/panic') return R('PANIC raised');
  if (p === '/alarm/stop') return R('Alarm stood down');
  if (p === '/alarm/test') return R('Alarm tested');
  if (p === '/backup') return R('Backup downloaded');
  if (p === '/restore') return R('Backup restored');
  if (p === '/export') return R('Event log exported');
  if (p.startsWith('/audit')) return R(p === '/audit/export' ? 'Audit log exported' : 'Audit log viewed');
  if (p.startsWith('/data/')) return R(`Data: ${p.slice(6)}`, '', keys(body));
  if (p === '/house') return R('Floor plan saved');
  if (/^\/rules\//.test(p)) return R(m === 'DELETE' ? 'Correlation rule deleted' : 'Correlation rule saved', body.name || id(/\/rules\/([^/]+)/));
  if (p.startsWith('/network/')) return R(`Network: ${p.slice(9).replace(/\/[\w-]+$/, '')} ${m === 'DELETE' ? 'removed' : 'changed'}`, body.name || '');
  if (p.startsWith('/reports')) return R(m === 'DELETE' ? 'Report deleted' : 'Report created', result?.ref || '');
  if (p.startsWith('/shift')) return R(body.handover ? 'Handover note written' : p.endsWith('/ack') ? 'Handover acknowledged' : 'Shift log entry written');
  return R(`${m} ${p}`);
}
