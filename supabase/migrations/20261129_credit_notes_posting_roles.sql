-- PRO-174: credit notes are issued by the roles that post entries (owner, admin, accountant).
-- An issued credit note books its entry (AV-…), which only those roles may post; members and
-- observers still read the credit notes of the invoices they see.
drop policy if exists "credit_notes: writers insert" on public.credit_notes;
drop policy if exists "credit_notes: writers update" on public.credit_notes;
drop policy if exists "credit_notes: writers delete drafts" on public.credit_notes;
drop policy if exists "credit_notes: posters insert" on public.credit_notes;
drop policy if exists "credit_notes: posters update" on public.credit_notes;
drop policy if exists "credit_notes: posters delete drafts" on public.credit_notes;

create policy "credit_notes: posters insert" on public.credit_notes for insert
  with check (org_id in (select public.my_posting_org_ids()));
create policy "credit_notes: posters update" on public.credit_notes for update
  using (org_id in (select public.my_posting_org_ids()))
  with check (org_id in (select public.my_posting_org_ids()));
create policy "credit_notes: posters delete drafts" on public.credit_notes for delete
  using (status = 'draft' and org_id in (select public.my_posting_org_ids()));
