-- =============================================================================
-- ASUNHOME — Módulo "En el técnico": distinguir origen interno vs cliente
--
-- servicio_tecnico_ordenes agrupa dos flujos:
--   'interno' → producto propio dañado de fábrica que se manda a reparar.
--               Sale del stock al entrar y vuelve al repararse.
--   'cliente' → equipo que trae un cliente a reparar (servicio cobrado).
--
-- Idempotente. Correr en el SQL Editor.
-- =============================================================================

ALTER TABLE asunhome.servicio_tecnico_ordenes
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'cliente';

DO $$
BEGIN
  BEGIN
    ALTER TABLE asunhome.servicio_tecnico_ordenes
      DROP CONSTRAINT IF EXISTS servicio_tecnico_ordenes_origen_check;
    ALTER TABLE asunhome.servicio_tecnico_ordenes
      ADD CONSTRAINT servicio_tecnico_ordenes_origen_check
      CHECK (origen IN ('interno','cliente'));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'origen_check: %', SQLERRM;
  END;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_st_ordenes_origen
  ON asunhome.servicio_tecnico_ordenes (origen);

NOTIFY pgrst, 'reload schema';
