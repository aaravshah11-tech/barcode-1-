// Cloud-sync test: two browsers (computer + phone) run the real Supabase sync code
// against a stand-in Supabase that lives in this Node process and follows the same
// rules as supabase/schema.sql (households, join codes, membership, newest-wins, seq).
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8080/';
let failures = 0;
const check = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };

const server = { households: new Map(), members: new Set(), info: new Map(), users: new Map(), otps: new Map(), records: new Map(), seq: 0, pages: [] };
const emailOf = (u) => server.users.get(u)?.email || null;
const userByEmail = (e) => [...server.users.entries()].find(([, v]) => v.email === e)?.[0];
function handle(page, raw) {
  const { op, a, user } = JSON.parse(raw);
  const ok = (data) => JSON.stringify({ data, error: null });
  const err = (message) => JSON.stringify({ data: null, error: { message } });
  if (op === 'rpc') {
    const { name, args } = a;
    if (!user) return err('Not signed in');
    if (name === 'create_household') {
      const id = crypto.randomUUID(), join_code = crypto.randomUUID().replace(/-/g, '');
      server.households.set(id, { id, join_code });
      server.members.add(`${id}|${user}`);
      server.info.set(`${id}|${user}`, { device: args.p_device, name: null, at: Date.now() });
      return ok({ id, join_code });
    }
    if (name === 'join_household') {
      const h = server.households.get(args.p_household);
      if (!h || h.join_code !== args.p_code) return err('Pairing code not valid');
      server.members.add(`${h.id}|${user}`);
      const k = `${h.id}|${user}`;
      server.info.set(k, { ...(server.info.get(k) || { name: null, at: Date.now() }), device: args.p_device });
      return ok(true);
    }
    if (name === 'set_my_name') {
      const k = `${args.p_household}|${user}`;
      if (!server.members.has(k)) return err('Not a member');
      server.info.get(k).name = args.p_name.trim() || null;
      return ok(true);
    }
    if (name === 'my_households') return ok([...server.households.values()].filter((h) => server.members.has(`${h.id}|${user}`)).map((h) => ({ id: h.id, name: 'Home', join_code: h.join_code })));
    if (name === 'household_people') {
      if (!server.members.has(`${args.p_household}|${user}`)) return err('Not a member');
      return ok([...server.info.entries()].filter(([k]) => k.startsWith(args.p_household + '|')).sort((x, y) => x[1].at - y[1].at)
        .map(([k, v]) => { const u = k.split('|')[1]; return { user_id: u, display_name: v.name, device_name: v.device, email: emailOf(u), is_me: u === user }; }));
    }
    return err(`function ${name} does not exist`);
  }
  if (op === 'auth') {
    // Stand-in for Supabase email codes: the "email" always contains 123456.
    if (a.fn === 'getUser') return ok({ user: user ? { id: user, email: emailOf(user), is_anonymous: !emailOf(user) } : null });
    if (a.fn === 'updateUser') {
      if (userByEmail(a.email)) return err('A user with this email address has already been registered');
      server.otps.set(a.email, { type: 'email_change', user });
      return ok({});
    }
    if (a.fn === 'signInWithOtp') {
      const existing = userByEmail(a.email);
      if (!existing && !a.create) return err('Signups not allowed for otp');
      server.otps.set(a.email, { type: 'email', user: existing || crypto.randomUUID() });
      return ok({});
    }
    if (a.fn === 'verifyOtp') {
      const o = server.otps.get(a.email);
      if (!o || a.token !== '123456' || o.type !== a.type) return err('Token has expired or is invalid');
      server.otps.delete(a.email);
      server.users.set(o.user, { email: a.email });
      return ok({ user: o.user });
    }
  }
  if (op === 'upsert') {
    for (const r of a.rows) {
      if (!server.members.has(`${r.household_id}|${user}`)) return err('new row violates row-level security policy');
      const k = `${r.household_id}|${r.collection}|${r.id}`;
      const old = server.records.get(k);
      if (old && (r.updated_at < old.updated_at || (r.updated_at === old.updated_at && r.updated_by <= old.updated_by))) continue;
      const row = { ...r, seq: ++server.seq };
      server.records.set(k, row);
      for (const p of server.pages) p.evaluate((x) => window.__sbPush?.(x), row).catch(() => {});
    }
    return ok(null);
  }
  if (op === 'select') {
    if (!server.members.has(`${a.hh}|${user}`)) return ok([]);
    const rows = [...server.records.values()].filter((r) => r.household_id === a.hh && r.seq > a.gt).sort((x, y) => x.seq - y.seq).slice(0, a.limit);
    return ok(rows);
  }
  return err('unknown op');
}

