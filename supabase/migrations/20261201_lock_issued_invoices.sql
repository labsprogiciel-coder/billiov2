-- An issued invoice is not modified (DGI): it is corrected with a credit note (COR, RAN, RAM, RRR).
-- From the app, once an invoice is issued:
--   - its client, subject, date, discount and amount no longer change;
--   - its lines can't be added, changed or removed.
-- Its status still moves (paid, overdue), and its « Responsable » can still change.
-- Server code (service role, database functions run by it) is not affected.

create or replace function public.lock_issued_invoice()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') or old.status = 'draft' then
    return new;
  end if;
  if (new.client_code, new.subject, new.issued_at, new.discount_pct, new.amount)
     is distinct from (old.client_code, old.subject, old.issued_at, old.discount_pct, old.amount) then
    raise exception 'issued_invoice_locked'
      using errcode = 'BL002', detail = 'An issued invoice cannot be modified; correct it with a credit note.';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_issued_invoice on public.invoices;
create trigger lock_issued_invoice
  before update on public.invoices
  for each row execute function public.lock_issued_invoice();

create or replace function public.lock_issued_invoice_lines()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_org uuid := coalesce(new.org_id, old.org_id);
  v_inv text := coalesce(new.invoice_id, old.invoice_id);
  v_status text;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  -- The invoices the line belongs to: its own, and on UPDATE the one it leaves (a line can't leave
  -- an issued invoice either). Each is locked by its id first (FOR SHARE), then its status is read:
  -- a status filter in the locking query would skip a draft being issued without waiting for it.
  -- Once the issue commits, the lock returns the invoice as issued.
  for v_status in
    select status from invoices
     where (org_id = v_org and id = v_inv)
        or (tg_op = 'UPDATE' and org_id = old.org_id and id = old.invoice_id)
     order by org_id, id
     for share
  loop
    if v_status <> 'draft' then
      raise exception 'issued_invoice_locked'
        using errcode = 'BL002', detail = 'The lines of an issued invoice cannot change; correct it with a credit note.';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;

drop trigger if exists lock_issued_invoice_lines on public.line_items;
create trigger lock_issued_invoice_lines
  before insert or update or delete on public.line_items
  for each row execute function public.lock_issued_invoice_lines();
