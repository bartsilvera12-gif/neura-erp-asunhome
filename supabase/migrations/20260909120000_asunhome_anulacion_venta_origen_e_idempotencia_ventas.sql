-- =============================================================================
-- ASUNHOME — Trazabilidad e idempotencia de stock (auditoría ANAFE DAKO)
--
-- (1) movimientos_inventario.origen: agregar 'anulacion_venta' al CHECK, para
--     que la ENTRADA que genera una anulación de venta tenga origen propio
--     (hoy queda mal clasificada como 'ajuste_manual').
-- (2) ventas.idempotency_key + índice único parcial: protege la creación de
--     venta contra doble request (doble-click / timeout / retry). Misma forma
--     que devoluciones_venta.idempotency_key.
--
-- ALCANCE: SOLO el schema `asunhome`. NO toca otros tenants ni datos históricos.
-- Idempotente: se puede correr varias veces sin efecto adicional.
-- NO se aplica automáticamente en producción: correr manualmente tras revisión.
--
-- CONSERVADORA + HARDENING: NO borra CHECKs por el solo hecho de que su texto
-- contenga la palabra "origen". Identifica, vía pg_constraint.conkey, el CHECK
-- que referencia EXCLUSIVAMENTE la columna `origen` y reemplaza SOLO ese. Ante
-- CHECK compuesto que mencione origen, o varios CHECK exclusivos de origen,
-- ABORTA con RAISE EXCEPTION (revisión manual). Si no puede dejar
-- 'anulacion_venta' permitido, la migración FALLA (no se captura en silencio).
-- =============================================================================

-- ── (1) origen 'anulacion_venta' ────────────────────────────────────────────
-- Superset con TODOS los orígenes que asunhome ya permite (ver 13_reservas_guarda)
-- + 'anulacion_venta'. Un CHECK más amplio nunca invalida filas existentes.
DO $mov$
DECLARE
  v_origen text :=
       '''compra'',''venta'',''ajuste_manual'',''inventario_inicial'',''produccion'','
    || '''devolucion_venta'',''transferencia'',''servicio_tecnico'',''averia'','
    || '''devolucion_proveedor'',''reserva'',''anulacion_reserva'',''anulacion_venta''';
  v_attnum smallint;
  v_pure   text[];   -- CHECK(s) que refieren EXCLUSIVAMENTE a `origen`
  v_mixed  text[];   -- CHECK(s) COMPUESTOS que además mencionan `origen`
  v_ok     boolean;
