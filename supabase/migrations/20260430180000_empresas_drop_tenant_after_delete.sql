-- Evita "cache lookup failed for constraint" al borrar empresa:
-- DROP SCHEMA en BEFORE DELETE corría en la misma transacción que el CASCADE hacia
-- filas/FKs en zentra_erp y dejaba el catálogo de constraints inconsistente.
-- Tras DELETE (y CASCADE), el trigger AFTER solo elimina el namespace erp_*.

CREATE OR REPLACE FUNCTION zentra_erp.neura_trg_empresas_drop_tenant_schema()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = zentra_erp, pg_catalog
AS $$
DECLARE
  v_s text;
BEGIN
  v_s := OLD.data_schema;
  IF v_s IS NOT NULL AND btrim(v_s) <> '' AND v_s ~ '^erp_[a-z0-9_]+$' THEN
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', v_s);
    PERFORM pg_notify('pgrst', 'reload schema');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_empresas_drop_tenant_schema ON zentra_erp.empresas;
CREATE TRIGGER tr_empresas_drop_tenant_schema
  AFTER DELETE ON zentra_erp.empresas
  FOR EACH ROW
  EXECUTE FUNCTION zentra_erp.neura_trg_empresas_drop_tenant_schema();
