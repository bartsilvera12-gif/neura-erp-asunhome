-- Fase 4 (solo schema reservacaacupe): nota de remisión (documento NO fiscal).
-- 1) clientes.usa_nota_remision: marca si el cliente requiere nota de remisión.
-- 2) ventas.genera_nota_remision + ventas.nota_remision_numero: la venta emite nota (NR-XXXXXX).
-- Idempotente. Aplicar con rol con privilegios DDL (supabase_admin). No toca SIFEN.

ALTER TABLE reservacaacupe.clientes
  ADD COLUMN IF NOT EXISTS usa_nota_remision boolean NOT NULL DEFAULT false;

ALTER TABLE reservacaacupe.ventas
  ADD COLUMN IF NOT EXISTS genera_nota_remision boolean NOT NULL DEFAULT false;

ALTER TABLE reservacaacupe.ventas
  ADD COLUMN IF NOT EXISTS nota_remision_numero text;
