-- Checks 20261117_product_creator.sql: the creator of a catalogue item is
-- stamped by the database and can't be rewritten by a signed-in user.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create role anon; create role authenticated;
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000aa', 'awa@example.invalid',  '{"first_name": "Awa"}'),
  ('00000000-0000-0000-0000-0000000000bb', 'paul@example.invalid', '{}');
create table public.products (id text primary key, name text, price numeric);
insert into public.products values ('OLD', 'Ancien', 10);

\i ../migrations/20261117_product_creator.sql
\i ../migrations/20261117_product_creator.sql

do $$
declare
  awa  constant uuid := '00000000-0000-0000-0000-0000000000aa';
  paul constant uuid := '00000000-0000-0000-0000-0000000000bb';
  failures int := 0;
begin
  if (select created_by from products where id = 'OLD') is not null then
    failures := failures + 1; raise warning 'old item got a creator';
  end if;
  -- Awa creates an item, claiming Paul did
  perform set_config('request.jwt.claim.sub', awa::text, true);
  insert into products (id, name, price, created_by, created_by_name) values ('N', 'Neuf', 5, paul, 'Paul');
  if (select (created_by, created_by_name) from products where id = 'N') is distinct from (awa, 'Awa'::text) then
    failures := failures + 1; raise warning 'creator: %', (select created_by_name from products where id = 'N');
  end if;
  -- Paul can't take it over; the rest of his update applies
  perform set_config('request.jwt.claim.sub', paul::text, true);
  update products set created_by = paul, created_by_name = 'Paul', price = 6 where id = 'N';
  if (select (created_by, created_by_name, price) from products where id = 'N') is distinct from (awa, 'Awa'::text, 6::numeric) then
    failures := failures + 1; raise warning 'creator rewritten';
  end if;
  -- Awa's account deleted: the name stays
  perform set_config('request.jwt.claim.sub', '', true);
  delete from auth.users where id = awa;
  if (select (created_by, created_by_name) from products where id = 'N') is distinct from (null::uuid, 'Awa'::text) then
    failures := failures + 1; raise warning 'name lost on account deletion';
  end if;
  if failures > 0 then raise exception '% check(s) failed', failures; end if;
end $$;
