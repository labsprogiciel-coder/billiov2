-- Role × command matrix for invoice_templates (PRO-134), plus the
-- set_default_invoice_template RPC. Runs after role_permissions_setup.sql and
-- the migration. Raises if any cell differs from what is expected.
create or replace function pg_temp.try(p_user uuid, p_sql text) returns text language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  set local role authenticated;
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    n := 0;
  end;
  reset role;
  return case when n > 0 then 'Y' else 'n' end;
end $$;

do $$
declare
  org constant uuid := '00000000-0000-0000-0000-00000000000a';
  users constant text[] := array['owner','admin','accountant','member','observer','outsider'];
  uids  constant uuid[] := array['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',
                                 '00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004',
                                 '00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006']::uuid[];
  -- select / insert / update / delete / set default, in the order of users[]
  expected constant text[] := array['YYYYY','YYYYY','Ynnnn','Ynnnn','Ynnnn','nnnnn'];
  i int; row_id uuid; other_id uuid; got text; rpc text; failures int := 0; defaults int;
begin
  for i in 1 .. array_length(users, 1) loop
    insert into public.invoice_templates (org_id, name, config) values (org, 'seed', '{}') returning id into row_id;
    got := pg_temp.try(uids[i], format('select 1 from public.invoice_templates where id = %L', row_id))
        || pg_temp.try(uids[i], format('insert into public.invoice_templates (org_id, name, config) values (%L, %L, %L)', org, 'new', '{}'))
        || pg_temp.try(uids[i], format('update public.invoice_templates set name = %L where id = %L', 'edited', row_id))
        || pg_temp.try(uids[i], format('delete from public.invoice_templates where id = %L', row_id));
    -- The RPC returns void: count it as allowed when it runs and the row became the default
    insert into public.invoice_templates (org_id, name, config) values (org, 'target', '{}') returning id into row_id;
    -- (two statements: one statement's subquery would not see the RPC's update)
    rpc := pg_temp.try(uids[i], format('select public.set_default_invoice_template(%L)', row_id));
    got := got || case when rpc = 'Y' and (select is_default from public.invoice_templates where id = row_id)
                       then 'Y' else 'n' end;
    if got <> expected[i] then
      failures := failures + 1;
      raise warning 'invoice_templates as %: got % want % (select/insert/update/delete/default)', users[i], got, expected[i];
    end if;
  end loop;

  -- Switching the default keeps exactly one default per organisation
  insert into public.invoice_templates (org_id, name, config) values (org, 'first', '{}') returning id into row_id;
  insert into public.invoice_templates (org_id, name, config) values (org, 'second', '{}') returning id into other_id;
  perform pg_temp.try(uids[1], format('select public.set_default_invoice_template(%L)', row_id));
  perform pg_temp.try(uids[1], format('select public.set_default_invoice_template(%L)', other_id));
  select count(*) into defaults from public.invoice_templates where org_id = org and is_default;
  if defaults <> 1 or not (select is_default from public.invoice_templates where id = other_id) then
    failures := failures + 1;
    raise warning 'switching the default left % defaults', defaults;
  end if;

  -- Malformed rows are refused
  begin
    insert into public.invoice_templates (org_id, name, config) values (org, '  ', '{}');
    failures := failures + 1; raise warning 'blank name accepted';
  exception when check_violation then null; end;
  begin
    insert into public.invoice_templates (org_id, name, config) values (org, 'x', '[]');
    failures := failures + 1; raise warning 'non-object config accepted';
  exception when check_violation then null; end;

  if failures > 0 then raise exception '% invoice_templates check(s) failed', failures; end if;
end $$;