const fakeClient = () => {
  window.supabase = {
    createClient() {
      const call = (op, a) => window.sbServer(JSON.stringify({ op, a, user: localStorage.getItem('fakeUser') })).then(JSON.parse);
      const channels = [];
      window.__sbPush = (row) => { if (navigator.onLine) channels.forEach((ch) => ch.handlers.forEach((h) => h({ new: row }))); };
      return {
        auth: {
          getSession: async () => ({ data: { session: localStorage.getItem('fakeUser') ? { user: {} } : null } }),
          signInAnonymously: async () => { localStorage.setItem('fakeUser', crypto.randomUUID()); return { data: { session: {} }, error: null }; },
          signOut: async () => ({}),
          getUser: () => call('auth', { fn: 'getUser' }),
          updateUser: ({ email }) => call('auth', { fn: 'updateUser', email }),
          signInWithOtp: ({ email, options }) => call('auth', { fn: 'signInWithOtp', email, create: options?.shouldCreateUser !== false }),
          verifyOtp: async ({ email, token, type }) => { const r = await call('auth', { fn: 'verifyOtp', email, token, type }); if (!r.error) localStorage.setItem('fakeUser', r.data.user); return r; },
        },
        rpc: (name, args) => call('rpc', { name, args }),
        from: () => ({
          upsert: (rows) => (navigator.onLine ? call('upsert', { rows }) : Promise.resolve({ error: { message: 'Failed to fetch' } })),
          select: () => { const q = {}; const b = { eq: (k, v) => { q.hh = v; return b; }, gt: (k, v) => { q.gt = v; return b; }, order: () => b, limit: (n) => { q.limit = n; return call('select', q); } }; return b; },
        }),
        channel: () => {
          const ch = {
            handlers: [],
            on(type, f, cb) { if (type === 'postgres_changes') this.handlers.push(cb); return this; },
            subscribe(cb) { channels.push(this); setTimeout(() => cb('SUBSCRIBED'), 20); return this; },
            presenceState: () => ({}), track: async () => {}, unsubscribe: async () => { channels.splice(channels.indexOf(ch), 1); },
          };
          return ch;
        },
      };
    },
  };
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (opts) => {
    const ctx = await browser.newContext(opts);
    await ctx.addInitScript(fakeClient);
    const page = await ctx.newPage();
    await page.exposeFunction('sbServer', (raw) => handle(page, raw));
    page.on('pageerror', (e) => errors.push(e.message));
    if (process.env.DEBUG) page.on('console', (m) => console.log('  [' + (opts.isMobile ? 'phone' : 'comp') + ' console]', m.text().slice(0, 300)));
    server.pages.push(page);
    return { ctx, page };
  };
  const { page: comp } = await mk({ viewport: { width: 1280, height: 820 } });
  const { ctx: pctx, page: phone } = await mk({ viewport: { width: 390, height: 844 }, isMobile: true });

  // Computer: add a book first, then set up cloud sync.
  await comp.goto(BASE + '?nosw#/');
  await comp.waitForSelector('.menu-grid');
  await comp.evaluate(async () => (await import('./js/core/store.js')).put('books', { id: 'pre', title: 'Before Sync' }));
  await comp.goto(BASE + '?nosw#/settings/pair');
  await comp.click('[data-cloud-setup]');
  await comp.fill('[data-cloud-form] input[name=url]', 'https://demo-project.supabase.co');
  await comp.fill('[data-cloud-form] textarea[name=key]', 'eyJfake.anon.key');
  await comp.click('[data-cloud-form] button');
  await comp.waitForSelector('[data-qr] svg', { timeout: 10000 });
  check(server.households.size === 1, 'computer created a household');
  await comp.waitForFunction(() => document.querySelector('#sync-pill')?.textContent === 'Synced', null, { timeout: 10000 });
  check([...server.records.values()].some((r) => r.id === 'pre'), 'existing data uploaded');
  const pairUrl = await comp.evaluate(async () => (await import('./js/sync/manager.js')).pairingUrl());
  check(/#\/pair\/[A-Za-z0-9_-]+$/.test(pairUrl), 'QR holds a pairing link');

  // Bad code is refused nicely.
  await phone.goto(BASE + '?nosw#/');
  await phone.waitForSelector('.menu-grid');
  const bad = pairUrl.replace(/#\/pair\/.*/, '#/pair/' + Buffer.from(JSON.stringify({ t: 'sb', u: 'https://demo-project.supabase.co', k: 'k', h: [...server.households.keys()][0], j: 'nope' })).toString('base64url'));
  await phone.goto(bad.replace('http://127.0.0.1:8080/', BASE + '?nosw'));
  await phone.waitForSelector('text=isn’t valid any more', { timeout: 10000 });
  check(true, 'wrong join code gives a friendly error');

  // Phone opens the real pairing link.
  await phone.goto(pairUrl.replace('http://127.0.0.1:8080/', BASE + '?nosw'));
  await phone.waitForSelector('text=Cloud sync is on', { timeout: 10000 });
  await phone.waitForFunction(async () => !!(await import('./js/core/store.js')).get('books', 'pre'), null, { timeout: 10000 });
  check(true, 'phone joined and downloaded existing data');

  // Live: phone -> computer
  await phone.evaluate(async () => (await import('./js/core/store.js')).put('books', { id: 'live', title: 'Scanned On Phone' }));
  await phone.waitForTimeout(1500);
  if (process.env.DEBUG) {
    console.log('server has live:', [...server.records.values()].some((r) => r.id === 'live'));
    console.log('phone state:', JSON.stringify(await phone.evaluate(async () => (await import('./js/sync/manager.js')).getState())));
    console.log('comp has live:', await comp.evaluate(async () => !!(await import('./js/core/store.js')).get('books', 'live')));
  }
  await comp.waitForSelector('.toast >> text=Scanned On Phone', { timeout: 10000 });
  check(true, 'book added on phone appears live on computer');

  // Offline on phone: change is queued, then uploaded when back online.
  await pctx.setOffline(true);
  await phone.evaluate(() => window.dispatchEvent(new Event('offline')));
  await phone.evaluate(async () => (await import('./js/core/store.js')).put('items', { id: 'off', name: 'Offline Tent' }));
  await phone.waitForTimeout(800);
  check(![...server.records.values()].some((r) => r.id === 'off'), 'offline change is not uploaded yet');
  const pending = await phone.evaluate(async () => (await import('./js/sync/manager.js')).getState().pending);
  check(pending >= 1, `offline change waits in the outbox (${pending})`);
  await pctx.setOffline(false);
  await phone.evaluate(() => window.dispatchEvent(new Event('online')));
  await comp.waitForSelector('.toast >> text=Offline Tent', { timeout: 10000 });
  check(true, 'queued change uploads after reconnecting and reaches the computer');

  // Conflict: newest edit wins on both sides.
  await comp.evaluate(async () => { const s = await import('./js/core/store.js'); await s.patch('books', 'live', { title: 'Edited On Computer' }); });
  await phone.waitForFunction(async () => (await import('./js/core/store.js')).get('books', 'live')?.title === 'Edited On Computer', null, { timeout: 10000 });
  check(true, 'edit on computer reaches phone');

  // ---- Names + optional email sign-in ----
  await comp.goto(BASE + '?nosw#/settings/account');
  await comp.fill('[data-name] input', 'Mum');
  await comp.click('[data-name] button');
  await comp.waitForSelector('text=Mum (you)');
  check(true, 'computer: name saved and shown in the household list');
  await comp.fill('[data-email] input', 'mum@example.com');
  await comp.click('[data-email] button');
  await comp.waitForSelector('[data-code] input');
  await comp.fill('[data-code] input', '000000');
  await comp.click('[data-code] button');
  await comp.waitForSelector('text=That code is wrong or has expired');
  check(true, 'wrong code: friendly message');
  await comp.fill('[data-code] input', '123456');
  await comp.click('[data-code] button');
  await comp.waitForSelector('text=Signed in as mum@example.com');
  const compUser = await comp.evaluate(() => localStorage.getItem('fakeUser'));
  check(server.users.get(compUser)?.email === 'mum@example.com', 'anonymous account upgraded in place (same account, still in the household)');
  await phone.goto(BASE + '?nosw#/settings/account');
  await phone.fill('[data-name] input', 'Aarav');
  await phone.click('[data-name] button');
  await phone.waitForSelector('text=Aarav (you)');
  const list = (await phone.textContent('.list')).replace(/\s+/g, ' ');
  check(list.includes('Mum') && list.includes('mum@example.com') && list.includes('Aarav (you)'), `phone sees everyone by name: ${list.trim()}`);
  // "Added by" uses the synced names
  await phone.evaluate(async () => (await import('./js/core/store.js')).put('books', { id: 'byme', title: 'Phone Book', addedAt: Date.now() }));
  await comp.waitForFunction(async () => { const s = await import('./js/core/store.js'); return !!s.get('books', 'byme') && !!s.all('profiles').find((p) => p.name === 'Aarav'); }, null, { timeout: 10000 });
  await comp.goto(BASE + '?nosw#/library/book/byme');
  await comp.waitForSelector('text=by Aarav');
  check(true, 'computer shows “added by Aarav” on the phone’s book');
  // A new device signs in with email instead of scanning a QR code
  const { page: tablet } = await mk({ viewport: { width: 820, height: 1100 } });
  await tablet.goto(BASE + '?nosw#/settings/pair');
  await tablet.click('[data-cloud-setup]');
  await tablet.click('[data-email-start]');
  await tablet.fill('[data-email-form] [name=url]', 'https://demo-project.supabase.co');
  await tablet.fill('[data-email-form] [name=key]', 'eyJfake.anon.key');
  await tablet.fill('[data-email-form] [name=email]', 'nobody@example.com');
  await tablet.click('[data-email-form] button');
  await tablet.waitForSelector('text=no HomeBase account with that email');
  check(true, 'unknown email: friendly message');
  await tablet.fill('[data-email-form] [name=url]', 'https://demo-project.supabase.co');
  await tablet.fill('[data-email-form] [name=key]', 'eyJfake.anon.key');
  await tablet.fill('[data-email-form] [name=email]', 'mum@example.com');
  await tablet.click('[data-email-form] button');
  await tablet.fill('[data-email-code] input', '123456');
  await tablet.click('[data-email-code] button');
  await tablet.waitForSelector('text=Cloud sync is on', { timeout: 10000 });
  await tablet.waitForFunction(async () => !!(await import('./js/core/store.js')).get('books', 'byme'), null, { timeout: 10000 });
  check(true, 'new device signed in with email and downloaded the household’s data');

  check(!errors.length, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll cloud-sync checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
