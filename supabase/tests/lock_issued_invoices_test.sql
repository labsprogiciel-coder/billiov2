-- Checks 20261201_lock_issued_invoices.sql: from the app, an issued invoice and its lines don't change
-- (status and Responsable still do); a draft is free; server code is not affected.
create schema if not exists auth;
create or replace function auth.role() returns text language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create table public.invoices (org_id uuid, id text, client_code text, subject text, issued_at date, due_at date,
  discount_pct numeric, amount numeric, status text, owner_id uuid, primary key (org_id, id));
create table public.line_items (org_id uuid, id serial primary key, invoice_id text, quote_id text, description text, qty numeric, price numeric);
insert into invoices values
  ('00000000-0000-0000-0000-00000000000a', 'F1', 'TK', 'Audit', '2026-11-01', '2026-11-15', 0, 118000, 'pending', null),
  ('00000000-0000-0000-0000-00000000000a', 'D1', 'TK', 'Brouillon', '2026-11-01', '2026-11-15', 0, 1000, 'draft', null);
insert into line_items (org_id, invoice_id, description, qty, price) values
  ('00000000-0000-0000-0000-00000000000a', 'F1', 'Conseil', 1, 100000),
  ('00000000-0000-0000-0000-00000000000a', 'D1', 'Conseil', 1, 1000);

\i ../migrations/20261201_lock_issued_invoices.sql
-- Twice: safe to run again
\i ../migrations/20261201_lock_issued_invoices.sql

do $$
declare
  failures int := 0;
  o constant uuid := '00000000-0000-0000-0000-00000000000a';
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  -- Each field of an issued invoice
  begin update invoices set amount = 1 where id = 'F1'; failures := failures + 1; raise warning 'amount changed';
  exception when sqlstate 'BL002' then null; end;
  begin update invoices set client_code = 'XX' where id = 'F1'; failures := failures + 1; raise warning 'client changed';
  exception when sqlstate 'BL002' then null; end;
  begin update invoices set subject = 'Autre', discount_pct = 10 where id = 'F1'; failures := failures + 1; raise warning 'subject changed';
  exception when sqlstate 'BL002' then null; end;
  begin update invoices set issued_at = '2026-10-01' where id = 'F1'; failures := failures + 1; raise warning 'date changed';
  exception when sqlstate 'BL002' then null; end;
  -- Status and Responsable still move
  update invoices set status = 'paid', owner_id = gen_random_uuid() where id = 'F1';
  -- Its lines
  begin insert into line_items (org_id, invoice_id, description, qty, price) values (o, 'F1', 'Ajout', 1, 5); failures := failures + 1; raise warning 'line added';
  exception when sqlstate 'BL002' then null; end;
  begin update line_items set price = 1 where invoice_id = 'F1'; failures := failures + 1; raise warning 'line changed';
  exception when sqlstate 'BL002' then null; end;
  begin delete from line_items where invoice_id = 'F1'; failures := failures + 1; raise warning 'line removed';
  exception when sqlstate 'BL002' then null; end;
  -- A draft is free, and is issued with its amount
  update invoices set subject = 'Nouveau', amount = 2000 where id = 'D1';
  delete from line_items where invoice_id = 'D1';
  insert into line_items (org_id, invoice_id, description, qty, price) values (o, 'D1', 'Conseil', 2, 1000);
  update invoices set status = 'pending', amount = 2000 where id = 'D1';
  -- Quote lines aren't concerned
  insert into line_items (org_id, quote_id, description, qty, price) values (o, 'DEV-1', 'Devis', 1, 1);
  -- Server code (service role) may still correct
  perform set_config('request.jwt.claim.role', 'service_role', true);
  update invoices set amount = 117999 where id = 'F1';
  if failures > 0 then raise exception '% check(s) failed', failures; end if;
end $$;
