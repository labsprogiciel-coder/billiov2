-- KYB file on clients (PRO-176): the business documents of each client, with
-- their dates and whether someone checked them.
--
-- client_documents: one current document per client and type (replacing it
-- updates the row). The files live in the private Storage bucket « kyb »,
-- under <org_id>/<client_code>/…, readable only by the organisation's members.
--
-- Who can do what (enforced here, mirrored in the app):
--   * every member reads;
--   * owner, admin, accountant, member add and replace documents;
--   * owner, admin, accountant check them (Vérifié / Refusé);
--   * owner, admin delete them;
--   * observers only read.
-- The database stamps who uploaded and who checked, never the app. A new file
-- goes back to « à vérifier ».
-- Uses member_display_name() (20261116_change_authors.sql, redefined here so
-- this file also runs on its own). Safe to run more than once.

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

create table if not exists public.client_documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  client_code      text not null,
  doc_type         text not null,
  file_path        text not null,
  file_name        text not null default '',
  issued_on        date,
  expires_on       date,
  status           text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  uploaded_by      uuid references auth.users(id) on delete set null,
  uploaded_by_name text,
  uploaded_at      timestamptz not null default now(),
  verified_by      uuid references auth.users(id) on delete set null,
  verified_by_name text,
  verified_at      timestamptz,
  unique (org_id, client_code, doc_type)
);
create index if not exists client_documents_org_idx on public.client_documents (org_id, client_code);

alter table public.client_documents enable row level security;

drop policy if exists "client_documents: members read"    on public.client_documents;
drop policy if exists "client_documents: writers insert"  on public.client_documents;
drop policy if exists "client_documents: writers update"  on public.client_documents;
drop policy if exists "client_documents: admins delete"   on public.client_documents;
create policy "client_documents: members read"   on public.client_documents for select using (org_id in (select public.my_org_ids()));
create policy "client_documents: writers insert" on public.client_documents for insert with check (org_id in (select public.my_writer_org_ids()));
create policy "client_documents: writers update" on public.client_documents for update
  using (org_id in (select public.my_writer_org_ids())) with check (org_id in (select public.my_writer_org_ids()));
create policy "client_documents: admins delete"  on public.client_documents for delete using (org_id in (select public.my_admin_org_ids()));

-- ── Stamps and the checking rule ─────────────────────────────────────────────
create or replace function public.stamp_client_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_can_check boolean := v_uid is null
    or exists (select 1 from public.org_members m where m.org_id = new.org_id and m.user_id = v_uid and m.role in ('owner', 'admin', 'accountant'));
begin
  if tg_op = 'INSERT' or new.file_path is distinct from old.file_path then
    -- A new file: to check again, uploaded by the caller
    new.status := 'pending';
    new.verified_by := null; new.verified_by_name := null; new.verified_at := null;
    if v_uid is not null or tg_op = 'INSERT' then
      new.uploaded_by := coalesce(v_uid, new.uploaded_by);
    end if;
    new.uploaded_by_name := case when new.uploaded_by is null then null else public.member_display_name(new.uploaded_by) end;
    new.uploaded_at := now();
    return new;
  end if;

  -- Same file. Who uploaded never changes (but a deleted account clears it)
  if not (new.uploaded_by is null and old.uploaded_by is not null
          and not exists (select 1 from auth.users u where u.id = old.uploaded_by)) then
    new.uploaded_by := old.uploaded_by;
  end if;
  new.uploaded_by_name := old.uploaded_by_name;
  new.uploaded_at := old.uploaded_at;

  if new.status is distinct from old.status and v_can_check then
    -- Checked (or sent back) now, by the caller
    if new.status = 'pending' then
      new.verified_by := null; new.verified_by_name := null; new.verified_at := null;
    else
      new.verified_by := v_uid;
      new.verified_by_name := case when v_uid is null then null else public.member_display_name(v_uid) end;
      new.verified_at := now();
    end if;
  else
    -- Only those who check may change the status; the stamps are the database's
    new.status := old.status;
    if not (new.verified_by is null and old.verified_by is not null
            and not exists (select 1 from auth.users u where u.id = old.verified_by)) then
      new.verified_by := old.verified_by;
    end if;
    new.verified_by_name := old.verified_by_name;
    new.verified_at := old.verified_at;
  end if;
  return new;
end;
$$;

drop trigger if exists client_document_stamps on public.client_documents;
create trigger client_document_stamps
  before insert or update on public.client_documents
  for each row execute function public.stamp_client_document();

-- ── Files: private bucket, one folder per organisation ──────────────────────
insert into storage.buckets (id, name, public)
values ('kyb', 'kyb', false)
on conflict (id) do update set public = false;

drop policy if exists "kyb: members read"    on storage.objects;
drop policy if exists "kyb: writers upload"  on storage.objects;
drop policy if exists "kyb: admins delete"   on storage.objects;
create policy "kyb: members read" on storage.objects for select
  using (bucket_id = 'kyb' and (storage.foldername(name))[1] in (select o::text from public.my_org_ids() o));
create policy "kyb: writers upload" on storage.objects for insert
  with check (bucket_id = 'kyb' and (storage.foldername(name))[1] in (select o::text from public.my_writer_org_ids() o));
create policy "kyb: admins delete" on storage.objects for delete
  using (bucket_id = 'kyb' and (storage.foldername(name))[1] in (select o::text from public.my_admin_org_ids() o));
