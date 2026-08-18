-- =============================================================================
-- Tras clonar zentra_erp → erp_* / er_*, node_id en chat_flow_node_blocks y
-- chat_flow_options debe referenciar chat_flow_nodes del MISMO schema tenant.
-- Sin esto, INSERT de bloques falla: chat_flow_node_blocks_node_id_fkey.
-- Idempotente: solo reescribe si la FK sigue apuntando a zentra_erp.chat_flow_nodes.
-- =============================================================================

CREATE OR REPLACE FUNCTION zentra_erp.neura_fix_chat_flow_node_fks_to_local_one_schema(p_target_schema text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = zentra_erp, pg_catalog
AS $$
DECLARE
  r RECORD;
  newdef text;
  def0 text;
BEGIN
  IF p_target_schema IS NULL OR btrim(p_target_schema) = '' THEN
    RETURN;
  END IF;
  IF p_target_schema !~ '^er_[0-9a-f]{32}$' AND p_target_schema !~ '^erp_[a-zA-Z0-9_]+$' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = p_target_schema) THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT c.conname::text AS conname, c.oid AS coid, cf.relname::text AS from_table
    FROM pg_constraint c
    JOIN pg_class cf ON cf.oid = c.conrelid
    JOIN pg_namespace tn ON tn.oid = cf.relnamespace
    JOIN pg_class rt ON rt.oid = c.confrelid
    JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    WHERE c.contype = 'f'
      AND tn.nspname = p_target_schema
      AND rn.nspname = 'zentra_erp'
      AND cf.relname IN ('chat_flow_node_blocks', 'chat_flow_options')
      AND rt.relname = 'chat_flow_nodes'
  LOOP
    def0 := pg_get_constraintdef(r.coid, true);
    newdef := replace(
      replace(def0, 'REFERENCES "zentra_erp".', 'REFERENCES ' || quote_ident(p_target_schema) || '.'),
      'REFERENCES zentra_erp.',
      'REFERENCES ' || quote_ident(p_target_schema) || '.'
    );
    IF newdef = def0 THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      p_target_schema,
      r.from_table,
      r.conname
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I %s',
      p_target_schema,
      r.from_table,
      r.conname,
      newdef
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION zentra_erp.neura_fix_chat_flow_node_fks_to_local_one_schema(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.neura_fix_chat_flow_node_fks_to_local_one_schema(text) TO service_role;

COMMENT ON FUNCTION zentra_erp.neura_fix_chat_flow_node_fks_to_local_one_schema(text) IS
  'Tras clonar tenant: chat_flow_node_blocks.node_id y chat_flow_options.node_id → chat_flow_nodes locales.';

-- Provision: ejecutar tras retarget desde public (misma familia de fixes post-clone).
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
  PERFORM zentra_erp.neura_fix_chat_flow_node_fks_to_local_one_schema(v_schema);

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
