-- Invoice templates saved per organisation (PRO-134).
--
-- Until now the Modèles page kept templates in browser memory only, and the
-- PDF ignored them. A row here is a template the organisation saved: a copy of
-- a built-in preset (preset_key) or one it created. At most one row per
-- organisation is the default, and the PDF is drawn from it; with no default
-- the app uses its standard template.
--
-- Everyone in the organisation reads the templates (the PDF needs them);
-- only owners and admins change them, like the other organisation settings.

create table if not exists public.invoice_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  preset_key  text,
  name        text not null check (length(btrim(name)) between 1 and 80),
  config      jsonb not null check (jsonb_typeof(config) = 'object'),
  is_default  boolean not null default false,
  starred     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, preset_key)
);

create index if not exists invoice_templates_org_idx on public.invoice_templates (org_id);
create unique index if not exists invoice_templates_one_default
  on public.invoice_templates (org_id) where is_default;

alter table public.invoice_templates enable row level security;

drop policy if exists "invoice_templates: members read" on public.invoice_templates;
create policy "invoice_templates: members read" on public.invoice_templates
  for select using (org_id in (select public.my_org_ids()));

drop policy if exists "invoice_templates: admins insert" on public.invoice_templates;
create policy "invoice_templates: admins insert" on public.invoice_templates
  for insert with check (org_id in (select public.my_admin_org_ids()));

drop policy if exists "invoice_templates: admins update" on public.invoice_templates;
create policy "invoice_templates: admins update" on public.invoice_templates
  for update using (org_id in (select public.my_admin_org_ids()))
  with check (org_id in (select public.my_admin_org_ids()));

drop policy if exists "invoice_templates: admins delete" on public.invoice_templates;
create policy "invoice_templates: admins delete" on public.invoice_templates
  for delete using (org_id in (select public.my_admin_org_ids()));

-- Makes one template the organisation's default. Two statements in one
-- transaction: the unique index allows a single default per organisation, so
-- the old default is cleared before the new one is set. SECURITY INVOKER, so
-- the policies above decide who may do it; a caller who can't update the row
-- gets an error instead of a silent no-op.
create or replace function public.set_default_invoice_template(p_template_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.invoice_templates where id = p_template_id;
  if v_org is null then
    raise exception 'template not found' using errcode = 'P0002';
  end if;

  update public.invoice_templates
     set is_default = false, updated_at = now()
   where org_id = v_org and is_default and id <> p_template_id;

  update public.invoice_templates
     set is_default = true, updated_at = now()
   where id = p_template_id;
  if not found then
    raise exception 'not allowed to change this organisation''s templates' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.set_default_invoice_template(uuid) from public, anon;
grant execute on function public.set_default_invoice_template(uuid) to authenticated;
grant select, insert, update, delete on public.invoice_templates to authenticated;
