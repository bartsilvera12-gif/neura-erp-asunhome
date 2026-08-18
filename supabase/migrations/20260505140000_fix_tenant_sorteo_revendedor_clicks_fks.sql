-- =============================================================================
-- FKs de sorteo_revendedor_clicks en schemas tenant (erp_* / er_*):
-- sorteo_id y revendedor_id deben referenciar tablas EN EL MISMO SCHEMA.
-- Si quedaron apuntando a zentra_erp.sorteos / zentra_erp.sorteo_revendedores,
-- el INSERT falla (23503) porque los UUID viven solo en el tenant.
-- empresa_id sigue referenciando zentra_erp.empresas (catálogo global).
-- =============================================================================

DO $$
DECLARE
  sch text;
  fq text;
BEGIN
  FOR sch IN
    SELECT n.nspname
    FROM pg_namespace n
    INNER JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind = 'r'
    WHERE c.relname = 'sorteo_revendedor_clicks'
      AND n.nspname <> 'zentra_erp'
      AND n.nspname <> 'public'
      AND (
        n.nspname ~ '^erp_[a-zA-Z0-9_]+$'
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
      )
  LOOP
    fq := format('%I.sorteo_revendedor_clicks', sch);

    EXECUTE format(
      'ALTER TABLE %s DROP CONSTRAINT IF EXISTS sorteo_revendedor_clicks_revendedor_id_fkey',
      fq
    );
    EXECUTE format(
      'ALTER TABLE %s DROP CONSTRAINT IF EXISTS sorteo_revendedor_clicks_sorteo_id_fkey',
      fq
    );

    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT sorteo_revendedor_clicks_revendedor_id_fkey
       FOREIGN KEY (revendedor_id) REFERENCES %I.sorteo_revendedores(id) ON DELETE CASCADE',
      fq,
      sch
    );
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT sorteo_revendedor_clicks_sorteo_id_fkey
       FOREIGN KEY (sorteo_id) REFERENCES %I.sorteos(id) ON DELETE CASCADE',
      fq,
      sch
    );

    RAISE NOTICE 'sorteo_revendedor_clicks FKs reparados en schema %', sch;
  END LOOP;
END $$;
