-- Checks 20261128_line_tax_groups.sql on a minimal schema: older lines keep no group (taxed as B,
-- or H without VAT); a line takes one of the DGI groups A to P and nothing else.
create table public.line_items (id serial primary key, description text not null);
insert into public.line_items (description) values ('ancienne ligne');

\i ../migrations/20261128_line_tax_groups.sql
-- Twice: safe to run again
\i ../migrations/20261128_line_tax_groups.sql

do $$
declare
  failures int := 0;
begin
  if (select tax_group from line_items where description = 'ancienne ligne') is not null then
    failures := failures + 1; raise warning 'an older line was given a group';
  end if;
  insert into line_items (description, tax_group) values ('taxable', 'B'), ('exonéré', 'A'), ('réservé', 'P');
  begin
    insert into line_items (description, tax_group) values ('inconnu', 'Q');
    failures := failures + 1; raise warning 'group Q was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into line_items (description, tax_group) values ('minuscule', 'b');
    failures := failures + 1; raise warning 'a lowercase group was accepted';
  exception when check_violation then null;
  end;
  if failures > 0 then raise exception '% check(s) failed', failures; end if;
end $$;
