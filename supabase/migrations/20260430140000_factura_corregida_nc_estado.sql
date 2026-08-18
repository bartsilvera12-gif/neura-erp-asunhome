-- =============================================================================
-- Factura: estado "Corregida NC" tras nota de crédito SET que deja saldo en 0.
-- Extiende CHECK estado en facturas (schemas tenant) y actualiza RPC de NC.
-- =============================================================================

CREATE OR REPLACE FUNCTION zentra_erp.neura_upgrade_factura_estado_corregida_nc(p_schema text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  s text := btrim(p_schema);
BEGIN
  IF s IS NULL OR s = '' THEN
    RAISE EXCEPTION 'neura_upgrade_factura_estado_corregida_nc: schema vacío';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
    RAISE NOTICE 'neura_upgrade_factura_estado_corregida_nc: schema % no existe (omitido)', s;
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = s AND table_name = 'facturas'
  ) THEN
    RAISE NOTICE 'neura_upgrade_factura_estado_corregida_nc: sin tabla facturas en % (omitido)', s;
    RETURN;
  END IF;

  EXECUTE format(
    'ALTER TABLE %I.facturas DROP CONSTRAINT IF EXISTS facturas_estado_check',
    s
  );
  EXECUTE format(
    'ALTER TABLE %I.facturas ADD CONSTRAINT facturas_estado_check CHECK (estado IN (
      ''Pagado'',
      ''Pendiente'',
      ''Vencido'',
      ''Anulado'',
      ''Corregida NC''
    ))',
    s
  );

  -- Datos ya consistentes en saldo pero estado ERP desactualizado (pre-migración).
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = s AND table_name = 'nota_credito'
  ) THEN
    EXECUTE format(
      'UPDATE %I.facturas f SET estado = ''Corregida NC'', updated_at = now()
       WHERE f.saldo <= 0.0001
         AND f.estado IN (''Pendiente'', ''Vencido'')
         AND EXISTS (
           SELECT 1 FROM %I.nota_credito nc
           WHERE nc.factura_id = f.id AND nc.empresa_id = f.empresa_id
             AND nc.estado_erp = ''aprobada''
         )',
      s,
      s
    );
  ELSE
    RAISE NOTICE 'neura_upgrade_factura_estado_corregida_nc: sin tabla nota_credito en % (solo CHECK)', s;
  END IF;
END;
$$;

COMMENT ON FUNCTION zentra_erp.neura_upgrade_factura_estado_corregida_nc(text) IS
  'Añade estado facturas Corregida NC y renueva CHECK en un schema ERP.';

REVOKE ALL ON FUNCTION zentra_erp.neura_upgrade_factura_estado_corregida_nc(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.neura_upgrade_factura_estado_corregida_nc(text) TO service_role;

SELECT zentra_erp.neura_upgrade_factura_estado_corregida_nc('zentra_erp');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'facturas'
  ) THEN
    PERFORM zentra_erp.neura_upgrade_factura_estado_corregida_nc('public');
  END IF;
END;
$$;

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
    PERFORM zentra_erp.neura_upgrade_factura_estado_corregida_nc(r.ds);
    RAISE NOTICE 'factura Corregida NC: actualizado schema %', r.ds;
  END LOOP;
END;
$$;

-- Saldo + estado factura cuando NC SET deja saldo ~ 0 (sin pisar Anulado / Pagado explícito).
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
    'UPDATE %s.facturas SET
       saldo = GREATEST(0::numeric, saldo - $1),
       estado = CASE
         WHEN estado = ''Anulado'' THEN ''Anulado''
         WHEN GREATEST(0::numeric, saldo - $1) <= 0.0001 AND estado <> ''Pagado'' THEN ''Corregida NC''
         WHEN GREATEST(0::numeric, saldo - $1) <= 0.0001 THEN ''Pagado''
         ELSE estado
       END,
       updated_at = now()
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
  'Resta NC del saldo; si queda en 0 y la factura no estaba Pagada/Anulada, estado Corregida NC; si ya era Pagado, permanece Pagado.';

NOTIFY pgrst, 'reload schema';
