-- Checks 20261125_payment_reconciliation.sql on a minimal schema: who may match a payment, what is stamped,
-- and that only completed payments can be matched.
create schema if not exists auth;
create table auth.users (id uuid primary key);
create or replace function auth.role() returns text language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.org_members (org_id uuid, user_id uuid, role text, name text);
create or replace function public.my_posting_org_ids() returns setof uuid language sql stable
  as $$ select org_id from public.org_members where user_id = auth.uid() and role in ('owner', 'admin', 'accountant') $$;
create or replace function public.member_display_name(p_user uuid) returns text language sql stable
  as $$ select name from public.org_members where user_id = p_user limit 1 $$;
create table public.payments (
  id text not null, org_id uuid not null, date date not null default current_date, status text not null default 'completed',
  amount numeric not null default 100, primary key (org_id, id)
);

\i ../migrations/20261125_payment_reconciliation.sql

insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
insert into public.org_members values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'accountant', 'Awa Compta'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b', 'member', 'Moussa Vente');
insert into public.payments (id, org_id, status) values
  ('PAI-1', '00000000-0000-0000-0000-0000000000a1', 'completed'),
  ('PAI-2', '00000000-0000-0000-0000-0000000000a1', 'pending');

do $$
declare
  org constant uuid := '00000000-0000-0000-0000-0000000000a1';
  failures int := 0; ok boolean; r record;
begin
  -- a member cannot match
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
  ok := false; begin update payments set reconciled_at = now() where id = 'PAI-1'; exception when insufficient_privilege then ok := true; end;
  if not ok then raise warning 'a member matched a payment'; failures := failures + 1; end if;
  -- a member can still edit other things (the trigger only guards matching)
  update payments set amount = 150 where id = 'PAI-1';
  if (select amount from payments where id = 'PAI-1') <> 150 then raise warning 'other edits blocked'; failures := failures + 1; end if;

  -- an accountant matches: who and when are stamped, whatever the app sent
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
  update payments set reconciled_at = '2000-01-01', reconciled_by_name = 'Quelqu''un d''autre' where id = 'PAI-1';
  select * into r from payments where id = 'PAI-1';
  if r.reconciled_at < now() - interval '1 minute' or r.reconciled_by <> '00000000-0000-0000-0000-00000000000a' or r.reconciled_by_name <> 'Awa Compta' then
    raise warning 'stamp: % % %', r.reconciled_at, r.reconciled_by, r.reconciled_by_name; failures := failures + 1;
  end if;
  -- matching again keeps the first stamp
  update payments set reconciled_at = now() + interval '1 day' where id = 'PAI-1';
  if (select reconciled_at from payments where id = 'PAI-1') <> r.reconciled_at then raise warning 'restamped'; failures := failures + 1; end if;
  -- unmatching clears it
  update payments set reconciled_at = null where id = 'PAI-1';
  select * into r from payments where id = 'PAI-1';
  if r.reconciled_by is not null or r.reconciled_by_name is not null then raise warning 'unmatch left a name'; failures := failures + 1; end if;

  -- only a completed payment
  ok := false; begin update payments set reconciled_at = now() where id = 'PAI-2'; exception when others then ok := sqlerrm like '%completed%'; end;
  if not ok then raise warning 'a pending payment was matched'; failures := failures + 1; end if;

  -- a new payment from the app starts unmatched
  insert into payments (id, org_id, reconciled_at, reconciled_by_name) values ('PAI-3', org, now(), 'x');
  if (select reconciled_at from payments where id = 'PAI-3') is not null then raise warning 'inserted matched'; failures := failures + 1; end if;

  -- the service role (statement import later) may set it
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);
  update payments set reconciled_at = '2026-11-01' where id = 'PAI-3';
  if (select reconciled_at from payments where id = 'PAI-3') <> '2026-11-01' then raise warning 'service role'; failures := failures + 1; end if;

  if failures > 0 then raise exception '% check(s) failed', failures; end if;
end;
$$;
