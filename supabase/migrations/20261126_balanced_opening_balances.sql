-- Opening balances (à-nouveaux) must balance (PRO-121).
--
-- The trial balance reads its opening column from opening_balances. They could be adopted unbalanced
-- (« vous pouvez tout de même adopter »), which left the books out of balance: debits and credits of the
-- exercise no longer matched and the gap showed as a profit or loss. From now on:
--   * a transaction that leaves an exercise's opening balances unbalanced is refused, checked at its end, so
--     an adoption that saves several rows at once passes when the whole is balanced;
--   * balance_opening_balances() puts the gap of an exercise already adopted unbalanced on 471, the suspense
--     account, where it shows until an OD entry moves it to the right account.

create or replace function public.check_opening_balanced()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_org uuid := coalesce(new.org_id, old.org_id);
  v_year smallint := coalesce(new.exercise_year, old.exercise_year);
  v_gap numeric;
begin
  select coalesce(sum(signed_amount), 0) into v_gap from opening_balances where org_id = v_org and exercise_year = v_year;
  if abs(v_gap) >= 0.5 then
    raise exception 'Opening balances for % are unbalanced by %', v_year, v_gap
      using errcode = 'P0001', hint = 'opening_unbalanced';
  end if;
  return null;
end;
$$;

drop trigger if exists opening_balanced on public.opening_balances;
create constraint trigger opening_balanced
  after insert or update or delete on public.opening_balances
  deferrable initially deferred
  for each row execute function public.check_opening_balanced();

-- Puts the gap of an exercise's opening balances on 471, so they balance. Returns the gap moved (debit
-- positive). Runs with the caller's rights: only an admin can write opening balances (RLS).
create or replace function public.balance_opening_balances(p_org_id uuid, p_year smallint)
returns numeric
language plpgsql
set search_path = public
as $$
declare
  v_gap numeric;
begin
  select coalesce(sum(signed_amount), 0) into v_gap from opening_balances where org_id = p_org_id and exercise_year = p_year;
  if abs(v_gap) < 0.5 then return 0; end if;
  insert into opening_balances (org_id, exercise_year, account_num, signed_amount)
  values (p_org_id, p_year, '471', -v_gap)
  on conflict (org_id, account_num, exercise_year) do update set signed_amount = opening_balances.signed_amount - v_gap;
  if not found then
    raise exception 'Opening balances could not be balanced (not allowed?)' using errcode = '42501';
  end if;
  return v_gap;
end;
$$;

revoke all on function public.balance_opening_balances(uuid, smallint) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.balance_opening_balances(uuid, smallint) to authenticated;
  end if;
end;
$$;
