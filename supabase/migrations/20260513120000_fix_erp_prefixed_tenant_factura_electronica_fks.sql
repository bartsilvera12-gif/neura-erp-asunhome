-- =============================================================================
-- Redirige FKs cross-schema mal direccionadas en tenants erp_* / er_<hex>
-- para tablas SIFEN (factura_electronica, factura_electronica_evento).
--
-- Contexto:
--   Las empresas provisionadas vía clone del bootstrap quedaron con FKs SIFEN que
--   apuntan a `zentra_erp.<tabla>` (facturas, factura_electronica) en vez de las
--   tablas LOCALES del propio schema. Eso bloqueaba el INSERT del borrador SIFEN
--   (factura_electronica) y de eventos (factura_electronica_evento) en tenants
--   erp_*, porque la FK violaba al buscar la factura en `zentra_erp.facturas`
--   donde no existe (la factura vive en `<schema>.facturas`).
--
--   Esta migración aplica el mismo patrón que
--   20260513110000_fix_erp_prefixed_tenant_facturacion_fks.sql,
--   pero acotada a:
--     - factura_electronica.factura_id            → <schema>.facturas
--     - factura_electronica_evento.factura_electronica_id
--                                                 → <schema>.factura_electronica
--
--   NO toca:
--     - *_empresa_id → zentra_erp.empresas (correcto, catálogo global, no cambia).
--     - Firma SIFEN / SET / certificado / cancelación / consultas / notas de crédito.
--     - Schemas legacy (public / zentra_erp): se ignoran porque la regex de tn.nspname
--       solo matchea `er_<hex>` o `erp_*`.
--
-- Idempotente:
--   - Si la FK ya apunta al schema local, replace deja la def igual y se omite.
--   - Cada ALTER va en BEGIN/EXCEPTION para que datos inconsistentes en un schema
--     no derriben la migración para otros tenants.
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
      c.conname::text  AS conname,
      c.oid            AS coid,
      cf.relname::text AS from_table,
      rt.relname::text AS ref_table
    FROM pg_constraint c
    JOIN pg_class cf      ON cf.oid = c.conrelid
    JOIN pg_namespace tn  ON tn.oid = cf.relnamespace
    JOIN pg_class rt      ON rt.oid = c.confrelid
    JOIN pg_namespace rn  ON rn.oid = rt.relnamespace
    WHERE c.contype = 'f'
      AND (
        tn.nspname ~ '^er_[0-9a-f]{32}$'
        OR tn.nspname ~ '^erp_[a-zA-Z0-9_]+$'
      )
      AND rn.nspname = 'zentra_erp'
      AND cf.relname IN ('factura_electronica', 'factura_electronica_evento')
      AND rt.relname IN ('facturas', 'factura_electronica')
  LOOP
    def0 := pg_get_constraintdef(r.coid, true);
    newdef := replace(
      replace(def0, 'REFERENCES "zentra_erp".', 'REFERENCES ' || quote_ident(r.schema_name) || '.'),
      'REFERENCES zentra_erp.',                  'REFERENCES ' || quote_ident(r.schema_name) || '.'
    );
    IF newdef = def0 THEN
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I',
                     r.schema_name, r.from_table, r.conname);
      EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s',
                     r.schema_name, r.from_table, r.conname, newdef);
      RAISE NOTICE 'fix FK SIFEN %.% (%): % → schema local',
                   r.schema_name, r.from_table, r.conname, r.ref_table;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'fix FK SIFEN fallo %.% (%): %',
                   r.schema_name, r.from_table, r.conname, SQLERRM;
    END;
  END LOOP;
END;
$$;
