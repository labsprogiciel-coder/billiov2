-- Checks 20261113_invoice_numbering.sql on a minimal schema: numbers are given
-- at issue only, per organisation and year, never skipped or reused; issued
-- invoices and credit notes can't be deleted.
create schema if not exists auth;
create or replace function auth.role() returns text language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create table public.organizations (id uuid primary key, name text);
create table public.invoices (
  id text not null, org_id uuid not null references public.organizations, status text not null default 'draft',
  amount numeric not null default 0, primary key (org_id, id)
);
create table public.credit_notes (
  id text not null, org_id uuid not null references public.organizations, invoice_id text not null,
  amount numeric not null default 0, primary key (org_id, id)
);
insert into public.organizations values
  ('00000000-0000-0000-0000-0000000000a1', 'A'), ('00000000-0000-0000-0000-0000000000b2', 'B');
-- Issued before the migration: keeps its number; an old draft gets none
insert into public.invoices (id, org_id, status) values
  ('INV-0007', '00000000-0000-0000-0000-0000000000a1', 'paid'),
  ('INV-0008', '00000000-0000-0000-0000-0000000000a1', 'draft');
insert into public.credit_notes (id, org_id, invoice_id) values ('AV-0001', '00000000-0000-0000-0000-0000000000a1', 'INV-0007');

\i ../migrations/20261113_invoice_numbering.sql

do $$
declare
  a constant uuid := '00000000-0000-0000-0000-0000000000a1';
  b constant uuid := '00000000-0000-0000-0000-0000000000b2';
  y constant text := extract(year from now() at time zone 'UTC')::text;
  failures int := 0;
begin
  -- Backfill
  if (select number from invoices where id = 'INV-0007') is distinct from 'INV-0007' then
    failures := failures + 1; raise warning 'issued invoice lost its number';
  end if;
  if (select number from invoices where id = 'INV-0008') is not null then
    failures := failures + 1; raise warning 'old draft got a number';
  end if;
  if (select number from credit_notes where id = 'AV-0001') is distinct from 'AV-0001' then
    failures := failures + 1; raise warning 'credit note lost its number';
  end if;

  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- Drafts take no number, even with one supplied
  insert into invoices (id, org_id, status) values ('BR-1', a, 'draft');
  insert into invoices (id, org_id, status) values ('BR-2', a, 'draft');
  update invoices set number = 'FACT-1999-0001' where id = 'BR-2';
  if exists (select 1 from invoices where id in ('BR-1', 'BR-2') and number is not null) then
    failures := failures + 1; raise warning 'a draft has a number';
  end if;
  -- Deleting a draft leaves no gap
  delete from invoices where id = 'BR-1';

  -- Issuing (from a draft, or directly) takes the next number
  update invoices set status = 'pending' where id = 'BR-2';
  insert into invoices (id, org_id, status, number) values ('BR-3', a, 'pending', 'FACT-1999-0099');
  insert into invoices (id, org_id, status) values ('BR-4', b, 'pending');
  if (select number from invoices where id = 'BR-2') <> 'FACT-' || y || '-0001'
     or (select number from invoices where id = 'BR-3') <> 'FACT-' || y || '-0002' then
    failures := failures + 1; raise warning 'unexpected numbers: %', (select string_agg(id || '=' || coalesce(number, '-'), ', ') from invoices);
  end if;
  -- Each organisation has its own series
  if (select number from invoices where id = 'BR-4') <> 'FACT-' || y || '-0001' then
    failures := failures + 1; raise warning 'series is not per organisation';
  end if;
  -- A later status change keeps the number; it can't be rewritten
  update invoices set status = 'paid', number = 'X' where id = 'BR-2';
  if (select number from invoices where id = 'BR-2') <> 'FACT-' || y || '-0001' then
    failures := failures + 1; raise warning 'number was rewritten';
  end if;

  -- A failed issue gives its number back
  begin
    insert into invoices (id, org_id, status) values ('BR-5', a, 'pending');
    raise exception 'simulated failure after numbering';
  exception when raise_exception then null; end;
  insert into invoices (id, org_id, status) values ('BR-6', a, 'pending');
  if (select number from invoices where id = 'BR-6') <> 'FACT-' || y || '-0003' then
    failures := failures + 1; raise warning 'a rolled-back issue skipped a number: %', (select number from invoices where id = 'BR-6');
  end if;

  -- Issued invoices can't be deleted or go back to draft
  begin
    delete from invoices where id = 'BR-2';
    failures := failures + 1; raise warning 'issued invoice deleted';
  exception when sqlstate 'BL002' then null; end;
  begin
    delete from invoices where id = 'INV-0007';
    failures := failures + 1; raise warning 'old issued invoice deleted';
  exception when sqlstate 'BL002' then null; end;
  begin
    update invoices set status = 'draft' where id = 'BR-3';
    failures := failures + 1; raise warning 'issued invoice went back to draft';
  exception when sqlstate 'BL002' then null; end;

  -- Credit notes: own yearly series, not deletable
  insert into credit_notes (id, org_id, invoice_id) values ('AV-0002', a, 'BR-2');
  if (select number from credit_notes where id = 'AV-0002') <> 'AV-' || y || '-0001' then
    failures := failures + 1; raise warning 'credit note number: %', (select number from credit_notes where id = 'AV-0002');
  end if;
  begin
    delete from credit_notes where id = 'AV-0002';
    failures := failures + 1; raise warning 'credit note deleted';
  exception when sqlstate 'BL002' then null; end;

  -- Billio (no user token) can still delete
  perform set_config('request.jwt.claim.role', '', true);
  delete from invoices where id = 'BR-6';

  if failures > 0 then raise exception '% numbering check(s) failed', failures; end if;
end $$;
