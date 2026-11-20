-- PRO-144: copies of an issued invoice say « DUPLICATA » and match the original (DGI spec 2.11, 2.18, 3 f).
-- PRO-145: an issued invoice has no line with a zero or negative amount (DGI spec 2.24, 2.25).
--
-- 1. invoices.issue_snapshot: the seller's and the client's details as they were at issue, taken by
--    the database. A copy is drawn from it, not from today's details.
-- 2. invoices.original_printed_at: when the original PDF was produced. The first PDF of an issued
--    invoice is the original; claim_invoice_original() says whether this one is (once, atomically).
-- 3. A line worth zero or less can't be added to an issued invoice, and an invoice with such a
--    line (or a total of zero or less) can't be issued. Drafts stay permissive while being written.

alter table public.invoices add column if not exists issue_snapshot jsonb;
alter table public.invoices add column if not exists original_printed_at timestamptz;

-- Invoices issued before this migration: snapshot today's details (the best record there is), and
-- count their original as already produced, so every new PDF of them is a copy. Before the
-- triggers below exist, which would keep both columns as they were.
update invoices i set issue_snapshot = jsonb_build_object(
         'seller', (select jsonb_build_object(
                      'name', o.name, 'address', o.address, 'city', o.city, 'country', o.country,
                      'email', o.email, 'phone', o.phone, 'ifu', o.ifu, 'rccm', o.rccm,
                      'tax_regime', o.tax_regime, 'division_fiscale', o.division_fiscale,
                      'cadastral_ref', o.cadastral_ref)
                    from organizations o where o.id = i.org_id),
         'client', (select jsonb_build_object(
                      'name', c.name, 'contact', c.contact, 'email', c.email, 'phone', c.phone,
                      'city', c.city, 'country', c.country, 'ifu', c.ifu, 'rccm', c.rccm,
                      'tax_regime', c.tax_regime, 'fiscal_division', c.fiscal_division,
                      'client_type', c.client_type,
                      'withholding_scenario', c.withholding_scenario)
                    from clients c where c.org_id = i.org_id and c.code = i.client_code))
,
       original_printed_at = coalesce(i.original_printed_at, i.first_issued_at, now())
 where i.status <> 'draft' and i.issue_snapshot is null;

-- ── Snapshot at issue; both columns belong to the database ─────────────────────
create or replace function public.stamp_invoice_issue_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.issue_snapshot := old.issue_snapshot;
    -- Only claim_invoice_original() sets it, once
    if not (coalesce(current_setting('billio.claim_original', true), '') = 'on' and old.original_printed_at is null) then
      new.original_printed_at := old.original_printed_at;
    end if;
    if old.status <> 'draft' then return new; end if;
  else
    new.issue_snapshot      := null;
    new.original_printed_at := null;
  end if;
  if new.status = 'draft' then return new; end if;

  select jsonb_build_object(
           'seller', (select jsonb_build_object(
                        'name', o.name, 'address', o.address, 'city', o.city, 'country', o.country,
                        'email', o.email, 'phone', o.phone, 'ifu', o.ifu, 'rccm', o.rccm,
                        'tax_regime', o.tax_regime, 'division_fiscale', o.division_fiscale,
                        'cadastral_ref', o.cadastral_ref)
                      from organizations o where o.id = new.org_id),
           'client', (select jsonb_build_object(
                        'name', c.name, 'contact', c.contact, 'email', c.email, 'phone', c.phone,
                        'city', c.city, 'country', c.country, 'ifu', c.ifu, 'rccm', c.rccm,
                        'tax_regime', c.tax_regime, 'fiscal_division', c.fiscal_division,
                        'client_type', c.client_type,
                      'withholding_scenario', c.withholding_scenario)
                      from clients c where c.org_id = new.org_id and c.code = new.client_code))
    into new.issue_snapshot;
  return new;
end;
$$;

drop trigger if exists invoice_issue_snapshot on public.invoices;
create trigger invoice_issue_snapshot
  before insert or update on public.invoices
  for each row execute function public.stamp_invoice_issue_snapshot();

-- ── The original, once ───────────────────────────────────────────────────────
-- true: this PDF is the original (first one of the issued invoice); false: a copy (DUPLICATA).
-- Any member who can see the invoice may produce its PDF, observers included.
create or replace function public.claim_invoice_original(p_org_id uuid, p_invoice_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  if p_org_id not in (select public.my_org_ids()) then
    raise exception 'not a member of this organisation' using errcode = '42501';
  end if;
  -- The snapshot trigger keeps original_printed_at unless this flag is on (this transaction only)
  perform set_config('billio.claim_original', 'on', true);
  update invoices set original_printed_at = now()
   where org_id = p_org_id and id = p_invoice_id
     and status <> 'draft' and original_printed_at is null;
  v_claimed := found;
  perform set_config('billio.claim_original', 'off', true);
  return v_claimed;
end;
$$;

revoke all on function public.claim_invoice_original(uuid, text) from public, anon;
grant execute on function public.claim_invoice_original(uuid, text) to authenticated;

-- ── PRO-145: no zero or negative line on an issued invoice ─────────────────────
create or replace function public.check_issued_invoice_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_table_name = 'line_items' then
    if new.invoice_id is null or new.qty * new.price > 0 then return new; end if;
    -- Lock the invoice by its id first (FOR SHARE), then read its status: an issue in progress is
    -- waited for, and the line is checked against the status it commits with
    select status into v_status from invoices where org_id = new.org_id and id = new.invoice_id for share;
    if v_status is not null and v_status <> 'draft' then
      raise exception 'an issued invoice cannot have a line worth zero or less (%)', new.description
        using errcode = '23514', hint = 'zero_line';
    end if;
    return new;
  end if;
  -- invoices: issuing (draft → not draft) checks the lines and the total. The row is locked by the
  -- update itself, so a line being written waits for the issue, or the issue for the line, and
  -- this reads the lines as committed.
  if new.status <> 'draft' and (tg_op = 'INSERT' or old.status = 'draft') then
    if exists (select 1 from line_items where org_id = new.org_id and invoice_id = new.id and qty * price <= 0) then
      raise exception 'an invoice with a line worth zero or less cannot be issued'
        using errcode = '23514', hint = 'zero_line';
    end if;
    if new.amount <= 0 then
      raise exception 'an invoice worth zero or less cannot be issued'
        using errcode = '23514', hint = 'zero_total';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists check_issued_invoice_lines on public.line_items;
create trigger check_issued_invoice_lines
  before insert or update on public.line_items
  for each row execute function public.check_issued_invoice_lines();

drop trigger if exists check_issued_invoice_total on public.invoices;
create trigger check_issued_invoice_total
  before insert or update on public.invoices
  for each row execute function public.check_issued_invoice_lines();
