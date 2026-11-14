-- Members see only their own records (PRO-172 decision).
--
-- A member (org_members.role = 'member') now reads and changes only:
--   * the invoices, quotes and clients they are « Responsable » of (owner_id,
--     20261115_record_owner.sql);
--   * clients that appear on their own invoices or quotes (read only), so
--     their documents still show the client;
--   * the payments, credit notes and lines of their own invoices and quotes;
--   * the activity entries they created.
-- Owners, admins, accountants and observers still read everything; who may
-- write, check or delete is unchanged (20261103_role_permissions.sql).
-- Products and settings stay shared. Safe to run more than once.

-- ── Helpers (security definer: no nested row level security) ────────────────

-- Every record of the organisation: all roles but 'member'
create or replace function public.sees_all_records(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select exists (select 1 from public.org_members
                  where org_id = p_org and user_id = auth.uid() and role in ('owner', 'admin', 'accountant', 'observer'));
$$;

create or replace function public.owns_invoice(p_org uuid, p_invoice text)
returns boolean
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select exists (select 1 from public.invoices where org_id = p_org and id = p_invoice and owner_id = auth.uid());
$$;

create or replace function public.owns_quote(p_org uuid, p_quote text)
returns boolean
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select exists (select 1 from public.quotes where org_id = p_org and id = p_quote and owner_id = auth.uid());
$$;

-- A client the caller owns, or one on an invoice or quote they own
create or replace function public.sees_client(p_org uuid, p_code text, p_owner uuid)
returns boolean
language sql stable security definer
set search_path = public
set row_security = off
as $$
  select p_owner = auth.uid()
      or exists (select 1 from public.invoices where org_id = p_org and client_code = p_code and owner_id = auth.uid())
      or exists (select 1 from public.quotes   where org_id = p_org and client_code = p_code and owner_id = auth.uid());
$$;

revoke all on function public.sees_all_records(uuid) from public, anon;
revoke all on function public.owns_invoice(uuid, text) from public, anon;
revoke all on function public.owns_quote(uuid, text) from public, anon;
revoke all on function public.sees_client(uuid, text, uuid) from public, anon;
grant execute on function public.sees_all_records(uuid) to authenticated;
grant execute on function public.owns_invoice(uuid, text) to authenticated;
grant execute on function public.owns_quote(uuid, text) to authenticated;
grant execute on function public.sees_client(uuid, text, uuid) to authenticated;

-- ── Invoices and quotes: their own ──────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['invoices', 'quotes'] loop
    execute format('drop policy if exists %I on public.%I', t || ': members read', t);
    execute format('drop policy if exists %I on public.%I', t || ': writers update', t);
    execute format(
      'create policy %I on public.%I for select using (org_id in (select public.my_org_ids()) '
      || 'and (public.sees_all_records(org_id) or owner_id = auth.uid()))', t || ': members read', t);
    execute format(
      'create policy %I on public.%I for update '
      || 'using (org_id in (select public.my_writer_org_ids()) and (public.sees_all_records(org_id) or owner_id = auth.uid())) '
      || 'with check (org_id in (select public.my_writer_org_ids()))', t || ': writers update', t);
  end loop;
end $$;

-- ── Clients: their own, and those on their documents (read only) ────────────
drop policy if exists "clients: members read" on public.clients;
drop policy if exists "clients: writers update" on public.clients;
create policy "clients: members read" on public.clients for select
  using (org_id in (select public.my_org_ids())
         and (public.sees_all_records(org_id) or public.sees_client(org_id, code, owner_id)));
create policy "clients: writers update" on public.clients for update
  using (org_id in (select public.my_writer_org_ids()) and (public.sees_all_records(org_id) or owner_id = auth.uid()))
  with check (org_id in (select public.my_writer_org_ids()));

-- ── Payments and credit notes: those of their own invoices ──────────────────
drop policy if exists "payments: members read" on public.payments;
drop policy if exists "payments: writers insert" on public.payments;
drop policy if exists "payments: writers update" on public.payments;
create policy "payments: members read" on public.payments for select
  using (org_id in (select public.my_org_ids()) and (public.sees_all_records(org_id) or public.owns_invoice(org_id, inv_id)));
create policy "payments: writers insert" on public.payments for insert
  with check (org_id in (select public.my_writer_org_ids()) and (public.sees_all_records(org_id) or public.owns_invoice(org_id, inv_id)));
create policy "payments: writers update" on public.payments for update
  using (org_id in (select public.my_writer_org_ids()) and (public.sees_all_records(org_id) or public.owns_invoice(org_id, inv_id)))
  with check (org_id in (select public.my_writer_org_ids()));

drop policy if exists "credit_notes: members read" on public.credit_notes;
drop policy if exists "credit_notes: writers insert" on public.credit_notes;
drop policy if exists "credit_notes: writers update" on public.credit_notes;
create policy "credit_notes: members read" on public.credit_notes for select
  using (org_id in (select public.my_org_ids()) and (public.sees_all_records(org_id) or public.owns_invoice(org_id, invoice_id)));
create policy "credit_notes: writers insert" on public.credit_notes for insert
  with check (org_id in (select public.my_writer_org_ids()) and (public.sees_all_records(org_id) or public.owns_invoice(org_id, invoice_id)));
create policy "credit_notes: writers update" on public.credit_notes for update
  using (org_id in (select public.my_writer_org_ids()) and (public.sees_all_records(org_id) or public.owns_invoice(org_id, invoice_id)))
  with check (org_id in (select public.my_writer_org_ids()));

-- ── Lines: those of their own invoices and quotes ───────────────────────────
-- The FOR ALL write policy also granted reading (permissive policies are
-- OR'd), so it is split into insert, update and delete.
drop policy if exists "line_items: members read" on public.line_items;
drop policy if exists "line_items: writers write" on public.line_items;
drop policy if exists "line_items: writers insert" on public.line_items;
drop policy if exists "line_items: writers update" on public.line_items;
drop policy if exists "line_items: writers delete" on public.line_items;
create policy "line_items: members read" on public.line_items for select
  using (org_id in (select public.my_org_ids())
         and (public.sees_all_records(org_id) or public.owns_invoice(org_id, invoice_id) or public.owns_quote(org_id, quote_id)));
create policy "line_items: writers insert" on public.line_items for insert
  with check (org_id in (select public.my_writer_org_ids())
              and (public.sees_all_records(org_id) or public.owns_invoice(org_id, invoice_id) or public.owns_quote(org_id, quote_id)));
create policy "line_items: writers update" on public.line_items for update
  using (org_id in (select public.my_writer_org_ids())
         and (public.sees_all_records(org_id) or public.owns_invoice(org_id, invoice_id) or public.owns_quote(org_id, quote_id)))
  with check (org_id in (select public.my_writer_org_ids()));
create policy "line_items: writers delete" on public.line_items for delete
  using (org_id in (select public.my_writer_org_ids())
         and (public.sees_all_records(org_id) or public.owns_invoice(org_id, invoice_id) or public.owns_quote(org_id, quote_id)));

-- ── Activity feed: the entries they created ─────────────────────────────────
alter table public.activities add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;
drop policy if exists "activities: members read" on public.activities;
create policy "activities: members read" on public.activities for select
  using (org_id in (select public.my_org_ids()) and (public.sees_all_records(org_id) or created_by = auth.uid()));
