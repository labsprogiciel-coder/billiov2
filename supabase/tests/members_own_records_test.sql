-- Checks 20261120_members_own_records.sql as the signed-in roles: a member
-- reads and changes only their own invoices, quotes and clients (plus the
-- clients on their documents), and the payments, credit notes, lines and
-- activity entries that go with them; the other roles still see everything.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key);
create role anon; create role authenticated;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000e2'), ('00000000-0000-0000-0000-0000000000f1');
create table public.org_members (org_id uuid, user_id uuid, role text);
insert into public.org_members values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'member'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e2', 'member'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f1', 'observer');
create function public.my_org_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select org_id from org_members where user_id = auth.uid() $$;
create function public.my_writer_org_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select org_id from org_members where user_id = auth.uid() and role in ('owner', 'admin', 'accountant', 'member') $$;
create function public.my_admin_org_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select org_id from org_members where user_id = auth.uid() and role in ('owner', 'admin') $$;

-- The tables as far as the policies need them (owner_id from 20261115)
create table public.invoices (org_id uuid, id text, client_code text, owner_id uuid, subject text, primary key (org_id, id));
create table public.quotes   (org_id uuid, id text, client_code text, owner_id uuid, primary key (org_id, id));
create table public.clients  (org_id uuid, code text, name text, owner_id uuid, primary key (org_id, code));
create table public.payments (org_id uuid, id text primary key, inv_id text, amount numeric);
create table public.credit_notes (org_id uuid, id text primary key, invoice_id text);
create table public.line_items (org_id uuid, id serial primary key, invoice_id text, quote_id text, description text);
create table public.activities (org_id uuid, id serial primary key, kind text);
do $$ declare t text; begin
  foreach t in array array['invoices','quotes','clients','payments','credit_notes','line_items','activities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    -- the policies 20261103_role_permissions.sql leaves for insert and delete
    execute format('create policy %I on public.%I for insert with check (org_id in (select public.my_writer_org_ids()))', t || ': writers insert', t);
    execute format('create policy %I on public.%I for delete using (org_id in (select public.my_admin_org_ids()))', t || ': admin delete', t);
  end loop;
end $$;
grant usage on sequence line_items_id_seq, activities_id_seq to authenticated;

\set a '''00000000-0000-0000-0000-00000000000a'''
insert into public.clients values
  (:a, 'C-AWA', 'Client d''Awa', '00000000-0000-0000-0000-0000000000e1'),
  (:a, 'C-PAUL', 'Client de Paul', '00000000-0000-0000-0000-0000000000e2'),
  (:a, 'C-ADMIN', 'Client de l''admin', '00000000-0000-0000-0000-0000000000a1');
insert into public.invoices values
  (:a, 'I-AWA', 'C-AWA', '00000000-0000-0000-0000-0000000000e1', 'a'),
  (:a, 'I-AWA2', 'C-ADMIN', '00000000-0000-0000-0000-0000000000e1', 'b'),  -- Awa invoices the admin's client
  (:a, 'I-PAUL', 'C-PAUL', '00000000-0000-0000-0000-0000000000e2', 'c');
insert into public.quotes values (:a, 'Q-AWA', 'C-AWA', '00000000-0000-0000-0000-0000000000e1'), (:a, 'Q-PAUL', 'C-PAUL', '00000000-0000-0000-0000-0000000000e2');
insert into public.payments values (:a, 'P1', 'I-AWA', 10), (:a, 'P2', 'I-PAUL', 20);
insert into public.credit_notes values (:a, 'CN1', 'I-PAUL');
insert into public.line_items (org_id, invoice_id, quote_id, description) values
  (:a, 'I-AWA', null, 'awa'), (:a, 'I-PAUL', null, 'paul'), (:a, null, 'Q-AWA', 'awa q'), (:a, null, 'Q-PAUL', 'paul q');

\i ../migrations/20261120_members_own_records.sql
\i ../migrations/20261120_members_own_records.sql

-- Activities written before: no author
insert into public.activities (org_id, kind) values (:a, 'old');

set role authenticated;
do $$
declare
  a constant uuid := '00000000-0000-0000-0000-00000000000a';
  failures int := 0;
  n int;
  got text;
begin
  -- Awa, a member
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
  insert into activities (org_id, kind) values (a, 'mine');
  got := (select string_agg(id, ',' order by id) from invoices);
  if got <> 'I-AWA,I-AWA2' then failures := failures + 1; raise warning 'member invoices: %', got; end if;
  got := (select string_agg(id, ',' order by id) from quotes);
  if got <> 'Q-AWA' then failures := failures + 1; raise warning 'member quotes: %', got; end if;
  got := (select string_agg(code, ',' order by code) from clients);
  if got <> 'C-ADMIN,C-AWA' then failures := failures + 1; raise warning 'member clients: %', got; end if;
  got := (select string_agg(id, ',' order by id) from payments);
  if got <> 'P1' then failures := failures + 1; raise warning 'member payments: %', got; end if;
  if (select count(*) from credit_notes) <> 0 then failures := failures + 1; raise warning 'member sees others'' credit notes'; end if;
  got := (select string_agg(description, ',' order by description) from line_items);
  if got <> 'awa,awa q' then failures := failures + 1; raise warning 'member lines: %', got; end if;
  got := (select string_agg(kind, ',') from activities);
  if got <> 'mine' then failures := failures + 1; raise warning 'member activities: %', got; end if;
  -- …and can't change Paul's
  update invoices set subject = 'pris' where id = 'I-PAUL';
  get diagnostics n = row_count;
  if n <> 0 then failures := failures + 1; raise warning 'member updated another''s invoice'; end if;
  update clients set name = 'pris' where code in ('C-PAUL', 'C-ADMIN');
  get diagnostics n = row_count;
  if n <> 0 then failures := failures + 1; raise warning 'member updated a client not theirs (%)', n; end if;
  update line_items set description = 'pris' where invoice_id = 'I-PAUL';
  get diagnostics n = row_count;
  if n <> 0 then failures := failures + 1; raise warning 'member updated another''s lines'; end if;
  begin
    insert into line_items (org_id, invoice_id, description) values (a, 'I-PAUL', 'ajout');
    failures := failures + 1; raise warning 'member added lines to another''s invoice';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into payments values (a, 'P3', 'I-PAUL', 5);
    failures := failures + 1; raise warning 'member paid another''s invoice';
  exception when insufficient_privilege then null;
  end;
  -- but works on their own
  update invoices set subject = 'ok' where id = 'I-AWA';
  get diagnostics n = row_count;
  if n <> 1 then failures := failures + 1; raise warning 'member could not update their invoice'; end if;
  insert into line_items (org_id, invoice_id, description) values (a, 'I-AWA', 'nouvelle');
  delete from line_items where invoice_id = 'I-AWA' and description = 'nouvelle';
  get diagnostics n = row_count;
  if n <> 1 then failures := failures + 1; raise warning 'member could not rewrite their lines'; end if;

  -- The admin and the observer see everything
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  if (select count(*) from invoices) <> 3 or (select count(*) from line_items) <> 4 or (select count(*) from activities) <> 2 then
    failures := failures + 1; raise warning 'admin sees less';
  end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
  if (select count(*) from clients) <> 3 or (select count(*) from payments) <> 2 or (select count(*) from credit_notes) <> 1 then
    failures := failures + 1; raise warning 'observer sees less';
  end if;

  if failures > 0 then raise exception '% check(s) failed', failures; end if;
end $$;
