// STANDBY: connected, doing nothing. Shows a plain status card while it waits for orders.
export function start(ctx) {
  ctx.root.innerHTML = `<div class="standby">
      <p class="standby-title">Standing by</p>
      <p class="small muted">HQ can give this Agent a mission at any time from the Command Centre.</p>
    </div>`;
  ctx.status({ state: 'standing by' });
  return { stop() {} };
}
