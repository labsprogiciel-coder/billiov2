-- Checks 20261116_change_authors.sql on a minimal schema: payments carry the
-- name of who recorded them, products of who last changed what they are.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create role anon; create role authenticated;
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000aa', 'awa@example.invalid',  '{"first_name": "Awa", "last_name": "Ouédraogo"}'),
  ('00000000-0000-0000-0000-0000000000bb', 'paul@example.invalid', '{}');
create table public.payments (
  id text primary key, org_id uuid, amount numeric, status text default 'completed',
  created_by uuid references auth.users(id) on delete set null);
create table public.products (
  id text primary key, org_id uuid, name text, sku text, type text, unit text, price numeric, tax numeric,
  used int default 0, created_at timestamptz default '2026-01-02T08:00:00Z');

-- Before the migration
insert into public.payments (id, amount, created_by) values ('OLD-P', 100, '00000000-0000-0000-0000-0000000000aa');
insert into public.products (id, name, sku, type, unit, price, tax) values ('OLD-I', 'Conseil', 'C1', 'service', 'h', 10000, 18);

\i ../migrations/20261116_change_authors.sql
\i ../migrations/20261116_change_authors.sql

do $$
declare
  awa  constant uuid := '00000000-0000-0000-0000-0000000000aa';
  paul constant uuid := '00000000-0000-0000-0000-0000000000bb';
  failures int := 0;
  t0 timestamptz;
begin
  -- Backfill
  if (select created_by_name from payments where id = 'OLD-P') is distinct from 'Awa Ouédraogo' then
    failures := failures + 1; raise warning 'payment backfill: %', (select created_by_name from payments where id = 'OLD-P');
  end if;
  if (select (updated_at, updated_by) from products where id = 'OLD-I') is distinct from ('2026-01-02T08:00:00Z'::timestamptz, null::uuid) then
    failures := failures + 1; raise warning 'product backfill';
  end if;

  -- Paul records a payment, claiming Awa did: it is his
  perform set_config('request.jwt.claim.sub', paul::text, true);
  insert into payments (id, amount, created_by, created_by_name) values ('P-1', 50, awa, 'Awa');
  if (select (created_by, created_by_name) from payments where id = 'P-1') is distinct from (paul, 'paul'::text) then
    failures := failures + 1; raise warning 'payment author: %', (select created_by_name from payments where id = 'P-1');
  end if;
  -- …and can't rewrite it afterwards; the rest of the update applies
  update payments set created_by = awa, created_by_name = 'Awa', status = 'pending' where id = 'P-1';
  if (select (created_by, created_by_name, status) from payments where id = 'P-1') is distinct from (paul, 'paul'::text, 'pending'::text) then
    failures := failures + 1; raise warning 'payment author rewritten';
  end if;

  -- The webhook (no caller) records an online payment: no author
  perform set_config('request.jwt.claim.sub', '', true);
  insert into payments (id, amount) values ('P-WEB', 70);
  if (select created_by_name from payments where id = 'P-WEB') is not null then
    failures := failures + 1; raise warning 'online payment has an author';
  end if;

  -- Awa changes the price: stamped; a change of usage count alone isn't a change
  perform set_config('request.jwt.claim.sub', awa::text, true);
  update products set price = 12000 where id = 'OLD-I';
  select updated_at into t0 from products where id = 'OLD-I';
  if (select (updated_by, updated_by_name) from products where id = 'OLD-I') is distinct from (awa, 'Awa Ouédraogo'::text) or t0 < now() - interval '1 minute' then
    failures := failures + 1; raise warning 'price change not stamped';
  end if;
  perform set_config('request.jwt.claim.sub', paul::text, true);
  update products set used = 5, updated_by_name = 'Faux' where id = 'OLD-I';
  if (select (updated_by, updated_by_name) from products where id = 'OLD-I') is distinct from (awa, 'Awa Ouédraogo'::text) then
    failures := failures + 1; raise warning 'usage count or forged name counted as a change';
  end if;
  -- Paul creates one
  insert into products (id, name, sku, type, unit, price, tax) values ('N-1', 'Câble', 'K1', 'product', 'm', 500, 18);
  if (select updated_by_name from products where id = 'N-1') is distinct from 'paul' then
    failures := failures + 1; raise warning 'new product author';
  end if;

  -- Accounts deleted: the names stay
  perform set_config('request.jwt.claim.sub', '', true);
  delete from auth.users;
  if (select count(*) from payments where created_by is null and created_by_name is not null) <> 2
     or (select count(*) from products where updated_by is null and updated_by_name is not null) <> 2 then
    failures := failures + 1; raise warning 'names lost when accounts were deleted';
  end if;

  if failures > 0 then raise exception '% check(s) failed', failures; end if;
end $$;
