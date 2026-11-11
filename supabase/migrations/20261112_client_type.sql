-- Client type of the DGI specification (spec v2.0, 2.14; PRO-140):
-- CC client comptant, PM personne morale, PP personne physique,
-- PC personne physique commerçant. Printed on the invoice; the IFU is
-- mandatory for PM and PC.

alter table public.clients add column if not exists client_type text;

-- Existing clients: a company when they have an IFU, an individual otherwise
update public.clients
   set client_type = case when coalesce(btrim(ifu), '') <> '' then 'PM' else 'PP' end
 where client_type is null;

alter table public.clients alter column client_type set default 'PP';
alter table public.clients alter column client_type set not null;

alter table public.clients drop constraint if exists clients_client_type_check;
alter table public.clients add constraint clients_client_type_check
  check (client_type in ('CC', 'PM', 'PP', 'PC'));
