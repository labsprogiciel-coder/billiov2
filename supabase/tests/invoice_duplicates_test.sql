-- Checks 20261130_invoice_duplicates_and_lines.sql:
-- the details at issue are kept, whatever changes later; the first PDF is the original, once;
-- an issued invoice can't take a line worth zero or less, nor be issued with one.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon; create role authenticated;
grant usage on schema public, auth to authenticated;
create table public.org_members (org_id uuid, user_id uuid, role text);
insert into public.org_members values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'observer');
create function public.my_org_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select org_id from org_members where user_id = auth.uid() $$;
create table public.organizations (id uuid primary key, name text, address text, city text, country text, email text, phone text,
  ifu text, rccm text, tax_regime text, division_fiscale text, cadastral_ref text);
create table public.clients (org_id uuid, code text, name text, contact text, email text, phone text, city text, country text,
  ifu text, rccm text, tax_regime text, fiscal_division text, client_type text, withholding_scenario text, primary key (org_id, code));
create table public.invoices (org_id uuid, id text, client_code text, status text, amount numeric, first_issued_at timestamptz,
  primary key (org_id, id));
create table public.line_items (org_id uuid, id serial primary key, invoice_id text, description text, qty numeric, price numeric);
grant select, insert, update on all tables in schema public to authenticated;
insert into organizations (id, name, ifu) values ('00000000-0000-0000-0000-00000000000a', 'Studio Wend', '00012345A');
insert into clients (org_id, code, name, ifu) values ('00000000-0000-0000-0000-00000000000a', 'TK', 'TechKonsult', '00099999B');
-- An invoice issued before the migration
insert into invoices values ('00000000-0000-0000-0000-00000000000a', 'OLD', 'TK', 'pending', 1000, '2026-06-01');

\i ../migrations/20261130_invoice_duplicates_and_lines.sql
-- Twice: safe to run again
\i ../migrations/20261130_invoice_duplicates_and_lines.sql

do $$
declare
  failures int := 0;
  o constant uuid := '00000000-0000-0000-0000-00000000000a';
  snap jsonb;
begin
  -- Older issued invoices: snapshot taken, original counted as produced
  if (select issue_snapshot #>> '{client,name}' from invoices where id = 'OLD') is distinct from 'TechKonsult'
     or (select original_printed_at from invoices where id = 'OLD') is null then
    failures := failures + 1; raise warning 'older invoice not backfilled';
  end if;

  -- A draft with its lines, then issued: snapshot taken at issue
  insert into invoices values (o, 'F1', 'TK', 'draft', 5000, null);
  insert into line_items (org_id, invoice_id, description, qty, price) values (o, 'F1', 'Conseil', 1, 5000), (o, 'F1', 'Offert', 1, 0);
  if (select issue_snapshot from invoices where id = 'F1') is not null then
    failures := failures + 1; raise warning 'a draft has a snapshot';
  end if;
  begin
    update invoices set status = 'pending' where id = 'F1';
    failures := failures + 1; raise warning 'an invoice with a zero line was issued';
  exception when check_violation then null;
  end;
  delete from line_items where invoice_id = 'F1' and price = 0;
  update clients set withholding_scenario = 'non_resident' where code = 'TK';
  update invoices set status = 'pending', issue_snapshot = '{"forged": true}', original_printed_at = now() where id = 'F1';
  select issue_snapshot into snap from invoices where id = 'F1';
  if snap #>> '{seller,ifu}' is distinct from '00012345A' or snap #>> '{client,ifu}' is distinct from '00099999B' then
    failures := failures + 1; raise warning 'snapshot wrong or forged: %', snap;
  end if;
  -- The withholding at issue, and the fields empty at issue (kept as empty, not left out)
  if snap #>> '{client,withholding_scenario}' is distinct from 'non_resident'
     or not (snap -> 'client' ? 'phone') or snap #>> '{client,phone}' is not null then
    failures := failures + 1; raise warning 'withholding or empty fields not in the snapshot: %', snap;
  end if;
  if (select original_printed_at from invoices where id = 'F1') is not null then
    failures := failures + 1; raise warning 'the app set original_printed_at itself';
  end if;

  -- Later changes don't touch the snapshot
  update clients set name = 'TK Renamed', ifu = 'X', withholding_scenario = null, phone = '+226 70 00 00 00' where code = 'TK';
  update organizations set name = 'Other' where id = o;
  update invoices set amount = 5000 where id = 'F1';
  if (select issue_snapshot #>> '{client,name}' from invoices where id = 'F1') <> 'TechKonsult'
     or (select issue_snapshot #>> '{seller,name}' from invoices where id = 'F1') <> 'Studio Wend'
     or (select issue_snapshot #>> '{client,withholding_scenario}' from invoices where id = 'F1') <> 'non_resident' then
    failures := failures + 1; raise warning 'snapshot changed after issue';
  end if;

  -- A zero line can't be added to an issued invoice; a draft may hold one
  begin
    insert into line_items (org_id, invoice_id, description, qty, price) values (o, 'F1', 'Gratuit', 1, 0);
    failures := failures + 1; raise warning 'zero line added to an issued invoice';
  exception when check_violation then null;
  end;
  insert into invoices values (o, 'D2', 'TK', 'draft', 0, null);
  insert into line_items (org_id, invoice_id, description, qty, price) values (o, 'D2', 'À chiffrer', 1, 0);
  begin
    update invoices set status = 'pending' where id = 'D2';
    failures := failures + 1; raise warning 'a zero invoice was issued';
  exception when check_violation then null;
  end;

  if failures > 0 then raise exception '% check(s) failed', failures; end if;
end $$;

-- The original, once, by any member (an observer here); never for a draft or another organisation
set role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false); end $$;
do $$
declare failures int := 0;
begin
  if not public.claim_invoice_original('00000000-0000-0000-0000-00000000000a', 'F1') then
    failures := failures + 1; raise warning 'first PDF not the original';
  end if;
  if public.claim_invoice_original('00000000-0000-0000-0000-00000000000a', 'F1') then
    failures := failures + 1; raise warning 'second PDF also the original';
  end if;
  if public.claim_invoice_original('00000000-0000-0000-0000-00000000000a', 'OLD') then
    failures := failures + 1; raise warning 'older invoice gave an original';
  end if;
  if public.claim_invoice_original('00000000-0000-0000-0000-00000000000a', 'D2') then
    failures := failures + 1; raise warning 'a draft gave an original';
  end if;
  begin
    perform public.claim_invoice_original('00000000-0000-0000-0000-00000000000b', 'F1');
    failures := failures + 1; raise warning 'claimed in another organisation';
  exception when insufficient_privilege then null;
  end;
  if failures > 0 then raise exception '% check(s) failed', failures; end if;
end $$;
