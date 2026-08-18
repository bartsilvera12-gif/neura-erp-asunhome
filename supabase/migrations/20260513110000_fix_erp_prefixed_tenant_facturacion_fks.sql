-- =============================================================================
-- Redirige FKs cross-schema mal direccionadas en tenants erp_* / er_<hex>
-- para tablas de facturación ERP (facturas, factura_items, pagos).
--
-- Contexto:
--   Empresas provisionadas vía clone del bootstrap quedaron con FKs que apuntan a
--   `zentra_erp.<tabla>` (clientes, facturas, suscripciones) en vez de a las tablas
--   LOCALES de su propio schema. Esto rompe los INSERT en `<schema>.facturas`,
--   `<schema>.factura_items` y `<schema>.pagos` (FK violation) y por lo tanto la
--   emisión ERP de factura al contado / suscripción fallaba silenciosamente.
--
--   Esta migración aplica la misma lógica que 20260521120000_fix_erp_prefixed_tenant_chat_fks.sql
--   pero para facturación ERP. NO toca:
--     - empresa_id → zentra_erp.empresas (correcto, no cambia).
--     - SIFEN / XML / firma / certificado / notas de crédito / envío SET.
--     - Schemas legacy (public / zentra_erp).
--
-- Idempotente:
--   - Si la FK ya apunta al schema local, replace deja la def igual y el bloque se omite.
--   - Cada ALTER va en un BEGIN/EXCEPTION para que datos inconsistentes en un schema no
--     derriben la migración para otros tenants.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  newdef text;
  def0 text;
BEGIN
  FOR r IN
    SELECT
      tn.nspname::text AS schema_name,
      c.conname::text AS conname,
      c.oid AS coid,
      cf.relname::text AS from_table,
      rt.relname::text AS ref_table
    FROM pg_constraint c
    JOIN pg_class cf ON cf.oid = c.conrelid
    JOIN pg_namespace tn ON tn.oid = cf.relnamespace
    JOIN pg_class rt ON rt.oid = c.confrelid
    JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    WHERE c.contype = 'f'
      AND (
        tn.nspname ~ '^er_[0-9a-f]{32}$'
        OR tn.nspname ~ '^erp_[a-zA-Z0-9_]+$'
      )
      AND rn.nspname = 'zentra_erp'
      AND cf.relname IN ('facturas', 'factura_items', 'pagos')
      AND rt.relname IN ('clientes', 'facturas', 'suscripciones')
  LOOP
    def0 := pg_get_constraintdef(r.coid, true);
    newdef := replace(
      replace(def0, 'REFERENCES "zentra_erp".', 'REFERENCES ' || quote_ident(r.schema_name) || '.'),
      'REFERENCES zentra_erp.', 'REFERENCES ' || quote_ident(r.schema_name) || '.'
    );
    IF newdef = def0 THEN
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.from_table, r.conname);
      EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s', r.schema_name, r.from_table, r.conname, newdef);
      RAISE NOTICE 'fix FK %.% (%): % → schema local', r.schema_name, r.from_table, r.conname, r.ref_table;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'fix FK fallo %.% (%): %', r.schema_name, r.from_table, r.conname, SQLERRM;
    END;
  END LOOP;
END;
$$;
