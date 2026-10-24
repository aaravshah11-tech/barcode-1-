// Runs supabase/schema.sql on an in-memory Postgres (PGlite) with stand-ins for
// Supabase's auth schema, then checks pairing, privacy (RLS) and "newest wins".
// Needs: npm i -D @electric-sql/pglite   (skipped if it isn't installed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* optional */ }

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const U3 = '33333333-3333-3333-3333-333333333333';

test('schema: pairing, privacy and newest-wins', { skip: !PGlite && 'pglite not installed' }, async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime;
    grant usage on schema public to authenticated;`);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')); // re-runnable

  const as = async (uid, sql, params) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
    try { return await db.query(sql, params); } finally { await db.exec('reset role;'); }
  };

  // Computer creates the household; phone joins with the code.
  const h = (await as(U1, `select public.create_household('Home', 'Mac') as r`)).rows[0].r;
  assert.ok(h.id && h.join_code.length === 32);
  await assert.rejects(as(U2, `select public.join_household($1, 'wrong', 'iPhone')`, [h.id]), /Pairing code not valid/);
  await as(U2, `select public.join_household($1, $2, 'iPhone')`, [h.id, h.join_code]);

  // Phone writes a record; computer reads it.
  const row = (data, at, by) => [h.id, 'books', 'b1', JSON.stringify(data), at, by];
  const upsert = `insert into public.records (household_id, collection, id, data, updated_at, updated_by)
    values ($1, $2, $3, $4::jsonb, $5, $6) on conflict (household_id, collection, id) do update
    set data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by, deleted = excluded.deleted`;
  await as(U2, upsert, row({ title: 'v2' }, 200, 'phone'));
  let r = await as(U1, `select data->>'title' as t, seq from public.records where id = 'b1'`);
  assert.equal(r.rows[0].t, 'v2');
  const seq1 = Number(r.rows[0].seq);

  // An older write loses and doesn't bump seq; a newer one wins and does.
  await as(U1, upsert, row({ title: 'old' }, 100, 'mac'));
  r = await as(U1, `select data->>'title' as t, seq from public.records where id = 'b1'`);
  assert.equal(r.rows[0].t, 'v2');
  assert.equal(Number(r.rows[0].seq), seq1);
  await as(U2, upsert, row({ title: 'v2' }, 200, 'phone')); // exact echo: ignored
  assert.equal(Number((await as(U1, `select seq from public.records where id = 'b1'`)).rows[0].seq), seq1);
  await as(U1, upsert, row({ title: 'v3' }, 300, 'mac'));
  r = await as(U2, `select data->>'title' as t, seq from public.records where id = 'b1'`);
  assert.equal(r.rows[0].t, 'v3');
  assert.ok(Number(r.rows[0].seq) > seq1);

  // A stranger sees nothing and can't write.
  assert.equal((await as(U3, `select * from public.records`)).rows.length, 0);
  await assert.rejects(as(U3, upsert, [h.id, 'books', 'x', '{}', 1, 'evil']), /row-level security/);
  assert.equal((await as(U3, `select * from public.households`)).rows.length, 0);

  // New join code invalidates the old one.
  const code2 = (await as(U1, `select public.rotate_join_code($1) as c`, [h.id])).rows[0].c;
  assert.notEqual(code2, h.join_code);
  await assert.rejects(as(U3, `select public.join_household($1, $2, 'x')`, [h.id, h.join_code]), /not valid/);
  await as(U3, `select public.join_household($1, $2, 'x')`, [h.id, code2]);
  assert.equal((await as(U3, `select * from public.records`)).rows.length, 1);

  const pub = await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`);
  assert.deepEqual(pub.rows.map((x) => x.tablename), ['records']);
});
