-- « Responsable » on invoices, quotes and clients (PRO-172).
--
-- owner_id is the team member in charge of the record; owner_name is their
-- name, kept when they leave the team (on delete set null clears owner_id
-- only). The database keeps both, never trusting the app's values:
--
--   * On insert the owner is the person creating the record, or a member of
--     the organisation the app names (so an invoice made from a quote keeps
--     the quote's owner). Anyone else is replaced by the creator.
--   * Afterwards only the organisation's owner and admins can change it, to
--     another current member; other changes are reverted, not refused, so
--     an ordinary save of the record still goes through.
--   * owner_name is always computed here, from the member's profile name or
--     else their e-mail, as for the operator (20261114_invoice_mentions.sql).
--
-- Every role can still read every record of its organisation (as before);
-- « Mes factures » etc. are views in the app.
-- Safe to run more than once.

-- ── Columns ──────────────────────────────────────────────────────────────────
alter table public.invoices add column if not exists owner_id   uuid references auth.users(id) on delete set null;
alter table public.invoices add column if not exists owner_name text;
alter table public.quotes   add column if not exists owner_id   uuid references auth.users(id) on delete set null;
alter table public.quotes   add column if not exists owner_name text;
alter table public.clients  add column if not exists owner_id   uuid references auth.users(id) on delete set null;
alter table public.clients  add column if not exists owner_name text;

create index if not exists invoices_org_owner_idx on public.invoices (org_id, owner_id);
create index if not exists quotes_org_owner_idx   on public.quotes   (org_id, owner_id);
create index if not exists clients_org_owner_idx  on public.clients  (org_id, owner_id);

-- ── Helpers ──────────────────────────────────────────────────────────────────

-- How a member is named on records: profile name, else the e-mail's local part
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

create or replace function public.is_org_member(p_org uuid, p_user uuid)
returns boolean
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select exists (select 1 from public.org_members where org_id = p_org and user_id = p_user);
$$;

create or replace function public.is_org_admin(p_org uuid, p_user uuid)
returns boolean
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select exists (select 1 from public.org_members where org_id = p_org and user_id = p_user and role in ('owner', 'admin'));
$$;

revoke all on function public.member_display_name(uuid) from public, anon, authenticated;
revoke all on function public.is_org_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_org_admin(uuid, uuid) from public, anon, authenticated;

-- ── Trigger ──────────────────────────────────────────────────────────────────
create or replace function public.stamp_record_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if v_uid is not null
       and (new.owner_id is null or not public.is_org_member(new.org_id, new.owner_id)) then
      new.owner_id := v_uid;
    end if;
    new.owner_name := case when new.owner_id is null then null else public.member_display_name(new.owner_id) end;
    return new;
  end if;

  -- UPDATE
  if new.owner_id is not distinct from old.owner_id then
    new.owner_name := old.owner_name;
    return new;
  end if;

  if new.owner_id is null and old.owner_id is not null
     and not exists (select 1 from auth.users u where u.id = old.owner_id) then
    -- The member's account was deleted (on delete set null): keep their name
    new.owner_name := old.owner_name;
  elsif v_uid is null
     or (public.is_org_admin(new.org_id, v_uid)
         and new.owner_id is not null and public.is_org_member(new.org_id, new.owner_id)) then
    -- An admin (or the service role) reassigns it
    new.owner_name := case when new.owner_id is null then null else public.member_display_name(new.owner_id) end;
  else
    new.owner_id   := old.owner_id;
    new.owner_name := old.owner_name;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['invoices', 'quotes', 'clients'] loop
    execute format('drop trigger if exists record_owner on public.%I', t);
    execute format(
      'create trigger record_owner before insert or update of owner_id, owner_name on public.%I
         for each row execute function public.stamp_record_owner()', t);
  end loop;
end $$;

-- Inserts always run the trigger; updates only when owner_id or owner_name is
-- in the SET list, which is the only way to change them.

-- ── Existing records ─────────────────────────────────────────────────────────
-- Invoices: who issued them, else who created them, else the organisation's
-- owner. Quotes: who created them, else the owner. Clients: the owner.
-- These run as the migration (no auth.uid()), so the trigger lets them
-- through and fills owner_name.
-- created_by is read through to_jsonb so this also runs where it is missing.
with org_owner as (
  select distinct on (org_id) org_id, user_id
    from public.org_members
   where role = 'owner'
   order by org_id, user_id
)
update public.invoices i
   set owner_id = coalesce(
         (select u.id from auth.users u where u.id = i.issued_by),
         (select u.id from auth.users u where u.id = nullif(to_jsonb(i) ->> 'created_by', '')::uuid),
         (select o.user_id from org_owner o where o.org_id = i.org_id))
 where i.owner_id is null;

with org_owner as (
  select distinct on (org_id) org_id, user_id
    from public.org_members
   where role = 'owner'
   order by org_id, user_id
)
update public.quotes q
   set owner_id = coalesce(
         (select u.id from auth.users u where u.id = nullif(to_jsonb(q) ->> 'created_by', '')::uuid),
         (select o.user_id from org_owner o where o.org_id = q.org_id))
 where q.owner_id is null;

with org_owner as (
  select distinct on (org_id) org_id, user_id
    from public.org_members
   where role = 'owner'
   order by org_id, user_id
)
update public.clients c
   set owner_id = (select o.user_id from org_owner o where o.org_id = c.org_id)
 where c.owner_id is null;

