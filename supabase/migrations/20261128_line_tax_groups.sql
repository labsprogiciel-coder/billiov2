-- PRO-138: each invoice or quote line carries its DGI tax group (spec v2.0, 2.15).
-- Older lines keep null: the app taxes them as B (18 %), or H for an organisation that doesn't charge VAT,
-- which is how they were taxed when they were saved.
alter table public.line_items add column if not exists tax_group text;
alter table public.line_items drop constraint if exists line_items_tax_group_check;
alter table public.line_items add constraint line_items_tax_group_check
  check (tax_group is null or tax_group in ('A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P'));
