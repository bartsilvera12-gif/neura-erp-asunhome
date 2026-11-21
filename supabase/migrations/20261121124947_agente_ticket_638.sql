-- Cambios de estructura aplicados por el Agente IA (ticket #638, neura-erp-asunhome). Ya están en la base.

-- Registrar productos recibidos como obsequio en compras
alter table asunhome.compras add column if not exists es_obsequio boolean not null default false, add column if not exists precio_original numeric, add column if not exists descuento_pct numeric;
