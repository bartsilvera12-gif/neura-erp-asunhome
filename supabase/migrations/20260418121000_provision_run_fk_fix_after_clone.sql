-- Tras clonar, asegura FKs sin resolución hacia public (por si el origen aún arrastraba defs legacy).
CREATE OR REPLACE FUNCTION zentra_erp.neura_provision_empresa_data_schema(
  p_empresa_id uuid,
  p_schema_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = zentra_erp, pg_catalog
AS $$
DECLARE
  v_existing text;
  v_slug text;
  v_schema text;
  v_nombre text;
BEGIN
  SELECT data_schema, nombre_empresa
  INTO v_existing, v_nombre
  FROM zentra_erp.empresas
  WHERE id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'empresa no encontrada: %', p_empresa_id;
  END IF;

  IF v_existing IS NOT NULL AND btrim(v_existing) <> '' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'schema', v_existing,
      'status', 'already_provisioned'
    );
  END IF;

  v_slug := coalesce(nullif(trim(p_schema_slug), ''), v_nombre);
  v_schema := zentra_erp.neura_build_tenant_schema_name(v_slug, p_empresa_id);

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_schema) THEN
    RAISE EXCEPTION 'colisión de nombre de schema: %', v_schema;
  END IF;

  PERFORM zentra_erp.neura_clone_zentra_erp_to_tenant(v_schema);
  PERFORM zentra_erp.neura_fix_foreign_keys_retarget_from_public(v_schema);

  UPDATE zentra_erp.empresas
  SET data_schema = v_schema
  WHERE id = p_empresa_id;

  PERFORM pg_notify('pgrst', 'reload schema');

  RETURN jsonb_build_object(
    'ok', true,
    'schema', v_schema,
    'status', 'created'
  );
END;
$$;

REVOKE ALL ON FUNCTION zentra_erp.neura_provision_empresa_data_schema(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.neura_provision_empresa_data_schema(uuid, text) TO service_role;
