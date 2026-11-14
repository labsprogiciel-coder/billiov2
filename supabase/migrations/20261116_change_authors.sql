-- Who recorded a payment, and who last changed a product (PRO-173).
--
-- payments.created_by_name: the name of who recorded it, set by the database
--   from created_by (itself forced to the caller when there is one). Online
--   payments (Paystack webhook, no caller) have none.
-- products.updated_at, updated_by, updated_by_name: when and by whom the item
--   last changed. Only a change of what the item is or costs counts (name,
--   reference, type, unit, price, VAT), not other updates of the row.
--
-- Names follow member_display_name() (20261115_record_owner.sql, redefined
-- here so this file also runs on its own): profile name, else the e-mail's
-- local part. A name stays when the member's account is deleted.
-- Safe to run more than once.

create or replace function public.member_display_name(p_user uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(
           nullif(trim(concat_ws(' ', u.raw_user_meta_data ->> 'first_name', u.raw_user_meta_data ->> 'last_name')), ''),
           nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
           split_part(u.email, '@', 1))
    from auth.users u
   where u.id = p_user;
$$;
revoke all on function public.member_display_name(uuid) from public, anon, authenticated;

-- ── Payments ─────────────────────────────────────────────────────────────────
alter table public.payments add column if not exists created_by_name text;

create or replace function public.stamp_payment_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    -- A signed-in caller records it as themselves; the webhook (no caller)
    -- keeps what it sends
    if v_uid is not null then new.created_by := v_uid; end if;
    new.created_by_name := case when new.created_by is null then null else public.member_display_name(new.created_by) end;
    return new;
  end if;

  if new.created_by is not distinct from old.created_by then
    -- Without a caller (service role, this migration's backfill) the name is
    -- worked out again; a signed-in caller can't rewrite it
    new.created_by_name := case when v_uid is null and new.created_by is not null
                                then public.member_display_name(new.created_by) else old.created_by_name end;
  elsif new.created_by is null and old.created_by is not null
        and not exists (select 1 from auth.users u where u.id = old.created_by) then
    -- The account was deleted (on delete set null): keep the name
    new.created_by_name := old.created_by_name;
  elsif v_uid is null then
    -- Service role / migrations may set it
    new.created_by_name := case when new.created_by is null then null else public.member_display_name(new.created_by) end;
  else
    new.created_by      := old.created_by;
    new.created_by_name := old.created_by_name;
  end if;
  return new;
end;
$$;

drop trigger if exists payment_author on public.payments;
create trigger payment_author
  before insert or update of created_by, created_by_name on public.payments
  for each row execute function public.stamp_payment_author();

-- Existing payments: the name of who recorded them (runs without a caller)
update public.payments p
   set created_by = p.created_by
 where p.created_by is not null and p.created_by_name is null;

-- ── Products ─────────────────────────────────────────────────────────────────
alter table public.products add column if not exists updated_at      timestamptz;
alter table public.products add column if not exists updated_by      uuid references auth.users(id) on delete set null;
alter table public.products add column if not exists updated_by_name text;

create or replace function public.stamp_product_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    if (new.name, new.sku, new.type, new.unit, new.price, new.tax)
       is not distinct from (old.name, old.sku, old.type, old.unit, old.price, old.tax) then
      -- Service role / migrations may set the fields themselves
      if v_uid is null then return new; end if;
      -- Nothing about the item changed: keep the last change as it was,
      -- except when the author's account is deleted (on delete set null)
      if not (new.updated_by is null and old.updated_by is not null
              and not exists (select 1 from auth.users u where u.id = old.updated_by)) then
        new.updated_by := old.updated_by;
      end if;
      new.updated_at      := old.updated_at;
      new.updated_by_name := old.updated_by_name;
      return new;
    end if;
  end if;

  new.updated_at      := now();
  new.updated_by      := v_uid;
  new.updated_by_name := case when v_uid is null then null else public.member_display_name(v_uid) end;
  return new;
end;
$$;

drop trigger if exists product_change on public.products;
create trigger product_change
  before insert or update on public.products
  for each row execute function public.stamp_product_change();

-- Existing items: no author known; their creation date where the table has one
update public.products p
   set updated_at = nullif(to_jsonb(p) ->> 'created_at', '')::timestamptz
 where p.updated_at is null and to_jsonb(p) ? 'created_at';
