-- Checks 20261115_record_owner.sql on a minimal schema: the creator owns a new
-- record, only owners and admins reassign it (to a member), the name is the
-- database's, and it survives the member's account being deleted.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create role anon; create role authenticated;
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a0', 'owner@example.invalid', '{"first_name": "Fatou", "last_name": "Sawadogo"}'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@example.invalid', '{"full_name": "Issa Traoré"}'),
  ('00000000-0000-0000-0000-0000000000aa', 'awa@example.invalid',   '{"first_name": "Awa"}'),
  ('00000000-0000-0000-0000-0000000000bb', 'paul@example.invalid',  '{}'),
  ('00000000-0000-0000-0000-0000000000cc', 'other@example.invalid', '{}');
create table public.organizations (id uuid primary key, name text);
create table public.org_members (org_id uuid, user_id uuid, role text);
insert into public.organizations values ('00000000-0000-0000-0000-0000000000f1', 'A'), ('00000000-0000-0000-0000-0000000000f2', 'B');
insert into public.org_members values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a0', 'owner'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000ad', 'admin'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000aa', 'member'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000bb', 'member'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000cc', 'owner');
create table public.invoices (
  id text, org_id uuid, status text default 'draft', subject text,
  issued_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  primary key (org_id, id));
create table public.quotes  (id text, org_id uuid, subject text, primary key (org_id, id));
create table public.clients (code text, org_id uuid, name text, primary key (org_id, code));

-- Records from before the migration
insert into public.invoices (id, org_id, issued_by, created_by) values
  ('OLD-1', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb'),
  ('OLD-2', '00000000-0000-0000-0000-0000000000f1', null, '00000000-0000-0000-0000-0000000000bb'),
  ('OLD-3', '00000000-0000-0000-0000-0000000000f1', null, null);
insert into public.quotes  values ('Q-OLD', '00000000-0000-0000-0000-0000000000f1', 'x');
insert into public.clients values ('C-OLD', '00000000-0000-0000-0000-0000000000f2', 'x');

\i ../migrations/20261115_record_owner.sql
-- Safe to run twice
\i ../migrations/20261115_record_owner.sql

do $$
declare
  f1 constant uuid := '00000000-0000-0000-0000-0000000000f1';
  awa   constant uuid := '00000000-0000-0000-0000-0000000000aa';
  paul  constant uuid := '00000000-0000-0000-0000-0000000000bb';
  adm   constant uuid := '00000000-0000-0000-0000-0000000000ad';
  outsider constant uuid := '00000000-0000-0000-0000-0000000000cc';
  failures int := 0;
  r record;
  procedure_check text;
begin
  -- Backfill: issuer, else creator, else the organisation's owner
  for r in select id, owner_name from invoices order by id loop
    if r.owner_name is distinct from (case r.id when 'OLD-1' then 'Awa' when 'OLD-2' then 'paul' else 'Fatou Sawadogo' end) then
      failures := failures + 1; raise warning 'backfill %: %', r.id, r.owner_name;
    end if;
  end loop;
  if (select owner_name from quotes where id = 'Q-OLD') is distinct from 'Fatou Sawadogo' then
    failures := failures + 1; raise warning 'quote backfill: %', (select owner_name from quotes where id = 'Q-OLD');
  end if;
  if (select owner_id from clients where code = 'C-OLD') is distinct from outsider then
    failures := failures + 1; raise warning 'client backfill in org B';
  end if;

  -- Awa creates records: she owns them, whatever name the app sends
  perform set_config('request.jwt.claim.sub', awa::text, true);
  insert into invoices (id, org_id, owner_name) values ('N-1', f1, 'Faux');
  insert into quotes (id, org_id) values ('Q-1', f1);
  insert into clients (code, org_id) values ('C-1', f1);
  if (select (owner_id, owner_name) from invoices where id = 'N-1') is distinct from (awa, 'Awa'::text) then
    failures := failures + 1; raise warning 'new invoice owner: %', (select owner_name from invoices where id = 'N-1');
  end if;
  if (select owner_id from quotes where id = 'Q-1') is distinct from awa or (select owner_id from clients where code = 'C-1') is distinct from awa then
    failures := failures + 1; raise warning 'new quote/client owner';
  end if;

  -- An invoice made from Paul's quote keeps Paul; an outsider can't be named
  insert into invoices (id, org_id, owner_id) values ('N-2', f1, paul);
  insert into invoices (id, org_id, owner_id) values ('N-3', f1, outsider);
  if (select owner_name from invoices where id = 'N-2') is distinct from 'paul' then
    failures := failures + 1; raise warning 'kept owner from quote';
  end if;
  if (select owner_id from invoices where id = 'N-3') is distinct from awa then
    failures := failures + 1; raise warning 'outsider accepted as owner';
  end if;

  -- A member can't reassign or rename: reverted, the rest of the update applies
  update invoices set owner_id = paul, owner_name = 'Paul', subject = 'Nouvel objet' where id = 'N-1';
  if (select (owner_id, owner_name, subject) from invoices where id = 'N-1') is distinct from (awa, 'Awa'::text, 'Nouvel objet'::text) then
    failures := failures + 1; raise warning 'member reassigned an invoice';
  end if;
  update clients set owner_id = null where code = 'C-1';
  if (select owner_id from clients where code = 'C-1') is distinct from awa then
    failures := failures + 1; raise warning 'member cleared a client owner';
  end if;

  -- An admin reassigns several at once, to a member only
  perform set_config('request.jwt.claim.sub', adm::text, true);
  update invoices set owner_id = paul where id in ('N-1', 'OLD-3');
  if (select count(*) from invoices where id in ('N-1', 'OLD-3') and owner_id = paul and owner_name = 'paul') <> 2 then
    failures := failures + 1; raise warning 'admin bulk reassign';
  end if;
  update quotes set owner_id = outsider where id = 'Q-1';
  if (select owner_id from quotes where id = 'Q-1') is distinct from awa then
    failures := failures + 1; raise warning 'admin assigned an outsider';
  end if;
  update quotes set owner_name = 'Renommé' where id = 'Q-1';
  if (select owner_name from quotes where id = 'Q-1') is distinct from 'Awa' then
    failures := failures + 1; raise warning 'name rewritten without a reassign';
  end if;

  -- Paul's account is deleted: owner cleared, his name stays on his records
  perform set_config('request.jwt.claim.sub', '', true);
  delete from auth.users where id = paul;
  if (select count(*) from invoices where owner_id is null and owner_name = 'paul') <> 4 then
    failures := failures + 1; raise warning 'name lost when the user was deleted: %', (select array_agg(id || ':' || coalesce(owner_name, '∅')) from invoices where owner_id is null);
  end if;

  -- …and an admin can reassign them afterwards
  perform set_config('request.jwt.claim.sub', adm::text, true);
  update invoices set owner_id = awa where owner_id is null and owner_name = 'paul';
  if exists (select 1 from invoices where owner_name = 'paul') then
    failures := failures + 1; raise warning 'could not reassign a departed member''s records';
  end if;

  if failures > 0 then raise exception '% check(s) failed', failures; end if;
end $$;
