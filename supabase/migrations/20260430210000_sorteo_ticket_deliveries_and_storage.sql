-- =============================================================================
-- Sorteos: ticket/comprobante PNG (modo de entrega + fila de entregas + storage)
-- Esquema canónico: zentra_erp. Réplica a schemas tenant erp_* / er_*.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Columnas en sorteos
-- -----------------------------------------------------------------------------
ALTER TABLE zentra_erp.sorteos
  ADD COLUMN IF NOT EXISTS ticket_delivery_mode text NOT NULL DEFAULT 'text_only',
  ADD COLUMN IF NOT EXISTS ticket_image_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE zentra_erp.sorteos
  DROP CONSTRAINT IF EXISTS sorteos_ticket_delivery_mode_check;

ALTER TABLE zentra_erp.sorteos
  ADD CONSTRAINT sorteos_ticket_delivery_mode_check
  CHECK (ticket_delivery_mode IN ('text_only', 'text_and_image', 'image_only'));

COMMENT ON COLUMN zentra_erp.sorteos.ticket_delivery_mode IS
  'text_only | text_and_image | image_only — respuesta al comprador tras confirmar orden.';
COMMENT ON COLUMN zentra_erp.sorteos.ticket_image_config IS
  'Diseño/caption/visibilidad del ticket PNG (JSON).';

