-- A converted quote links to the invoice it became (PRO-165 follow-up).
-- quotes.invoice_id holds the invoice's internal id (its key within the
-- organisation), set by the app when it converts the quote. Quotes converted
-- before this have none. Safe to run more than once.

alter table public.quotes add column if not exists invoice_id text;
create index if not exists quotes_org_invoice_idx on public.quotes (org_id, invoice_id) where invoice_id is not null;
