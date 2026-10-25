# Adding a mission

A mission is two small pieces:

1. **An entry in `public/shared/missions.js`** — its id, name, what it needs (`camera`, `microphone`, `motion`),
   which Mission Log kinds it may report (`eventKinds`), and its `settings`. The Command Centre builds the
   settings form from this automatically.
2. **A file `public/agent/missions/<id>.js`** that exports `start(ctx)`:

```js
export async function start(ctx) {
  ctx.root.innerHTML = '…';            // draw on the Agent's screen
  ctx.settings;                         // this mission's settings (defaults filled in)
  ctx.report('door', 'Door opened', { angle: 30 });  // tell HQ — text and numbers only
  ctx.status({ state: 'watching', level: 42 });     // live reading shown on the dashboard
  ctx.withTap('Allow sensors', () => …);            // run something that needs a tap (permissions)
  ctx.keepBright(true);                 // stop the screen dimming
  return {
    update(nextSettings) {},            // optional: settings changed on HQ
    onHq(message) {},                   // optional: live dashboard updates (INTEL SCREEN)
    stop() {},                          // release camera/mic/sensors
  };
}
```

**The privacy rule:** never put images, video or audio into `report` or `status`. HQ also drops any long
strings it receives, so a mission can't send a picture even by mistake.
