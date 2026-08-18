-- =============================================================================
-- Notas de crédito — Fase 2: columnas SIFEN (lote, respuestas, aprobación),
-- estados extendidos, auditoría de eventos y RPC atómico de impacto en saldo.
-- Idempotente por schema (zentra_erp + tenants erp_*).
-- =============================================================================

CREATE OR REPLACE FUNCTION zentra_erp.neura_upgrade_nota_credito_fase2(p_schema text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  s text := btrim(p_schema);
BEGIN
  IF s IS NULL OR s = '' THEN
    RAISE EXCEPTION 'neura_upgrade_nota_credito_fase2: schema vacío';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
    RAISE NOTICE 'neura_upgrade_nota_credito_fase2: schema % no existe (omitido)', s;
    RETURN;
  END IF;

  EXECUTE format(
    'ALTER TABLE %I.nota_credito_electronica ADD COLUMN IF NOT EXISTS sifen_d_prot_cons_lote text',
    s
  );
  EXECUTE format(
    'ALTER TABLE %I.nota_credito_electronica ADD COLUMN IF NOT EXISTS sifen_ultima_respuesta_recibe_lote jsonb',
    s
  );
  EXECUTE format(
    'ALTER TABLE %I.nota_credito_electronica ADD COLUMN IF NOT EXISTS sifen_ultima_respuesta_consulta_lote jsonb',
    s
  );
  EXECUTE format(
    'ALTER TABLE %I.nota_credito_electronica ADD COLUMN IF NOT EXISTS sifen_aprobado_at timestamptz',
    s
  );
  EXECUTE format(
    'ALTER TABLE %I.nota_credito_electronica ADD COLUMN IF NOT EXISTS last_response_json jsonb',
    s
  );
  EXECUTE format(
    'ALTER TABLE %I.nota_credito_electronica ADD COLUMN IF NOT EXISTS last_error text',
    s
  );

  EXECUTE format(
    'UPDATE %I.nota_credito_electronica SET estado_sifen = ''sin_envio'' WHERE estado_sifen = ''borrador''',
    s
  );

  EXECUTE format(
    'ALTER TABLE %I.nota_credito_electronica DROP CONSTRAINT IF EXISTS nota_credito_electronica_estado_sifen_check',
    s
  );
  EXECUTE format(
    'ALTER TABLE %I.nota_credito_electronica ADD CONSTRAINT nota_credito_electronica_estado_sifen_check CHECK (estado_sifen IN (
      ''sin_envio'',
      ''generado'',
      ''firmado'',
      ''enviado'',
      ''en_proceso'',
      ''aprobado'',
      ''rechazado'',
      ''error_envio'',
      ''cancelado''
    ))',
    s
  );

  EXECUTE format(
    'ALTER TABLE %I.nota_credito_evento DROP CONSTRAINT IF EXISTS nota_credito_evento_tipo_check',
    s
  );
  EXECUTE format(
    'ALTER TABLE %I.nota_credito_evento ADD CONSTRAINT nota_credito_evento_tipo_check CHECK (tipo_evento IN (
      ''creacion'',
      ''validacion'',
      ''rechazo_negocio'',
      ''cambio_estado_erp'',
      ''preparacion_sifen'',
      ''error'',
      ''observacion_operativa'',
      ''anulacion_borrador'',
      ''xml_generado'',
      ''xml_firmado'',
      ''enviado_set'',
      ''respuesta_set'',
      ''aprobado'',
      ''rechazado'',
      ''impacto_saldo_aplicado'',
      ''error_envio''
    ))',
    s
  );
END;
$$;

COMMENT ON FUNCTION zentra_erp.neura_upgrade_nota_credito_fase2(text) IS
  'Añade columnas y restricciones Fase 2 SIFEN a nota_credito_electronica / eventos en un schema ERP.';

REVOKE ALL ON FUNCTION zentra_erp.neura_upgrade_nota_credito_fase2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.neura_upgrade_nota_credito_fase2(text) TO service_role;

SELECT zentra_erp.neura_upgrade_nota_credito_fase2('zentra_erp');

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT btrim(e.data_schema) AS ds
    FROM zentra_erp.empresas e
    WHERE e.data_schema IS NOT NULL
      AND btrim(e.data_schema) <> ''
      AND btrim(e.data_schema) <> 'zentra_erp'
      AND btrim(e.data_schema) ~ '^erp_[a-z0-9_]+$'
  LOOP
    PERFORM zentra_erp.neura_upgrade_nota_credito_fase2(r.ds);
    RAISE NOTICE 'nota_credito fase2: actualizado %', r.ds;
  END LOOP;
END;
$$;

