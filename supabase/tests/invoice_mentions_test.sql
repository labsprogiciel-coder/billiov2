-- Checks 20261114_invoice_mentions.sql on a minimal schema: the operator is
-- stamped by the database at first issue only; the cadastral format is enforced.
create schema if not exists auth;
create or replace function auth.role() returns text language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
insert into auth.users values
  ('00000000-0000-0000-0000-00000000aaaa', 'awa@example.invalid', '{"first_name": "Awa", "last_name": "Ouédraogo"}'),
  ('00000000-0000-0000-0000-00000000bbbb', 'paul@example.invalid', '{}');
create table public.organizations (id uuid primary key, name text);
create table public.invoices (
  id text not null, org_id uuid not null references public.organizations, status text not null default 'draft',
  primary key (org_id, id)
);
insert into public.organizations values ('00000000-0000-0000-0000-0000000000a1', 'A');

\i ../migrations/20261114_invoice_mentions.sql

do $$
declare
  a constant uuid := '00000000-0000-0000-0000-0000000000a1';
  failures int := 0;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaaa', true);

  -- A draft has no operator, even when one is supplied
  insert into invoices (id, org_id, status, issued_by_name) values ('D-1', a, 'draft', 'Faux');
  if (select issued_by_name from invoices where id = 'D-1') is not null then
    failures := failures + 1; raise warning 'draft has an operator';
  end if;

  -- Issued by Awa: her name from the profile
  update invoices set status = 'pending' where id = 'D-1';
  if (select issued_by_name from invoices where id = 'D-1') is distinct from 'Awa Ouédraogo' then
    failures := failures + 1; raise warning 'operator name: %', (select issued_by_name from invoices where id = 'D-1');
  end if;

  -- Paul changes it later: the operator stays Awa, and can't be rewritten
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000bbbb', true);
  update invoices set status = 'paid', issued_by_name = 'Paul' where id = 'D-1';
  if (select issued_by_name from invoices where id = 'D-1') is distinct from 'Awa Ouédraogo' then
    failures := failures + 1; raise warning 'operator was overwritten';
  end if;

  -- Issued directly by Paul (no profile name): his e-mail's local part
  insert into invoices (id, org_id, status) values ('I-2', a, 'pending');
  if (select issued_by_name from invoices where id = 'I-2') is distinct from 'paul' then
    failures := failures + 1; raise warning 'fallback name: %', (select issued_by_name from invoices where id = 'I-2');
  end if;

  -- Cadastral reference: 11 digits or nothing
  update organizations set cadastral_ref = '01234567890' where id = a;
  update organizations set cadastral_ref = null where id = a;
  begin
    update organizations set cadastral_ref = '0123 456 7890' where id = a;
    failures := failures + 1; raise warning 'unformatted cadastral reference accepted';
  exception when check_violation then null; end;

  if failures > 0 then raise exception '% mention check(s) failed', failures; end if;
end $$;