BEGIN
  -- attnum real de la columna `origen`.
  SELECT a.attnum INTO v_attnum
    FROM pg_attribute a
    JOIN pg_class t     ON t.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'asunhome' AND t.relname = 'movimientos_inventario'
     AND a.attname = 'origen' AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_attnum IS NULL THEN
    RAISE EXCEPTION 'No existe la columna asunhome.movimientos_inventario.origen; migración abortada.';
  END IF;

  -- CHECK(s) cuyo conjunto de columnas es EXACTAMENTE {origen} → candidato a reemplazar.
  SELECT array_agg(c.conname ORDER BY c.conname) INTO v_pure
    FROM pg_constraint c
    JOIN pg_class t     ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'asunhome' AND t.relname = 'movimientos_inventario'
     AND c.contype = 'c'
     AND c.conkey = ARRAY[v_attnum]::smallint[];

  -- CHECK(s) COMPUESTOS (más de una columna) que incluyen `origen`.
  SELECT array_agg(c.conname ORDER BY c.conname) INTO v_mixed
    FROM pg_constraint c
    JOIN pg_class t     ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'asunhome' AND t.relname = 'movimientos_inventario'
     AND c.contype = 'c'
     AND v_attnum = ANY(c.conkey)
     AND coalesce(array_length(c.conkey, 1), 0) > 1;

  -- Regla conservadora:
  IF v_mixed IS NOT NULL AND array_length(v_mixed, 1) > 0 THEN
    RAISE EXCEPTION 'CHECK compuesto que menciona origen (%). Revisión manual requerida; migración abortada.',
      array_to_string(v_mixed, ', ');
  ELSIF v_pure IS NULL OR array_length(v_pure, 1) = 0 THEN
    RAISE NOTICE 'No había CHECK exclusivo de origen; se crea movimientos_inventario_origen_check.';
  ELSIF array_length(v_pure, 1) = 1 THEN
    EXECUTE format('ALTER TABLE asunhome.movimientos_inventario DROP CONSTRAINT %I', v_pure[1]);
  ELSE
    RAISE EXCEPTION 'Se encontraron varios CHECK exclusivos de origen (%). Revisión manual requerida; migración abortada.',
      array_to_string(v_pure, ', ');
  END IF;

  -- Crear el CHECK canónico (13 orígenes). Si falla (p. ej. filas inválidas),
  -- el error se propaga y la migración FALLA — no se captura en silencio.
  EXECUTE 'ALTER TABLE asunhome.movimientos_inventario '
       || 'ADD CONSTRAINT movimientos_inventario_origen_check CHECK (origen IN (' || v_origen || '))';

  -- Verificación dura: el CHECK resultante DEBE permitir 'anulacion_venta'.
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t     ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'asunhome' AND t.relname = 'movimientos_inventario'
       AND c.contype = 'c' AND c.conname = 'movimientos_inventario_origen_check'
       AND pg_get_constraintdef(c.oid) ILIKE '%anulacion_venta%'
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'La migración NO pudo habilitar origen=anulacion_venta en asunhome.movimientos_inventario.';
  END IF;
END $mov$;

-- ── (2) idempotencia en ventas ──────────────────────────────────────────────
ALTER TABLE asunhome.ventas
  ADD COLUMN IF NOT EXISTS idempotency_key text;

COMMENT ON COLUMN asunhome.ventas.idempotency_key IS
  'Clave de idempotencia por request de creación de venta (doble-click/retry). '
  'La UI envía un UUID por intento de checkout; se reusa en reintentos y se '
  'renueva tras un alta exitosa. Único por empresa cuando no es NULL.';

-- Único parcial: dos requests con la misma clave no pueden crear dos ventas.
CREATE UNIQUE INDEX IF NOT EXISTS ventas_uq_idempotency_key
  ON asunhome.ventas (empresa_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ── Verificación (solo lectura, una fila) ───────────────────────────────────
-- Confirma: (a) el CHECK de origen permite EXACTAMENTE los 13 valores actuales;
-- (b) cuántos CHECK quedan en la tabla (para comprobar que no se borró ningún
-- otro); (c) columna + índice de idempotencia listos.
SELECT
  (SELECT bool_and(oc.def ILIKE '%''' || v || '''%')
     FROM (
       SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class t     ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'asunhome' AND t.relname = 'movimientos_inventario'
          AND c.contype = 'c' AND c.conname = 'movimientos_inventario_origen_check'
     ) oc
     CROSS JOIN unnest(ARRAY[
       'compra','venta','ajuste_manual','inventario_inicial','produccion','devolucion_venta',
       'transferencia','servicio_tecnico','averia','devolucion_proveedor','reserva',
       'anulacion_reserva','anulacion_venta'
     ]) AS v
  ) AS origen_permite_los_13_valores,
  (SELECT count(*) FROM pg_constraint c
     JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='asunhome' AND t.relname='movimientos_inventario' AND c.contype='c')
    AS total_checks_en_movimientos_inventario,
  EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='asunhome' AND table_name='ventas' AND column_name='idempotency_key')
    AS ventas_idempotency_col_ok,
  EXISTS (SELECT 1 FROM pg_indexes
     WHERE schemaname='asunhome' AND indexname='ventas_uq_idempotency_key')
    AS ventas_idempotency_idx_ok;
