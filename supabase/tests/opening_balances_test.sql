-- Checks 20261126_balanced_opening_balances.sql: unbalanced opening balances are refused at the end of a
-- transaction, and an exercise already unbalanced can be balanced on 471.
create table public.opening_balances (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, account_num text not null,
  exercise_year smallint not null, signed_amount numeric not null default 0, unique (org_id, account_num, exercise_year)
);
-- the live case (PRO-121): adopted before this migration, 2 425 000 debit vs 1 600 000 credit
insert into public.opening_balances (org_id, account_num, exercise_year, signed_amount) values
  ('00000000-0000-0000-0000-0000000000a1', '521', 2026, 2425000),
  ('00000000-0000-0000-0000-0000000000a1', '101', 2026, -1100000),
  ('00000000-0000-0000-0000-0000000000a1', '211', 2026, -500000);

\i ../migrations/20261126_balanced_opening_balances.sql

do $$
declare
  org constant uuid := '00000000-0000-0000-0000-0000000000a1';
  failures int := 0; ok boolean; v numeric;
begin
  -- a balanced adoption (several rows in one statement) passes
  insert into opening_balances (org_id, account_num, exercise_year, signed_amount) values (org, '521', 2027, 1000), (org, '101', 2027, -1000);
  set constraints all immediate;
  set constraints all deferred;

  -- an unbalanced one is refused at the end of its transaction
  ok := false;
  begin
    insert into opening_balances (org_id, account_num, exercise_year, signed_amount) values (org, '521', 2028, 1000), (org, '101', 2028, -400);
    set constraints all immediate;
  exception when others then ok := sqlerrm like '%unbalanced by 600%';
  end;
  set constraints all deferred;
  if not ok then raise warning 'unbalanced adoption accepted'; failures := failures + 1; end if;
  if exists (select 1 from opening_balances where exercise_year = 2028) then raise warning '2028 rows kept'; failures := failures + 1; end if;

  -- the live case: balanced on 471, then it holds
  v := balance_opening_balances(org, 2026::smallint);
  set constraints all immediate;
  set constraints all deferred;
  if v <> 825000 then raise warning 'gap moved: %', v; failures := failures + 1; end if;
  if (select signed_amount from opening_balances where org_id = org and exercise_year = 2026 and account_num = '471') <> -825000 then raise warning '471 row'; failures := failures + 1; end if;
  if (select sum(signed_amount) from opening_balances where exercise_year = 2026) <> 0 then raise warning 'still unbalanced'; failures := failures + 1; end if;
  if balance_opening_balances(org, 2026::smallint) <> 0 then raise warning 'second call moved something'; failures := failures + 1; end if;

  -- editing one row of a balanced exercise without its counterpart is refused
  ok := false;
  begin
    update opening_balances set signed_amount = 3000000 where org_id = org and exercise_year = 2026 and account_num = '521';
    set constraints all immediate;
  exception when others then ok := sqlerrm like '%unbalanced%';
  end;
  set constraints all deferred;
  if not ok then raise warning 'one-sided edit accepted'; failures := failures + 1; end if;

  -- clearing an exercise (an adoption done again) is fine
  delete from opening_balances where org_id = org and exercise_year = 2027;
  set constraints all immediate;
  set constraints all deferred;

  if failures > 0 then raise exception '% check(s) failed', failures; end if;
end;
$$;
