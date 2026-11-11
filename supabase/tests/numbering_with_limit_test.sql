-- Checks the numbering and Solo-limit triggers together: a refused 6th Solo
-- invoice uses up no number.
create schema if not exists auth;
create or replace function auth.role() returns text language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create table public.organizations (
  id uuid primary key, name text,
  plan text not null default 'solo', plan_status text, plan_renews_at timestamptz, trial_ends_at timestamptz
);
create table public.invoices (
  id text not null, org_id uuid not null references public.organizations, status text not null default 'draft',
  created_at timestamptz not null default now(), primary key (org_id, id)
);
create table public.credit_notes (
  id text not null, org_id uuid not null references public.organizations, invoice_id text not null, primary key (org_id, id)
);
insert into public.organizations (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Solo');

\i ../migrations/20261111_solo_limit_and_plan_protection.sql
\i ../migrations/20261113_invoice_numbering.sql

do $$
declare a constant uuid := '00000000-0000-0000-0000-0000000000a1'; i int;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  for i in 1..5 loop insert into invoices (id, org_id, status) values ('X' || i, a, 'pending'); end loop;
  begin
    insert into invoices (id, org_id, status) values ('X6', a, 'pending');
    raise exception 'Solo limit not enforced';
  exception when sqlstate 'BL001' then null; end;
  -- Upgraded: the next invoice gets number 6, the refused one used none
  perform set_config('request.jwt.claim.role', '', true);
  update organizations set plan = 'business' where id = a;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into invoices (id, org_id, status) values ('X7', a, 'pending');
  if (select number from invoices where id = 'X7') is distinct from
     'FACT-' || extract(year from now() at time zone 'UTC')::int || '-0006' then
    raise exception 'the refused invoice used a number: %', (select number from invoices where id = 'X7');
  end if;
end $$;
