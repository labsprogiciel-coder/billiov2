-- Checks 20261127_credit_note_nature_required.sql: an issued credit note needs a nature; drafts and older
-- issued credit notes (no nature) are left as they are.
create table public.credit_notes (id text, org_id uuid, status text not null default 'issued', nature text, amount numeric);
insert into public.credit_notes (id, status, nature) values ('AV-OLD', 'issued', null);

\i ../migrations/20261127_credit_note_nature_required.sql

do $$
declare failures int := 0; ok boolean;
begin
  insert into credit_notes (id, status, nature) values ('AV-1', 'issued', 'COR'), ('AV-D', 'draft', null);
  ok := false; begin insert into credit_notes (id, status, nature) values ('AV-2', 'issued', null); exception when check_violation then ok := true; end;
  if not ok then raise warning 'issued without nature accepted'; failures := failures + 1; end if;
  ok := false; begin update credit_notes set status = 'issued' where id = 'AV-D'; exception when check_violation then ok := true; end;
  if not ok then raise warning 'draft issued without nature'; failures := failures + 1; end if;
  if not exists (select 1 from credit_notes where id = 'AV-OLD') then raise warning 'old row lost'; failures := failures + 1; end if;
  if failures > 0 then raise exception '% check(s) failed', failures; end if;
end;
$$;
