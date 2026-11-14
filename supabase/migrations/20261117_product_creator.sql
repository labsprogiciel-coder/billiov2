-- Who created a catalogue item (PRO-170: the « Créés par moi » filter).
--
-- products.created_by and created_by_name, set by the database when the item
-- is created (a signed-in caller is always its creator) and never rewritten
-- afterwards, except that deleting the member's account clears created_by and
-- keeps the name. Items created before this migration have no creator.
-- Uses member_display_name() from 20261116_change_authors.sql (redefined here
-- so this file also runs on its own). Safe to run more than once.

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

alter table public.products add column if not exists created_by      uuid references auth.users(id) on delete set null;
alter table public.products add column if not exists created_by_name text;

create or replace function public.stamp_product_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if v_uid is not null then new.created_by := v_uid; end if;
    new.created_by_name := case when new.created_by is null then null else public.member_display_name(new.created_by) end;
    return new;
  end if;

  if new.created_by is null and old.created_by is not null
     and not exists (select 1 from auth.users u where u.id = old.created_by) then
    -- The account was deleted (on delete set null): keep the name
    new.created_by_name := old.created_by_name;
  elsif v_uid is null then
    -- Service role / migrations may set it
    new.created_by_name := case
      when new.created_by is null then null
      when new.created_by is distinct from old.created_by or new.created_by_name is null then public.member_display_name(new.created_by)
      else old.created_by_name end;
  else
    new.created_by      := old.created_by;
    new.created_by_name := old.created_by_name;
  end if;
  return new;
end;
$$;

drop trigger if exists product_creator on public.products;
create trigger product_creator
  before insert or update of created_by, created_by_name on public.products
  for each row execute function public.stamp_product_creator();
