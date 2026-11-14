-- Checks 20261118_client_documents.sql: who may add, check and delete KYB
-- documents (as the signed-in roles, with row level security), the stamps,
-- and access to the files in the private bucket.
create extension if not exists pgcrypto;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create role anon; create role authenticated;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.invalid', '{"first_name": "Issa"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'compta@example.invalid', '{"first_name": "Fatou"}'),
  ('00000000-0000-0000-0000-0000000000e1', 'awa@example.invalid', '{"first_name": "Awa"}'),
  ('00000000-0000-0000-0000-0000000000f1', 'obs@example.invalid', '{}'),
  ('00000000-0000-0000-0000-0000000000b9', 'other@example.invalid', '{}');
create table public.organizations (id uuid primary key, name text);
create table public.org_members (org_id uuid, user_id uuid, role text);
insert into public.organizations values ('00000000-0000-0000-0000-00000000000a', 'A'), ('00000000-0000-0000-0000-00000000000b', 'B');
insert into public.org_members values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'accountant'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'member'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f1', 'observer'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b9', 'owner');
-- The role helpers the live database has (20261103_role_permissions.sql and earlier)
create function public.my_org_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select org_id from org_members where user_id = auth.uid() $$;
create function public.my_writer_org_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select org_id from org_members where user_id = auth.uid() and role in ('owner', 'admin', 'accountant', 'member') $$;
create function public.my_admin_org_ids() returns setof uuid language sql stable security definer set search_path = public as
  $$ select org_id from org_members where user_id = auth.uid() and role in ('owner', 'admin') $$;
-- Storage, as far as the policies need it
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;

\i ../migrations/20261118_client_documents.sql
\i ../migrations/20261118_client_documents.sql

grant select, insert, update, delete on public.client_documents to authenticated;
-- Files of another organisation, to check they stay out of reach
insert into storage.objects (bucket_id, name) values ('kyb', '00000000-0000-0000-0000-00000000000b/C9/rib.pdf');

create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, true);
end $$;

set role authenticated;
do $$
declare
  a  constant uuid := '00000000-0000-0000-0000-00000000000a';
  b  constant uuid := '00000000-0000-0000-0000-00000000000b';
  failures int := 0;
  n int;
  doc uuid;
begin
  -- A member adds a document, claiming it is already checked
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
  insert into client_documents (org_id, client_code, doc_type, file_path, file_name, status, verified_by_name)
  values (a, 'KB', 'ifu', a || '/KB/ifu-1.pdf', 'ifu.pdf', 'verified', 'Moi') returning id into doc;
  if (select (status, uploaded_by_name, verified_by_name) from client_documents where id = doc) is distinct from ('pending'::text, 'Awa'::text, null::text) then
    failures := failures + 1; raise warning 'member insert stamps';
  end if;
  insert into storage.objects (bucket_id, name) values ('kyb', a || '/KB/ifu-1.pdf');
  -- …but can't check it
  update client_documents set status = 'verified' where id = doc;
  if (select status from client_documents where id = doc) <> 'pending' then
    failures := failures + 1; raise warning 'member checked a document';
  end if;
  -- and can't delete it
  delete from client_documents where id = doc;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures + 1; raise warning 'member deleted a document'; end if;
  -- and can't put files in another organisation's folder
  begin
    insert into storage.objects (bucket_id, name) values ('kyb', b || '/X/hack.pdf');
    failures := failures + 1; raise warning 'member uploaded into another organisation';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from storage.objects where name like b || '%') <> 0 then
    failures := failures + 1; raise warning 'member sees another organisation''s files';
  end if;

  -- The accountant checks it: stamped
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
  update client_documents set status = 'verified', expires_on = '2027-01-31' where id = doc;
  if (select (status, verified_by_name, expires_on) from client_documents where id = doc) is distinct from ('verified'::text, 'Fatou'::text, '2027-01-31'::date)
     or (select verified_at from client_documents where id = doc) is null then
    failures := failures + 1; raise warning 'accountant check';
  end if;

  -- A new file goes back to « à vérifier »
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
  update client_documents set file_path = a || '/KB/ifu-2.pdf' where id = doc;
  if (select (status, verified_by_name) from client_documents where id = doc) is distinct from ('pending'::text, null::text) then
    failures := failures + 1; raise warning 'replaced file kept its check';
  end if;

  -- The observer reads but changes nothing
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
  if (select count(*) from client_documents) <> 1 or (select count(*) from storage.objects) <> 1 then
    failures := failures + 1; raise warning 'observer read';
  end if;
  update client_documents set issued_on = '2020-01-01' where id = doc;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures + 1; raise warning 'observer updated'; end if;

  -- Another organisation sees nothing
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b9', true);
  if (select count(*) from client_documents) <> 0 or (select count(*) from storage.objects where name like a || '%') <> 0 then
    failures := failures + 1; raise warning 'other organisation sees documents';
  end if;

  -- The admin deletes it, and its file
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
  delete from client_documents where id = doc;
  delete from storage.objects where name = a || '/KB/ifu-1.pdf';
  if (select count(*) from client_documents) <> 0 or (select count(*) from storage.objects where name like a || '%') <> 0 then
    failures := failures + 1; raise warning 'admin delete';
  end if;

  if failures > 0 then raise exception '% check(s) failed', failures; end if;
end $$;
reset role;
select 'bucket private' as check, not public from storage.buckets where id = 'kyb';
