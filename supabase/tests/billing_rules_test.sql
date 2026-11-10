-- Checks 20261111_solo_limit_and_plan_protection.sql on a minimal schema:
-- users can't change their plan; Solo issues at most 5 invoices a month.
create schema if not exists auth;
create or replace function auth.role() returns text language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create table public.organizations (
  id uuid primary key, name text,
  plan text not null default 'solo', plan_status text not null default 'free',
  plan_renews_at timestamptz, trial_ends_at timestamptz
);
create table public.invoices (
  id text not null, org_id uuid not null references public.organizations, status text not null default 'draft',
  created_at timestamptz not null default now(), primary key (org_id, id)
);
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Solo org'),
  ('00000000-0000-0000-0000-0000000000b2', 'Business org');
update public.organizations set plan = 'business', plan_status = 'active' where name = 'Business org';
-- An invoice issued before the migration (counts from created_at)
insert into public.invoices (id, org_id, status, created_at) values ('OLD-1', '00000000-0000-0000-0000-0000000000a1', 'pending', now() - interval '40 days');

\i ../migrations/20261111_solo_limit_and_plan_protection.sql

do $$
declare
  solo constant uuid := '00000000-0000-0000-0000-0000000000a1';
  biz  constant uuid := '00000000-0000-0000-0000-0000000000b2';
  failures int := 0; ok boolean; i int;
begin
  -- Backfill: last month's issued invoice doesn't count this month
  if (select first_issued_at from invoices where id = 'OLD-1') is null then
    failures := failures + 1; raise warning 'backfill left first_issued_at empty';
  end if;

  -- 1. A user can't change their plan…
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    update organizations set plan = 'cabinet' where id = solo;
    failures := failures + 1; raise warning 'user changed their plan';
  exception when insufficient_privilege then null; end;
  begin
    update organizations set plan_renews_at = now() + interval '10 years' where id = biz;
    failures := failures + 1; raise warning 'user changed plan_renews_at';
  exception when insufficient_privilege then null; end;
  -- …but can still edit the rest of the organisation
  update organizations set name = 'Solo org renamed' where id = solo;
  -- Billio (no user token) can change it
  perform set_config('request.jwt.claim.role', '', true);
  update organizations set plan_status = 'free' where id = solo;
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- 2. Solo: drafts are unlimited
  for i in 1..8 loop
    insert into invoices (id, org_id, status) values ('D-' || i, solo, 'draft');
  end loop;
  -- 5 issued this month are accepted (insert issued, and draft → pending)
  insert into invoices (id, org_id, status) values ('S-1', solo, 'pending'), ('S-2', solo, 'pending'), ('S-3', solo, 'paid');
  update invoices set status = 'pending' where org_id = solo and id in ('D-1', 'D-2');
  -- the 6th is refused, whether inserted issued or issued from a draft
  begin
    insert into invoices (id, org_id, status) values ('S-6', solo, 'pending');
    failures := failures + 1; raise warning '6th issued invoice accepted (insert)';
  exception when raise_exception then null; end;
  begin
    update invoices set status = 'pending' where org_id = solo and id = 'D-3';
    failures := failures + 1; raise warning '6th issued invoice accepted (draft issued)';
  exception when raise_exception then null; end;
  -- a client-supplied timestamp is ignored
  begin
    insert into invoices (id, org_id, status, first_issued_at) values ('S-7', solo, 'pending', now() - interval '1 year');
    failures := failures + 1; raise warning 'backdated first_issued_at dodged the limit';
  exception when raise_exception then null; end;
  -- rewriting first_issued_at on an issued invoice doesn't free quota
  update invoices set first_issued_at = now() - interval '1 year' where org_id = solo and id = 'S-1';
  if (select first_issued_at from invoices where org_id = solo and id = 'S-1') < now() - interval '1 day' then
    failures := failures + 1; raise warning 'first_issued_at was rewritten';
  end if;
  -- status changes of already-issued invoices still work (paid, overdue)
  update invoices set status = 'paid' where org_id = solo and id = 'S-1';
  update invoices set status = 'overdue' where org_id = solo and id = 'S-2';

  -- 3. Paid plans are unlimited
  for i in 1..12 loop
    insert into invoices (id, org_id, status) values ('B-' || i, biz, 'pending');
  end loop;

  if failures > 0 then raise exception '% billing check(s) failed', failures; end if;
end $$;
