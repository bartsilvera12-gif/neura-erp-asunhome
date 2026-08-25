-- 07_retencion_iva.sql — Retención de IVA en ventas y presupuestos.
--
-- Contexto (Paraguay): un cliente "agente de retención" retiene un % del IVA.
-- Decisión de negocio de ASUNHOME (confirmada por el cliente): la retención
-- DESCUENTA DEL TOTAL. Por eso:
--   · subtotal  = base imponible (Σ líneas, sin cambios)
--   · monto_iva = IVA bruto desglosado (Σ líneas, sin cambios)
--   · total     = NETO A COBRAR = (subtotal + monto_iva) − retencion_iva_monto
--   · retencion_iva_pct   = % aplicado sobre el IVA (ej. 100.00 = 100% del IVA)
--   · retencion_iva_monto = guaraníes retenidos = round(monto_iva * pct / 100)
--
-- Guardar `total` ya neto hace que Caja, reportes y cuentas por cobrar reflejen
-- lo realmente cobrado sin tocar sus motores (todos leen ventas.total).
--
-- Idempotente: se puede correr varias veces.

ALTER TABLE asunhome.ventas
  ADD COLUMN IF NOT EXISTS retencion_iva_pct   numeric(6,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retencion_iva_monto numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE asunhome.presupuestos
  ADD COLUMN IF NOT EXISTS retencion_iva_pct   numeric(6,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retencion_iva_monto numeric(14,2) NOT NULL DEFAULT 0;

-- Refrescar el cache de PostgREST para exponer las columnas nuevas.
NOTIFY pgrst, 'reload schema';

-- Verificación:
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='asunhome' AND table_name='ventas'
       AND column_name IN ('retencion_iva_pct','retencion_iva_monto')) AS ventas_cols_ok,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='asunhome' AND table_name='presupuestos'
       AND column_name IN ('retencion_iva_pct','retencion_iva_monto')) AS presupuestos_cols_ok;
