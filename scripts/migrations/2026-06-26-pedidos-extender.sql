-- ============================================================================
-- Migracion: Extender pedidos_caja para el modulo Pedidos.
-- Schema: ferreteriarepublica
-- Fecha: 2026-06-26
--
-- Idempotente, no destructiva. NO crea tablas: extiende pedidos_caja.
--
-- Cambios:
--   1) Nuevo estado 'en_caja' (cajero abrio el pedido para procesarlo).
--   2) Numero visible 'PED-XXXXXX' (auto-gen en backend; backfill aqui).
--   3) Auditoria de quien lo abrio en caja (abierto_por_id, _email, _at).
-- ============================================================================

SET search_path TO ferreteriarepublica, public;

-- ---------------------------------------------------------------------------
-- 1) Estado 'en_caja' — drop+recreate del CHECK para sumarlo
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Buscar el nombre real del CHECK (postgres lo asigna automaticamente).
  PERFORM 1 FROM pg_constraint
    WHERE conrelid = 'ferreteriarepublica.pedidos_caja'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%estado%pendiente%facturado%cancelado%';
  IF FOUND THEN
    -- Borrar el CHECK existente (cualquier nombre)
    EXECUTE (
      SELECT 'ALTER TABLE ferreteriarepublica.pedidos_caja DROP CONSTRAINT ' || conname
      FROM pg_constraint
      WHERE conrelid = 'ferreteriarepublica.pedidos_caja'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%estado%'
      LIMIT 1
    );
  END IF;
END $$;

ALTER TABLE ferreteriarepublica.pedidos_caja
  ADD CONSTRAINT pedidos_caja_estado_check
  CHECK (estado IN ('pendiente','en_caja','facturado','cancelado'));

-- ---------------------------------------------------------------------------
-- 2) Columnas nuevas (IF NOT EXISTS)
-- ---------------------------------------------------------------------------
ALTER TABLE ferreteriarepublica.pedidos_caja
  ADD COLUMN IF NOT EXISTS numero            text NULL,
  ADD COLUMN IF NOT EXISTS abierto_por_id    uuid NULL,
  ADD COLUMN IF NOT EXISTS abierto_por_email text NULL,
  ADD COLUMN IF NOT EXISTS abierto_at        timestamp with time zone NULL;

COMMENT ON COLUMN ferreteriarepublica.pedidos_caja.numero IS
  'Numero visible PED-XXXXXX. Asignado por backend al crear, unico por empresa.';
COMMENT ON COLUMN ferreteriarepublica.pedidos_caja.abierto_por_id IS
  'Cajero que abrio el pedido en /ventas/nueva (estado en_caja). NULL si nadie lo abrio aun.';

-- Indice unique parcial: dos pedidos no pueden tener el mismo numero en la
-- misma empresa. NULL no cuenta (parcial sobre IS NOT NULL).
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_caja_numero_uniq
  ON ferreteriarepublica.pedidos_caja (empresa_id, numero)
  WHERE numero IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Backfill de numero para pedidos existentes
-- ---------------------------------------------------------------------------
-- Asignar PED-000001, PED-000002, ... ordenado por created_at por empresa.
WITH numerados AS (
  SELECT id,
         'PED-' || LPAD(
           ROW_NUMBER() OVER (PARTITION BY empresa_id ORDER BY created_at)::text,
           6, '0'
         ) AS nuevo_numero
  FROM ferreteriarepublica.pedidos_caja
  WHERE numero IS NULL
)
UPDATE ferreteriarepublica.pedidos_caja p
SET numero = n.nuevo_numero
FROM numerados n
WHERE p.id = n.id;

-- ---------------------------------------------------------------------------
-- 4) Verificacion
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  total bigint;
  sin_numero bigint;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE numero IS NULL)
    INTO total, sin_numero
    FROM ferreteriarepublica.pedidos_caja;
  RAISE NOTICE 'Migration check -> total: %, sin numero: %', total, sin_numero;
END $$;
