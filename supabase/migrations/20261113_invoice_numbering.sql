-- Unbroken invoice numbering per fiscal year (PRO-141; DGI spec v2.0, 2.18 /
-- section 3 m: a unique number for each invoice, in an unbroken ascending
-- series for each fiscal year).
--
-- Until now an invoice's id was also its number, and it was taken when the
-- invoice was created, drafts included: deleting or abandoning a draft left a
-- gap, and the series never restarted.
--
-- 1. invoices.number is the legal number, e.g. FACT-2026-0001. The database
--    gives it when the invoice is first issued (leaves draft), in the same
--    transaction, from a series per organisation and per calendar year (the
--    OHADA fiscal year). If the transaction fails, the number isn't used. Drafts
--    have no number. `id` stays as the internal key (line items, payments,
--    credit notes and journal entries point to it).
-- 2. Credit notes get credit_notes.number the same way (AV-2026-0001), when
--    they're created (they have no draft state).
-- 3. Issued invoices and credit notes can't be deleted, and a numbered invoice
--    can't go back to draft: an issued invoice is cancelled with a credit note.
--    The Supabase dashboard / SQL editor and the service role still can.
--
-- Invoices and credit notes issued before this migration keep their current
-- number (their id).

-- ── 1. Invoice numbers ───────────────────────────────────────────────────────
alter table public.invoices add column if not exists number text;

update public.invoices
   set number = id
 where status <> 'draft' and number is null;

create unique index if not exists invoices_org_number_key
  on public.invoices (org_id, number)
  where number is not null;

create table if not exists public.invoice_number_series (
  org_id      uuid    not null references public.organizations(id) on delete cascade,
  year        integer not null,
  last_number integer not null default 0,
  primary key (org_id, year)
);
-- Only the trigger below writes here (RLS on, no policies)
alter table public.invoice_number_series enable row level security;

create or replace function public.assign_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from now() at time zone 'UTC')::integer;
  v_next integer;
begin
  -- The number belongs to the database: never the client's, never rewritten
  if tg_op = 'UPDATE' then
    new.number := old.number;
    if old.number is not null and new.status = 'draft'
       and coalesce(auth.role(), '') in ('authenticated', 'anon') then
      raise exception 'issued_invoice_locked'
        using errcode = 'BL002', detail = 'An issued invoice cannot go back to draft; cancel it with a credit note.';
    end if;
  else
    new.number := null;
  end if;

  if new.status = 'draft' or new.number is not null then
    return new;
  end if;

  -- The upsert locks the series row until the transaction ends, so concurrent
  -- issues for the same organisation wait for each other and a rolled-back
  -- issue gives its number back.
  insert into invoice_number_series as s (org_id, year, last_number)
  values (new.org_id, v_year, 1)
  on conflict (org_id, year) do update set last_number = s.last_number + 1
  returning last_number into v_next;

  new.number := format('FACT-%s-%s', v_year, lpad(v_next::text, 4, '0'));
  return new;
end;
$$;

-- BEFORE triggers run in name order: the Solo limit check (enforce_…) comes first
drop trigger if exists invoice_number on public.invoices;
create trigger invoice_number
  before insert or update on public.invoices
  for each row execute function public.assign_invoice_number();

-- ── 2. Credit note numbers ───────────────────────────────────────────────────
alter table public.credit_notes add column if not exists number text;

update public.credit_notes set number = id where number is null;

create unique index if not exists credit_notes_org_number_key
  on public.credit_notes (org_id, number)
  where number is not null;

create table if not exists public.credit_note_number_series (
  org_id      uuid    not null references public.organizations(id) on delete cascade,
  year        integer not null,
  last_number integer not null default 0,
  primary key (org_id, year)
);
alter table public.credit_note_number_series enable row level security;

create or replace function public.assign_credit_note_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from now() at time zone 'UTC')::integer;
  v_next integer;
begin
  if tg_op = 'UPDATE' then
    new.number := old.number;
    return new;
  end if;

  insert into credit_note_number_series as s (org_id, year, last_number)
  values (new.org_id, v_year, 1)
  on conflict (org_id, year) do update set last_number = s.last_number + 1
  returning last_number into v_next;

  new.number := format('AV-%s-%s', v_year, lpad(v_next::text, 4, '0'));
  return new;
end;
$$;

drop trigger if exists credit_note_number on public.credit_notes;
create trigger credit_note_number
  before insert or update on public.credit_notes
  for each row execute function public.assign_credit_note_number();

-- ── 3. Issued documents can't be deleted ─────────────────────────────────────
create or replace function public.protect_issued_documents()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return old;
  end if;
  -- Separate branches: credit_notes has no status column
  if tg_table_name = 'credit_notes' then
    raise exception 'issued_document_locked'
      using errcode = 'BL002', detail = 'Credit notes cannot be deleted.';
  elsif old.number is not null or old.status <> 'draft' then
    raise exception 'issued_document_locked'
      using errcode = 'BL002', detail = 'Issued invoices cannot be deleted; cancel them with a credit note.';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_issued_invoice_delete on public.invoices;
create trigger protect_issued_invoice_delete
  before delete on public.invoices
  for each row execute function public.protect_issued_documents();

drop trigger if exists protect_credit_note_delete on public.credit_notes;
create trigger protect_credit_note_delete
  before delete on public.credit_notes
  for each row execute function public.protect_issued_documents();
