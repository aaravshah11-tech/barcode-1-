// STANDBY: connected, doing nothing.
export function start(ctx) {
  ctx.root.innerHTML = `<p class="mono">Awaiting orders from HQ.</p><p class="small muted">HQ can give this Agent a mission at any time from the Command Centre.</p>`;
  ctx.status({ state: 'standing by' });
  return { stop() {} };
}
