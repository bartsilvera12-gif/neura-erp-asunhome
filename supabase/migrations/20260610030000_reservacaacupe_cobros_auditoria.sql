-- Auditoría de cobros: quién registró el pago. Idempotente. Solo schema reservacaacupe.
ALTER TABLE reservacaacupe.cobros_clientes
  ADD COLUMN IF NOT EXISTS usuario_id uuid;
ALTER TABLE reservacaacupe.cobros_clientes
  ADD COLUMN IF NOT EXISTS usuario_nombre text;