-- Impacto en saldo + cierre ERP (solo tras SET); SECURITY DEFINER para transacción atómica vía RPC.
CREATE OR REPLACE FUNCTION zentra_erp.nota_credito_aplicar_aprobacion_set(
  p_data_schema text,
  p_nota_credito_id uuid,
  p_factura_id uuid,
  p_empresa_id uuid,
  p_monto numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  s text := btrim(p_data_schema);
  fq text := quote_ident(btrim(p_data_schema));
  saldo_act numeric;
  otra uuid;
BEGIN
  IF s IS NULL OR s = '' THEN
    RAISE EXCEPTION 'nota_credito_aplicar_aprobacion_set: schema vacío';
  END IF;

  EXECUTE format(
    'SELECT id FROM %s.nota_credito
     WHERE factura_id = $1 AND empresa_id = $2 AND estado_erp = ''aprobada'' AND id <> $3
     LIMIT 1',
    fq
  ) INTO otra USING p_factura_id, p_empresa_id, p_nota_credito_id;
  IF otra IS NOT NULL THEN
    RAISE EXCEPTION 'Ya existe otra nota de crédito aprobada para esta factura';
  END IF;

  EXECUTE format(
    'SELECT saldo FROM %s.facturas WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
    fq
  ) INTO saldo_act USING p_factura_id, p_empresa_id;

  IF saldo_act IS NULL THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;
  IF p_monto > saldo_act + 0.02 THEN
    RAISE EXCEPTION 'El monto de la NC (%) supera el saldo pendiente (%)', p_monto, saldo_act;
  END IF;

  EXECUTE format(
    'UPDATE %s.facturas SET saldo = GREATEST(0::numeric, saldo - $1), updated_at = now()
     WHERE id = $2 AND empresa_id = $3',
    fq
  ) USING p_monto, p_factura_id, p_empresa_id;

  EXECUTE format(
    'UPDATE %s.nota_credito SET estado_erp = ''aprobada'', updated_at = now()
     WHERE id = $1 AND empresa_id = $2 AND estado_erp <> ''anulada_borrador''',
    fq
  ) USING p_nota_credito_id, p_empresa_id;
END;
$$;

COMMENT ON FUNCTION zentra_erp.nota_credito_aplicar_aprobacion_set(text, uuid, uuid, uuid, numeric) IS
  'Resta el monto de la NC del saldo de la factura (sin saldo negativo) y marca la NC como aprobada en ERP.';

REVOKE ALL ON FUNCTION zentra_erp.nota_credito_aplicar_aprobacion_set(text, uuid, uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.nota_credito_aplicar_aprobacion_set(text, uuid, uuid, uuid, numeric) TO service_role;

-- Transición atómica: marca DE NC aprobado + impacto saldo + NC ERP (evita estado aprobado sin saldo).
CREATE OR REPLACE FUNCTION zentra_erp.nota_credito_tras_aprobacion_set_transaccional(
  p_data_schema text,
  p_ne_id uuid,
  p_nc_id uuid,
  p_factura_id uuid,
  p_empresa_id uuid,
  p_monto numeric,
  p_ultima_consulta jsonb,
  p_sifen_aprobado_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  sch text := btrim(p_data_schema);
  prev_ne text;
BEGIN
  IF sch IS NULL OR sch = '' THEN
    RAISE EXCEPTION 'nota_credito_tras_aprobacion_set_transaccional: schema vacío';
  END IF;

  EXECUTE format(
    'SELECT estado_sifen::text FROM %I.nota_credito_electronica WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
    sch
  ) INTO prev_ne USING p_ne_id, p_empresa_id;

  IF prev_ne IS NULL THEN
    RAISE EXCEPTION 'nota_credito_electronica no encontrada';
  END IF;
  IF prev_ne = 'aprobado' THEN
    RETURN;
  END IF;

  EXECUTE format(
    'UPDATE %I.nota_credito_electronica SET
       estado_sifen = ''aprobado'',
       sifen_aprobado_at = $1,
       sifen_ultima_respuesta_consulta_lote = $2,
       last_response_json = $2,
       last_error = NULL,
       error = NULL,
       updated_at = now()
     WHERE id = $3 AND empresa_id = $4 AND estado_sifen <> ''aprobado''',
    sch
  ) USING p_sifen_aprobado_at, p_ultima_consulta, p_ne_id, p_empresa_id;

  PERFORM zentra_erp.nota_credito_aplicar_aprobacion_set(
    sch,
    p_nc_id,
    p_factura_id,
    p_empresa_id,
    p_monto
  );
END;
$$;

COMMENT ON FUNCTION zentra_erp.nota_credito_tras_aprobacion_set_transaccional(text, uuid, uuid, uuid, uuid, numeric, jsonb, timestamptz) IS
  'Marca nota_credito_electronica aprobada por SET y aplica saldo + estado ERP en una transacción.';

REVOKE ALL ON FUNCTION zentra_erp.nota_credito_tras_aprobacion_set_transaccional(text, uuid, uuid, uuid, uuid, numeric, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.nota_credito_tras_aprobacion_set_transaccional(text, uuid, uuid, uuid, uuid, numeric, jsonb, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