-- -----------------------------------------------------------------------------
-- 2) Tabla sorteo_ticket_deliveries
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zentra_erp.sorteo_ticket_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
  sorteo_id uuid NOT NULL REFERENCES zentra_erp.sorteos(id) ON DELETE CASCADE,
  entrada_id uuid NOT NULL REFERENCES zentra_erp.sorteo_entradas(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES zentra_erp.chat_conversations(id) ON DELETE SET NULL,
  flow_session_id uuid,
  delivery_mode text NOT NULL,
  status text NOT NULL,
  cliente_nombre text,
  cliente_documento text,
  telefono text,
  numero_orden text,
  cupones jsonb NOT NULL DEFAULT '[]'::jsonb,
  storage_bucket text,
  storage_path text,
  whatsapp_message_id text,
  provider text,
  channel_id uuid,
  error_message text,
  payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_revision int NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  png_bytes_hash text,
  generated_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sorteo_ticket_deliveries_delivery_mode_check
    CHECK (delivery_mode IN ('text_only', 'text_and_image', 'image_only')),
  CONSTRAINT sorteo_ticket_deliveries_status_check
    CHECK (status IN ('pending', 'generated', 'sent', 'error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_ticket_entrada_revision
  ON zentra_erp.sorteo_ticket_deliveries (entrada_id, template_revision);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_ticket_entrada_current
  ON zentra_erp.sorteo_ticket_deliveries (entrada_id)
  WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_sorteo_ticket_empresa_sorteo
  ON zentra_erp.sorteo_ticket_deliveries (empresa_id, sorteo_id);

CREATE INDEX IF NOT EXISTS idx_sorteo_ticket_status
  ON zentra_erp.sorteo_ticket_deliveries (empresa_id, status);

DROP TRIGGER IF EXISTS tr_sorteo_ticket_deliveries_updated ON zentra_erp.sorteo_ticket_deliveries;
CREATE TRIGGER tr_sorteo_ticket_deliveries_updated
  BEFORE UPDATE ON zentra_erp.sorteo_ticket_deliveries
  FOR EACH ROW EXECUTE FUNCTION zentra_erp.set_updated_at();

ALTER TABLE zentra_erp.sorteo_ticket_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sorteo_ticket_deliveries_select ON zentra_erp.sorteo_ticket_deliveries;
DROP POLICY IF EXISTS sorteo_ticket_deliveries_insert ON zentra_erp.sorteo_ticket_deliveries;
DROP POLICY IF EXISTS sorteo_ticket_deliveries_update ON zentra_erp.sorteo_ticket_deliveries;
DROP POLICY IF EXISTS sorteo_ticket_deliveries_delete ON zentra_erp.sorteo_ticket_deliveries;

CREATE POLICY sorteo_ticket_deliveries_select ON zentra_erp.sorteo_ticket_deliveries FOR SELECT
  USING (zentra_erp.puede_acceder_empresa(empresa_id));
CREATE POLICY sorteo_ticket_deliveries_insert ON zentra_erp.sorteo_ticket_deliveries FOR INSERT
  WITH CHECK (zentra_erp.puede_acceder_empresa(empresa_id));
CREATE POLICY sorteo_ticket_deliveries_update ON zentra_erp.sorteo_ticket_deliveries FOR UPDATE
  USING (zentra_erp.puede_acceder_empresa(empresa_id))
  WITH CHECK (zentra_erp.puede_acceder_empresa(empresa_id));
CREATE POLICY sorteo_ticket_deliveries_delete ON zentra_erp.sorteo_ticket_deliveries FOR DELETE
  USING (zentra_erp.puede_acceder_empresa(empresa_id));

COMMENT ON TABLE zentra_erp.sorteo_ticket_deliveries IS
  'Intentos de generación/envío de ticket PNG por entrada de sorteo (trazabilidad y errores).';

-- -----------------------------------------------------------------------------
-- 3) Buckets Storage (crear si no existen)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'sorteo-ticket-assets',
  'sorteo-ticket-assets',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'sorteo-tickets-generated',
  'sorteo-tickets-generated',
  false,
  10485760,
  ARRAY['image/png']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- 4) Réplica DDL en schemas tenant (erp_* y er_*)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  sch text;
  sql text;
BEGIN
  FOR sch IN
    SELECT nspname::text
    FROM pg_namespace
    WHERE (nspname ~ '^erp_[a-zA-Z0-9_]+$' OR nspname ~ '^er_[0-9a-f]{32}$')
      AND EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = nspname AND t.table_name = 'sorteos'
      )
  LOOP
    sql := format(
      'ALTER TABLE %I.sorteos ADD COLUMN IF NOT EXISTS ticket_delivery_mode text NOT NULL DEFAULT ''text_only'';
       ALTER TABLE %I.sorteos ADD COLUMN IF NOT EXISTS ticket_image_config jsonb NOT NULL DEFAULT ''{}''::jsonb;
       ALTER TABLE %I.sorteos DROP CONSTRAINT IF EXISTS sorteos_ticket_delivery_mode_check;
       ALTER TABLE %I.sorteos ADD CONSTRAINT sorteos_ticket_delivery_mode_check
         CHECK (ticket_delivery_mode IN (''text_only'', ''text_and_image'', ''image_only''));',
      sch, sch, sch, sch
    );
    BEGIN
      EXECUTE sql;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;

    sql := format($f$
      CREATE TABLE IF NOT EXISTS %I.sorteo_ticket_deliveries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        sorteo_id uuid NOT NULL REFERENCES %I.sorteos(id) ON DELETE CASCADE,
        entrada_id uuid NOT NULL REFERENCES %I.sorteo_entradas(id) ON DELETE CASCADE,
        conversation_id uuid REFERENCES %I.chat_conversations(id) ON DELETE SET NULL,
        flow_session_id uuid,
        delivery_mode text NOT NULL,
        status text NOT NULL,
        cliente_nombre text,
        cliente_documento text,
        telefono text,
        numero_orden text,
        cupones jsonb NOT NULL DEFAULT '[]'::jsonb,
        storage_bucket text,
        storage_path text,
        whatsapp_message_id text,
        provider text,
        channel_id uuid,
        error_message text,
        payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        template_revision int NOT NULL DEFAULT 1,
        is_current boolean NOT NULL DEFAULT true,
        png_bytes_hash text,
        generated_at timestamptz,
        sent_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT sorteo_ticket_deliveries_delivery_mode_check
          CHECK (delivery_mode IN ('text_only', 'text_and_image', 'image_only')),
        CONSTRAINT sorteo_ticket_deliveries_status_check
          CHECK (status IN ('pending', 'generated', 'sent', 'error'))
      );
    $f$, sch, sch, sch, sch);
    EXECUTE sql;

    sql := format(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_ticket_entrada_revision ON %I.sorteo_ticket_deliveries (entrada_id, template_revision);
       CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_ticket_entrada_current ON %I.sorteo_ticket_deliveries (entrada_id) WHERE is_current;
       CREATE INDEX IF NOT EXISTS idx_sorteo_ticket_empresa_sorteo ON %I.sorteo_ticket_deliveries (empresa_id, sorteo_id);
       CREATE INDEX IF NOT EXISTS idx_sorteo_ticket_status ON %I.sorteo_ticket_deliveries (empresa_id, status);',
      sch, sch, sch, sch
    );
    EXECUTE sql;

    sql := format(
      'DROP TRIGGER IF EXISTS tr_sorteo_ticket_deliveries_updated ON %I.sorteo_ticket_deliveries;
       CREATE TRIGGER tr_sorteo_ticket_deliveries_updated
         BEFORE UPDATE ON %I.sorteo_ticket_deliveries
         FOR EACH ROW EXECUTE FUNCTION zentra_erp.set_updated_at();',
      sch, sch
    );
    EXECUTE sql;

    sql := format('ALTER TABLE %I.sorteo_ticket_deliveries ENABLE ROW LEVEL SECURITY;', sch);
    EXECUTE sql;

    sql := format(
      'DROP POLICY IF EXISTS sorteo_ticket_deliveries_select ON %I.sorteo_ticket_deliveries;
       DROP POLICY IF EXISTS sorteo_ticket_deliveries_insert ON %I.sorteo_ticket_deliveries;
       DROP POLICY IF EXISTS sorteo_ticket_deliveries_update ON %I.sorteo_ticket_deliveries;
       DROP POLICY IF EXISTS sorteo_ticket_deliveries_delete ON %I.sorteo_ticket_deliveries;',
      sch, sch, sch, sch
    );
    EXECUTE sql;

    sql := format(
      $pol$
      CREATE POLICY sorteo_ticket_deliveries_select ON %I.sorteo_ticket_deliveries FOR SELECT
        USING (%I.%I(empresa_id));
      CREATE POLICY sorteo_ticket_deliveries_insert ON %I.sorteo_ticket_deliveries FOR INSERT
        WITH CHECK (%I.%I(empresa_id));
      CREATE POLICY sorteo_ticket_deliveries_update ON %I.sorteo_ticket_deliveries FOR UPDATE
        USING (%I.%I(empresa_id))
        WITH CHECK (%I.%I(empresa_id));
      CREATE POLICY sorteo_ticket_deliveries_delete ON %I.sorteo_ticket_deliveries FOR DELETE
        USING (%I.%I(empresa_id));
      $pol$,
      sch, sch, sch, 'puede_acceder_empresa',
      sch, sch, sch, 'puede_acceder_empresa',
      sch, sch, sch, 'puede_acceder_empresa', sch, sch, 'puede_acceder_empresa',
      sch, sch, sch, 'puede_acceder_empresa'
    );
    BEGIN
      EXECUTE sql;
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'sorteo_ticket_deliveries policies skipped for schema % (RLS fn)', sch;
    END;
  END LOOP;
END;
$$;
