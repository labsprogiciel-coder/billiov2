-- Billing rules enforced by the database, so the app can't be bypassed.
--
-- 1. Only Billio changes an organisation's plan. Organisation admins can
--    update their organisation row (name, IFU, invoice settings…), and that
--    policy also let them set plan, plan_status, plan_renews_at and
--    trial_ends_at themselves, i.e. give themselves a paid plan. Requests made
--    with a user's token (role authenticated or anon) can no longer change
--    those columns; the Supabase dashboard / SQL editor and the service role
--    still can.
--
-- 2. The free Solo plan issues at most 5 invoices per calendar month (UTC).
--    An invoice counts when it is first issued (leaves draft), timestamped by
--    the database in first_issued_at, so neither the invoice date nor a
--    client-supplied timestamp can dodge the limit. Drafts are unlimited.
--    Paid plans are unlimited.

-- ── 1. Plan columns ─────────────────────────────────────────────────────────
create or replace function public.protect_org_plan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') and (
       new.plan           is distinct from old.plan
    or new.plan_status    is distinct from old.plan_status
    or new.plan_renews_at is distinct from old.plan_renews_at
    or new.trial_ends_at  is distinct from old.trial_ends_at
  ) then
    raise exception 'the plan can only be changed by Billio' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_org_plan on public.organizations;
create trigger protect_org_plan
  before update on public.organizations
  for each row execute function public.protect_org_plan();

-- ── 2. Solo monthly invoice limit ───────────────────────────────────────────
alter table public.invoices add column if not exists first_issued_at timestamptz;

-- Invoices issued before this migration count from their creation
update public.invoices
   set first_issued_at = created_at
 where status <> 'draft' and first_issued_at is null;

create index if not exists invoices_org_first_issued_idx
  on public.invoices (org_id, first_issued_at)
  where first_issued_at is not null;

create or replace function public.enforce_solo_invoice_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c_limit constant int := 5;
  v_plan  text;
  v_count int;
  v_month timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
begin
  -- first_issued_at belongs to the database: keep the stored value, never the client's
  if tg_op = 'UPDATE' then
    new.first_issued_at := old.first_issued_at;
  else
    new.first_issued_at := null;
  end if;

  -- Drafts, and invoices that were already issued once, don't count (again)
  if new.status = 'draft' or new.first_issued_at is not null then
    return new;
  end if;

  new.first_issued_at := now();

  select plan into v_plan from public.organizations where id = new.org_id;
  if v_plan = 'solo' then
    -- Serialise concurrent issues for the same organisation
    perform pg_advisory_xact_lock(hashtext('solo_invoice_limit:' || new.org_id::text));
    select count(*) into v_count
      from public.invoices
     where org_id = new.org_id
       and first_issued_at >= v_month
       and id <> new.id;
    if v_count >= c_limit then
      raise exception 'solo_invoice_limit'
        using errcode = 'P0001',
              detail  = format('The Solo plan allows %s issued invoices per month.', c_limit),
              hint    = 'Upgrade to Business for unlimited invoices.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_solo_invoice_limit on public.invoices;
create trigger enforce_solo_invoice_limit
  before insert or update on public.invoices
  for each row execute function public.enforce_solo_invoice_limit();
