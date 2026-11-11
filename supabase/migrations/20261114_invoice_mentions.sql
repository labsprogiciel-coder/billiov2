-- More mentions an invoice must carry (PRO-142; DGI spec v2.0, section 3):
--
-- c. The cadastral reference of the place of sale (section, îlot, parcelle:
--    11 digits, printed SSSS LLL PPPP): organizations.cadastral_ref.
-- y. The operator, i.e. who issued the invoice: invoices.issued_by and
--    issued_by_name, set by the database when the invoice is first issued
--    (from the user's profile name, or their e-mail), never by the app.
--    Invoices issued before this migration have none.
-- w. The date and time of issue come from invoices.first_issued_at
--    (20261111_solo_limit_and_plan_protection.sql).

-- ── c. Cadastral reference ───────────────────────────────────────────────────
alter table public.organizations add column if not exists cadastral_ref text;

alter table public.organizations drop constraint if exists organizations_cadastral_ref_format;
alter table public.organizations add constraint organizations_cadastral_ref_format
  check (cadastral_ref is null or cadastral_ref ~ '^[0-9]{11}$');

-- ── y. Operator ──────────────────────────────────────────────────────────────
alter table public.invoices add column if not exists issued_by uuid references auth.users(id) on delete set null;
alter table public.invoices add column if not exists issued_by_name text;

create or replace function public.stamp_invoice_issuer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Set once, by the database: keep what is stored, never the client's values
  if tg_op = 'UPDATE' then
    new.issued_by      := old.issued_by;
    new.issued_by_name := old.issued_by_name;
    if old.status <> 'draft' then return new; end if;
  else
    new.issued_by      := null;
    new.issued_by_name := null;
  end if;

  if new.status = 'draft' or v_uid is null then
    return new;
  end if;

  new.issued_by := v_uid;
  select coalesce(
           nullif(trim(concat_ws(' ', u.raw_user_meta_data ->> 'first_name', u.raw_user_meta_data ->> 'last_name')), ''),
           nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
           split_part(u.email, '@', 1))
    into new.issued_by_name
    from auth.users u
   where u.id = v_uid;
  return new;
end;
$$;

drop trigger if exists invoice_issuer on public.invoices;
create trigger invoice_issuer
  before insert or update on public.invoices
  for each row execute function public.stamp_invoice_issuer();
