-- =============================================================================
-- Fix: movimientos_inventario en tenants tiene FK producto_id apuntando a
-- public.productos (incorrecta) — los INSERTs fallan con FK violation 23503.
-- Corregir FKs a las tablas LOCALES del mismo schema.
--
-- Tambien: agregar columnas de auditoria
--   created_by      uuid       (id del usuario; nullable para back-compat)
--   usuario_nombre  text       (snapshot del nombre del usuario al momento)
-- Para que /inventario/movimientos sea un log real y muestre QUIEN hizo cada
-- movimiento.
--
-- Reglas: IF NOT EXISTS, aditivo, idempotente. No borra datos.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'movimientos_inventario'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    RAISE NOTICE '[movimientos_inventario fix-fks+auditoria] schema=%', r.sch;

    -- 1) Columnas de auditoria (aditivas)
    EXECUTE format(
      'ALTER TABLE %I.movimientos_inventario
         ADD COLUMN IF NOT EXISTS created_by uuid,
         ADD COLUMN IF NOT EXISTS usuario_nombre text',
      r.sch
    );

    -- 2) Reescribir FK de producto_id al schema LOCAL.
    --    El nombre de constraint heredado suele ser movimientos_inventario_producto_id_fkey.
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.movimientos_inventario
           DROP CONSTRAINT IF EXISTS movimientos_inventario_producto_id_fkey',
        r.sch
      );
      EXECUTE format(
        'ALTER TABLE %I.movimientos_inventario
           ADD CONSTRAINT movimientos_inventario_producto_id_fkey
           FOREIGN KEY (producto_id) REFERENCES %I.productos(id) ON DELETE RESTRICT',
        r.sch, r.sch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'mov_inv FK producto_id en %: %', r.sch, SQLERRM;
    END;

    -- 3) Reescribir FK de empresa_id a zentra_erp.empresas (catalogo central).
    --    En public puede mantener su FK local; lo intentamos solo para schemas tenant.
    IF r.sch NOT IN ('public') THEN
      BEGIN
        EXECUTE format(
          'ALTER TABLE %I.movimientos_inventario
             DROP CONSTRAINT IF EXISTS movimientos_inventario_empresa_id_fkey',
          r.sch
        );
        EXECUTE format(
          'ALTER TABLE %I.movimientos_inventario
             ADD CONSTRAINT movimientos_inventario_empresa_id_fkey
             FOREIGN KEY (empresa_id) REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE',
          r.sch
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'mov_inv FK empresa_id en %: %', r.sch, SQLERRM;
      END;
    END IF;

    -- 4) Indice por created_by para consultas de auditoria.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_movimientos_inventario_created_by
         ON %I.movimientos_inventario (created_by)',
      r.sch
    );
  END LOOP;
END;
$$;
