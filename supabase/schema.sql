-- =============================================================
-- HomeBase database for Supabase.
-- How to use: Supabase dashboard › SQL Editor › New query ›
-- paste this whole file › Run. Safe to run again.
-- =============================================================

-- A household = your devices that share one set of data.
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Home',
  join_code text not null default replace(gen_random_uuid()::text, '-', ''),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- Which signed-in devices belong to which household.
create table if not exists public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null,
  device_name text,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Every record from every tool (books, items, matches, swings…).
create sequence if not exists public.records_seq;
create table if not exists public.records (
  household_id uuid not null references public.households(id) on delete cascade,
  collection text not null,
  id text not null,
  data jsonb not null,
  updated_at bigint not null,
  updated_by text not null default '',
  deleted boolean not null default false,
  seq bigint not null default nextval('public.records_seq'),
  primary key (household_id, collection, id)
);
create index if not exists records_household_seq on public.records (household_id, seq);

-- Newest write wins: ignore an update that is older than what we have.
-- Every accepted write gets a new seq so devices can catch up from a cursor.
create or replace function public.records_lww() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if (new.updated_at, new.updated_by) <= (old.updated_at, old.updated_by) then
      return null; -- keep the existing, newer row
    end if;
  end if;
  new.seq := nextval('public.records_seq');
  return new;
end $$;

drop trigger if exists records_lww on public.records;
create trigger records_lww before insert or update on public.records
for each row execute function public.records_lww();

-- Is the signed-in user a member of this household?
create or replace function public.is_member(hid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.members where household_id = hid and user_id = auth.uid());
$$;

-- ---------- Row level security: only members see their household ----------
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.records enable row level security;

drop policy if exists households_read on public.households;
create policy households_read on public.households for select to authenticated using (public.is_member(id));

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (public.is_member(household_id));

drop policy if exists records_read on public.records;
create policy records_read on public.records for select to authenticated using (public.is_member(household_id));
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated with check (public.is_member(household_id));
drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));
-- (No delete policy: deletes are synced as "deleted" rows.)

-- ---------- Pairing ----------
create or replace function public.create_household(p_name text, p_device text) returns json
language plpgsql security definer set search_path = public as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.households (name, created_by) values (coalesce(nullif(p_name, ''), 'Home'), auth.uid()) returning * into h;
  insert into public.members (household_id, user_id, device_name) values (h.id, auth.uid(), p_device);
  return json_build_object('id', h.id, 'join_code', h.join_code);
end $$;

create or replace function public.join_household(p_household uuid, p_code text, p_device text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.households where id = p_household and join_code = p_code) then
    raise exception 'Pairing code not valid';
  end if;
  insert into public.members (household_id, user_id, device_name) values (p_household, auth.uid(), p_device)
  on conflict (household_id, user_id) do update set device_name = excluded.device_name;
  return true;
end $$;

create or replace function public.rotate_join_code(p_household uuid) returns text
language plpgsql security definer set search_path = public as $$
declare code text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_member(p_household) then raise exception 'Not a member'; end if;
  update public.households set join_code = code where id = p_household;
  return code;
end $$;

revoke all on function public.create_household(text, text) from public, anon;
revoke all on function public.join_household(uuid, text, text) from public, anon;
revoke all on function public.rotate_join_code(uuid) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(uuid, text, text) to authenticated;
grant execute on function public.rotate_join_code(uuid) to authenticated;
grant select, insert, update on public.records to authenticated;
grant select on public.households, public.members to authenticated;
grant usage on sequence public.records_seq to authenticated;

-- ---------- Names & optional email sign-in ----------
-- Each person can give the household their name. With email sign-in (optional) the same
-- account can be used on a new device, and the household can see who is who.
alter table public.members add column if not exists display_name text;

create or replace function public.set_my_name(p_household uuid, p_name text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'Not a member'; end if;
  update public.members set display_name = nullif(btrim(left(p_name, 60)), '') where household_id = p_household and user_id = auth.uid();
  return true;
end $$;

-- Households this account belongs to (used when signing in with email on a new device).
create or replace function public.my_households() returns table (id uuid, name text, join_code text)
language sql security definer stable set search_path = public as $$
  select h.id, h.name, h.join_code from public.households h
  join public.members m on m.household_id = h.id
  where m.user_id = auth.uid() order by m.joined_at;
$$;

-- Everyone in a household: name, device and sign-in email (members only).
create or replace function public.household_people(p_household uuid)
returns table (user_id uuid, display_name text, device_name text, email text, is_me boolean)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'Not a member'; end if;
  return query select m.user_id, m.display_name, m.device_name, u.email::text, m.user_id = auth.uid()
    from public.members m left join auth.users u on u.id = m.user_id
    where m.household_id = p_household order by m.joined_at;
end $$;

revoke all on function public.set_my_name(uuid, text) from public, anon;
revoke all on function public.my_households() from public, anon;
revoke all on function public.household_people(uuid) from public, anon;
grant execute on function public.set_my_name(uuid, text) to authenticated;
grant execute on function public.my_households() to authenticated;
grant execute on function public.household_people(uuid) to authenticated;

-- ---------- Realtime: push record changes to devices ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records') then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;
