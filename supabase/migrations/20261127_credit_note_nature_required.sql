-- An issued credit note states its nature (PRO-143, DGI annexe « Nature de facture d'avoir »): COR, RAN, RAM or
-- RRR. Both editors already ask for it; the database now refuses an issued credit note without one. NOT VALID:
-- credit notes issued before PRO-168 have none and keep their number as they are.
alter table public.credit_notes drop constraint if exists credit_notes_issued_nature;
alter table public.credit_notes add constraint credit_notes_issued_nature
  check (status <> 'issued' or nature is not null) not valid;
