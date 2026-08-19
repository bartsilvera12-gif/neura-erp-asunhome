-- Fase 3 (solo schema reservacaacupe): cobro inteligente + entidades bancarias.
-- 1) Código corto en entidades_bancarias (para búsqueda rápida por código).
-- 2) Único por empresa cuando el código no es null/vacío (case-insensitive).
-- 3) Titular del pago en ventas_pagos_detalle (quién transfirió).
-- Idempotente. Aplicar con rol con privilegios DDL (supabase_admin).

ALTER TABLE reservacaacupe.entidades_bancarias
  ADD COLUMN IF NOT EXISTS codigo text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_entidades_bancarias_codigo
  ON reservacaacupe.entidades_bancarias (empresa_id, lower(codigo))
  WHERE codigo IS NOT NULL AND codigo <> '';

ALTER TABLE reservacaacupe.ventas_pagos_detalle
  ADD COLUMN IF NOT EXISTS titular text;
