-- =============================================================================
-- ASUNHOME — Condición "averiado" en devoluciones
--
-- El producto devuelto averiado VUELVE al stock (suma) pero queda marcado como
-- averiado y aparece en el módulo Averiados. Para eso, la columna condicion de
-- devoluciones_venta_items debe aceptar 'averiado' además de los valores viejos.
--
-- Reemplaza cualquier CHECK sobre condicion que no incluya 'averiado'.
-- Idempotente.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Dropear todo CHECK de la tabla que restrinja la columna condicion.
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class c      ON c.oid = con.conrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'asunhome'
      AND c.relname = 'devoluciones_venta_items'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%condicion%'
  LOOP
    EXECUTE format('ALTER TABLE asunhome.devoluciones_venta_items DROP CONSTRAINT %I', r.conname);
  END LOOP;

  BEGIN
    ALTER TABLE asunhome.devoluciones_venta_items
      ADD CONSTRAINT devoluciones_venta_items_condicion_check
      CHECK (condicion IN ('buen_estado','danado','averiado'));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'condicion_check: %', SQLERRM;
  END;
END;
$$;

NOTIFY pgrst, 'reload schema';
