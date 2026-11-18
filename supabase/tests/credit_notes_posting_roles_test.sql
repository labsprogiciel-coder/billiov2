-- Checks 20261129_credit_notes_posting_roles.sql as the signed-in roles: admins and accountants
-- create, change and delete draft credit notes; members and observers only read them.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon; create role authenticated;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
create table public.org_members (org_id uuid, user_id uuid, role text);
insert into public.org_members values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'accountant'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'member'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f1', 'observer');
create function public.my_org_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select org_id from org_members where user_id = auth.uid() $$;
create function public.my_writer_org_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select org_id from org_members where user_id = auth.uid() and role in ('owner', 'admin', 'accountant', 'member') $$;
create function public.my_posting_org_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select org_id from org_members where user_id = auth.uid() and role in ('owner', 'admin', 'accountant') $$;

create table public.credit_notes (org_id uuid, id text primary key, invoice_id text, status text not null default 'draft', reason text);
alter table public.credit_notes enable row level security;
grant select, insert, update, delete on public.credit_notes to authenticated;
-- What earlier migrations leave: everyone reads, writers write (20261120, 20261122)
create policy "credit_notes: members read" on public.credit_notes for select using (org_id in (select public.my_org_ids()));
create policy "credit_notes: writers insert" on public.credit_notes for insert with check (org_id in (select public.my_writer_org_ids()));
create policy "credit_notes: writers update" on public.credit_notes for update using (org_id in (select public.my_writer_org_ids()));
create policy "credit_notes: writers delete drafts" on public.credit_notes for delete using (status = 'draft' and org_id in (select public.my_writer_org_ids()));
insert into public.credit_notes (org_id, id, invoice_id, status) values
  ('00000000-0000-0000-0000-00000000000a', 'AV-1', 'F-1', 'draft'),
  ('00000000-0000-0000-0000-00000000000a', 'AV-2', 'F-1', 'issued');

\i ../migrations/20261129_credit_notes_posting_roles.sql
-- Twice: safe to run again
\i ../migrations/20261129_credit_notes_posting_roles.sql

set role authenticated;
do $$
declare
  failures int := 0;
  n int;
  who record;
begin
  for who in select * from (values
    ('00000000-0000-0000-0000-0000000000a1'::uuid, 'admin', true),
    ('00000000-0000-0000-0000-0000000000c1'::uuid, 'accountant', true),
    ('00000000-0000-0000-0000-0000000000e1'::uuid, 'member', false),
    ('00000000-0000-0000-0000-0000000000f1'::uuid, 'observer', false)) as t(uid, role, may) loop
    perform set_config('request.jwt.claim.sub', who.uid::text, true);
    select count(*) into n from credit_notes;
    if n <> 2 then failures := failures + 1; raise warning '% reads % credit notes, not 2', who.role, n; end if;

    begin
      insert into credit_notes (org_id, id, invoice_id) values ('00000000-0000-0000-0000-00000000000a', 'AV-' || who.role, 'F-1');
      if not who.may then failures := failures + 1; raise warning '% created a credit note', who.role; end if;
    exception when insufficient_privilege then
      if who.may then failures := failures + 1; raise warning '% could not create a credit note', who.role; end if;
    end;

    update credit_notes set reason = who.role where id = 'AV-1';
    get diagnostics n = row_count;
    if (n = 1) <> who.may then failures := failures + 1; raise warning '% update of a draft: % rows', who.role, n; end if;

    delete from credit_notes where id = 'AV-' || who.role;
    get diagnostics n = row_count;
    if (n = 1) <> who.may then failures := failures + 1; raise warning '% delete of their draft: % rows', who.role, n; end if;
  end loop;

  -- An issued credit note is never deleted through this policy
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
  delete from credit_notes where id = 'AV-2';
  get diagnostics n = row_count;
  if n <> 0 then failures := failures + 1; raise warning 'an issued credit note was deleted'; end if;

  if failures > 0 then raise exception '% check(s) failed', failures; end if;
end $$;
