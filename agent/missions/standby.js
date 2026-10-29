// STANDBY: connected, doing nothing. Shows a radar sweep while it waits for orders.
export function start(ctx) {
  ctx.root.innerHTML = `<div class="standby">
      <div class="ag-radar big" aria-hidden="true"><i></i><i></i><i></i><span class="sweep"></span><b></b></div>
      <p class="mono standby-title">Awaiting orders</p>
      <p class="small muted">HQ can give this Agent a mission at any time from the Command Centre.</p>
    </div>`;
  ctx.status({ state: 'standing by' });
  return { stop() {} };
}
