-- =============================================================================
-- Notas de crédito — Fase 1 (modelo + RLS + réplica a schemas tenant erp_*)
-- Sin hardcode de negocio en public. empresa_id siempre referencia zentra_erp.empresas.
-- =============================================================================

-- Bases que migraron de public pueden tener set_updated_at solo en public; los triggers NC lo requieren en zentra_erp.
CREATE OR REPLACE FUNCTION zentra_erp.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION zentra_erp.neura_install_nota_credito_tables(p_schema text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  s text := btrim(p_schema);
  fq text;
  cq text;
BEGIN
  IF s IS NULL OR s = '' THEN
    RAISE EXCEPTION 'neura_install_nota_credito_tables: schema vacío';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
    RAISE NOTICE 'neura_install_nota_credito_tables: schema % no existe (omitido)', s;
    RETURN;
  END IF;

  IF s = 'zentra_erp' THEN
    fq := 'zentra_erp';
  ELSE
    fq := quote_ident(s);
  END IF;

  -- nota_credito
  EXECUTE format($ddl$
    CREATE TABLE IF NOT EXISTS %1$s.nota_credito (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
      cliente_id uuid NOT NULL REFERENCES %2$s.clientes(id) ON DELETE RESTRICT,
      factura_id uuid NOT NULL REFERENCES %2$s.facturas(id) ON DELETE RESTRICT,
      monto numeric NOT NULL CHECK (monto > 0),
      motivo text NOT NULL,
      observacion_interna text,
      estado_erp text NOT NULL DEFAULT 'borrador',
      created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      created_by_email_snapshot text,
      created_by_nombre_snapshot text,
      saldo_previo_snapshot numeric NOT NULL,
      monto_factura_snapshot numeric NOT NULL,
      suma_pagos_snapshot numeric NOT NULL,
      moneda_snapshot text NOT NULL,
      factura_electronica_origen_id uuid REFERENCES %2$s.factura_electronica(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT nota_credito_estado_erp_check CHECK (estado_erp IN (
        'borrador',
        'pendiente_envio_sifen',
        'aprobada',
        'rechazada',
        'error',
        'anulada_borrador'
      )),
      CONSTRAINT nota_credito_moneda_snapshot_check CHECK (moneda_snapshot IN ('GS', 'USD')),
      CONSTRAINT nota_credito_motivo_len_check CHECK (length(trim(motivo)) >= 5 AND length(motivo) <= 2000)
    )
  $ddl$, quote_ident(s), fq);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_nota_credito_empresa ON %I.nota_credito (empresa_id)',
    s
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_nota_credito_factura ON %I.nota_credito (factura_id)',
    s
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_nota_credito_empresa_created ON %I.nota_credito (empresa_id, created_at DESC)',
    s
  );

  -- Una sola NC "activa" por factura (borrador, pendiente envío o aprobada)
  EXECUTE format('DROP INDEX IF EXISTS %I.%I', s, 'uq_nota_credito_factura_estado_activo');
  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I.nota_credito (factura_id) WHERE (estado_erp IN (''borrador'', ''pendiente_envio_sifen'', ''aprobada''))',
    'uq_nota_credito_factura_estado_activo',
    s
  );

  -- nota_credito_electronica (ciclo SIFEN; fase 1 deja fila en sin_envio)
  EXECUTE format($ddl$
    CREATE TABLE IF NOT EXISTS %1$s.nota_credito_electronica (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
      nota_credito_id uuid NOT NULL UNIQUE REFERENCES %1$s.nota_credito(id) ON DELETE CASCADE,
      estado_sifen text NOT NULL DEFAULT 'sin_envio',
      cdc text,
      cdc_factura_origen text,
      xml_path text,
      xml_firmado_path text,
      kude_url text,
      response_json jsonb,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT nota_credito_electronica_estado_sifen_check CHECK (estado_sifen IN (
        'sin_envio',
        'borrador',
        'generado',
        'firmado',
        'enviado',
        'aprobado',
        'rechazado',
        'error_envio',
        'cancelado'
      ))
    )
  $ddl$, quote_ident(s));

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_nota_credito_electronica_empresa ON %I.nota_credito_electronica (empresa_id)',
    s
  );

  -- Auditoría / eventos de negocio (no confundir con eventos SOAP de SIFEN)
  EXECUTE format($ddl$
    CREATE TABLE IF NOT EXISTS %1$s.nota_credito_evento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
      nota_credito_id uuid NOT NULL REFERENCES %1$s.nota_credito(id) ON DELETE CASCADE,
      actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      tipo_evento text NOT NULL,
      detalle_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT nota_credito_evento_tipo_check CHECK (tipo_evento IN (
        'creacion',
        'validacion',
        'rechazo_negocio',
        'cambio_estado_erp',
        'preparacion_sifen',
        'error',
        'observacion_operativa',
        'anulacion_borrador'
      ))
    )
  $ddl$, quote_ident(s));

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_nota_credito_evento_nc ON %I.nota_credito_evento (nota_credito_id, created_at DESC)',
    s
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_nota_credito_evento_empresa ON %I.nota_credito_evento (empresa_id)',
    s
  );

  EXECUTE format(
    'DROP TRIGGER IF EXISTS nota_credito_updated_at ON %I.nota_credito',
    s
  );
  EXECUTE format(
    'CREATE TRIGGER nota_credito_updated_at BEFORE UPDATE ON %I.nota_credito FOR EACH ROW EXECUTE FUNCTION zentra_erp.set_updated_at()',
    s
  );
  EXECUTE format(
    'DROP TRIGGER IF EXISTS nota_credito_electronica_updated_at ON %I.nota_credito_electronica',
    s
  );
  EXECUTE format(
    'CREATE TRIGGER nota_credito_electronica_updated_at BEFORE UPDATE ON %I.nota_credito_electronica FOR EACH ROW EXECUTE FUNCTION zentra_erp.set_updated_at()',
    s
  );

  -- RLS
  EXECUTE format('ALTER TABLE %I.nota_credito ENABLE ROW LEVEL SECURITY', s);
  EXECUTE format('ALTER TABLE %I.nota_credito_electronica ENABLE ROW LEVEL SECURITY', s);
  EXECUTE format('ALTER TABLE %I.nota_credito_evento ENABLE ROW LEVEL SECURITY', s);

  EXECUTE format('DROP POLICY IF EXISTS nota_credito_select ON %I.nota_credito', s);
  EXECUTE format('DROP POLICY IF EXISTS nota_credito_insert ON %I.nota_credito', s);
  EXECUTE format('DROP POLICY IF EXISTS nota_credito_update ON %I.nota_credito', s);
  EXECUTE format('DROP POLICY IF EXISTS nota_credito_delete ON %I.nota_credito', s);
  EXECUTE format(
    'CREATE POLICY nota_credito_select ON %I.nota_credito FOR SELECT USING (zentra_erp.puede_acceder_empresa(empresa_id))',
    s
  );
  EXECUTE format(
    'CREATE POLICY nota_credito_insert ON %I.nota_credito FOR INSERT WITH CHECK (zentra_erp.puede_acceder_empresa(empresa_id))',
    s
  );
  EXECUTE format(
    'CREATE POLICY nota_credito_update ON %I.nota_credito FOR UPDATE USING (zentra_erp.puede_acceder_empresa(empresa_id)) WITH CHECK (zentra_erp.puede_acceder_empresa(empresa_id))',
    s
  );
  EXECUTE format(
    'CREATE POLICY nota_credito_delete ON %I.nota_credito FOR DELETE USING (zentra_erp.puede_acceder_empresa(empresa_id))',
    s
  );

  EXECUTE format('DROP POLICY IF EXISTS nota_credito_electronica_select ON %I.nota_credito_electronica', s);
  EXECUTE format('DROP POLICY IF EXISTS nota_credito_electronica_insert ON %I.nota_credito_electronica', s);
  EXECUTE format('DROP POLICY IF EXISTS nota_credito_electronica_update ON %I.nota_credito_electronica', s);
  EXECUTE format('DROP POLICY IF EXISTS nota_credito_electronica_delete ON %I.nota_credito_electronica', s);
  EXECUTE format(
    'CREATE POLICY nota_credito_electronica_select ON %I.nota_credito_electronica FOR SELECT USING (zentra_erp.puede_acceder_empresa(empresa_id))',
    s
  );
  EXECUTE format(
    'CREATE POLICY nota_credito_electronica_insert ON %I.nota_credito_electronica FOR INSERT WITH CHECK (zentra_erp.puede_acceder_empresa(empresa_id))',
    s
  );
  EXECUTE format(
    'CREATE POLICY nota_credito_electronica_update ON %I.nota_credito_electronica FOR UPDATE USING (zentra_erp.puede_acceder_empresa(empresa_id)) WITH CHECK (zentra_erp.puede_acceder_empresa(empresa_id))',
    s
  );
  EXECUTE format(
    'CREATE POLICY nota_credito_electronica_delete ON %I.nota_credito_electronica FOR DELETE USING (zentra_erp.puede_acceder_empresa(empresa_id))',
    s
  );

  EXECUTE format('DROP POLICY IF EXISTS nota_credito_evento_select ON %I.nota_credito_evento', s);
  EXECUTE format('DROP POLICY IF EXISTS nota_credito_evento_insert ON %I.nota_credito_evento', s);
  EXECUTE format('DROP POLICY IF EXISTS nota_credito_evento_update ON %I.nota_credito_evento', s);
  EXECUTE format('DROP POLICY IF EXISTS nota_credito_evento_delete ON %I.nota_credito_evento', s);
  EXECUTE format(
    'CREATE POLICY nota_credito_evento_select ON %I.nota_credito_evento FOR SELECT USING (zentra_erp.puede_acceder_empresa(empresa_id))',
    s
  );
  EXECUTE format(
    'CREATE POLICY nota_credito_evento_insert ON %I.nota_credito_evento FOR INSERT WITH CHECK (zentra_erp.puede_acceder_empresa(empresa_id))',
    s
  );
  EXECUTE format(
    'CREATE POLICY nota_credito_evento_update ON %I.nota_credito_evento FOR UPDATE USING (zentra_erp.puede_acceder_empresa(empresa_id)) WITH CHECK (zentra_erp.puede_acceder_empresa(empresa_id))',
    s
  );
  EXECUTE format(
    'CREATE POLICY nota_credito_evento_delete ON %I.nota_credito_evento FOR DELETE USING (zentra_erp.puede_acceder_empresa(empresa_id))',
    s
  );
END;
$$;

COMMENT ON FUNCTION zentra_erp.neura_install_nota_credito_tables(text) IS
  'Crea idempotentemente nota_credito, nota_credito_electronica y nota_credito_evento + RLS en zentra_erp o schema tenant.';

REVOKE ALL ON FUNCTION zentra_erp.neura_install_nota_credito_tables(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.neura_install_nota_credito_tables(text) TO service_role;

SELECT zentra_erp.neura_install_nota_credito_tables('zentra_erp');

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
    PERFORM zentra_erp.neura_install_nota_credito_tables(r.ds);
    RAISE NOTICE 'nota_credito fase1: instalado en %', r.ds;
  END LOOP;
END;
$$;

COMMENT ON TABLE zentra_erp.nota_credito IS
  'Nota de crédito comercial vinculada a una factura; fase 1 monto = saldo pendiente al crear.';

COMMENT ON TABLE zentra_erp.nota_credito_electronica IS
  'Documento electrónico SIFEN de la NC (separado de factura_electronica de la FE).';

COMMENT ON TABLE zentra_erp.nota_credito_evento IS
  'Auditoría y eventos de ciclo de vida de la nota de crédito (ERP).';

NOTIFY pgrst, 'reload schema';
