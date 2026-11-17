-- Payments matched with the bank or Mobile Money statement (PRO-175): « À rapprocher » / « Rapproché ».
--
-- An accountant ticks a payment once they have found it on the statement. Only a completed payment can be
-- matched, and only the owner, an admin or an accountant may mark or unmark it (my_posting_org_ids, the same
-- people who post journal entries). Who did it and when is set here, never sent by the app.

alter table public.payments
  add column if not exists reconciled_at      timestamptz,
  add column if not exists reconciled_by      uuid references auth.users (id) on delete set null,
  add column if not exists reconciled_by_name text;

create or replace function public.stamp_payment_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user boolean := coalesce(auth.role(), '') in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    -- a payment is recorded unmatched; matching is a separate step
    if v_user then new.reconciled_at := null; new.reconciled_by := null; new.reconciled_by_name := null; end if;
    return new;
  end if;

  if new.reconciled_at is not distinct from old.reconciled_at
     and new.reconciled_by is not distinct from old.reconciled_by
     and new.reconciled_by_name is not distinct from old.reconciled_by_name then
    return new;
  end if;

  if v_user then
    if new.org_id not in (select public.my_posting_org_ids()) then
      raise exception 'only an accountant or an admin can match a payment with the statement' using errcode = '42501';
    end if;
    if new.reconciled_at is not null and old.reconciled_at is null then
      new.reconciled_at := now();
      new.reconciled_by := v_uid;
      new.reconciled_by_name := public.member_display_name(v_uid);
    elsif new.reconciled_at is null then
      new.reconciled_by := null;
      new.reconciled_by_name := null;
    else
      -- already matched: who and when stay as they were
      new.reconciled_at := old.reconciled_at;
      new.reconciled_by := old.reconciled_by;
      new.reconciled_by_name := old.reconciled_by_name;
    end if;
  end if;

  if new.reconciled_at is not null and new.status <> 'completed' then
    raise exception 'only a completed payment can be matched with the statement' using errcode = 'P0001', hint = 'not_completed';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_reconciliation on public.payments;
create trigger payment_reconciliation
  before insert or update on public.payments
  for each row execute function public.stamp_payment_reconciliation();

-- the « À rapprocher » filter on large lists
create index if not exists payments_to_reconcile on public.payments (org_id, date) where reconciled_at is null and status = 'completed';
