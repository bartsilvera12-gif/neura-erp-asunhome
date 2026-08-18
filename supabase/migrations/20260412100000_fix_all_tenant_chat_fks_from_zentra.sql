-- =============================================================================
-- Corrige FKs en esquemas tenant (er_*, erp_*, u otro valor en empresas.data_schema)
-- que sigan referenciando zentra_erp.<tabla> cuando la misma tabla existe en el tenant.
-- Excluye referencias a empresas/usuarios (permanecen en catálogo zentra_erp).
-- Idempotente: si la FK ya apunta al tenant, replace no cambia la definición y se omite.
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
      AND rn.nspname = 'zentra_erp'
      AND rt.relname NOT IN ('empresas', 'usuarios')
      AND EXISTS (
        SELECT 1
        FROM pg_class c2
        JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
        WHERE n2.nspname = tn.nspname
          AND c2.relname = rt.relname
          AND c2.relkind = 'r'
      )
      AND (
        tn.nspname ~ '^er_[0-9a-f]{32}$'
        OR tn.nspname IN (
          SELECT DISTINCT btrim(e.data_schema)::text
          FROM zentra_erp.empresas e
          WHERE e.data_schema IS NOT NULL
            AND btrim(e.data_schema) <> ''
            AND lower(btrim(e.data_schema)) NOT IN (
              'zentra_erp',
              'public',
              'pg_catalog',
              'information_schema'
            )
        )
      )
  LOOP
    def0 := pg_get_constraintdef(r.coid, true);
    newdef := replace(
      replace(def0, 'REFERENCES "zentra_erp".', 'REFERENCES ' || quote_ident(r.schema_name) || '.'),
      'REFERENCES zentra_erp.',
      'REFERENCES ' || quote_ident(r.schema_name) || '.'
    );
    IF newdef = def0 THEN
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT %I',
        r.schema_name,
        r.from_table,
        r.conname
      );
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I %s',
        r.schema_name,
        r.from_table,
        r.conname,
        newdef
      );
      RAISE NOTICE 'FK reescrita: %.% → ref local (antes zentra_erp.%)', r.schema_name, r.conname, r.ref_table;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'FK omitida %.% %: %', r.schema_name, r.from_table, r.conname, SQLERRM;
    END;
  END LOOP;
END;
$$;
