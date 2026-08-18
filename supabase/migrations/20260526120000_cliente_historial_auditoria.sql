-- Registro de auditoría por cliente (p. ej. cambio de plan) en public, zentra_erp y esquemas tenant.

DO $$
DECLARE
  r RECORD;
  sch text;
BEGIN
  FOR r IN
    WITH cand AS (
      SELECT n.nspname AS nsp
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'clientes'
        AND c.relkind = 'r'
        AND (
          n.nspname IN ('public', 'zentra_erp')
          OR n.nspname ~ '^er_[0-9a-f]{32}$'
          OR n.nspname LIKE 'erp\_%' ESCAPE '\'
        )
    )
    SELECT c1.nsp
    FROM cand c1
    WHERE EXISTS (
        SELECT 1
        FROM pg_class x
        JOIN pg_namespace nx ON x.relnamespace = nx.oid
        WHERE nx.nspname = c1.nsp AND x.relname = 'empresas' AND x.relkind = 'r'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_class x
        JOIN pg_namespace nx ON x.relnamespace = nx.oid
        WHERE nx.nspname = c1.nsp AND x.relname = 'facturas' AND x.relkind = 'r'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_class x
        JOIN pg_namespace nx ON x.relnamespace = nx.oid
        WHERE nx.nspname = c1.nsp AND x.relname = 'suscripciones' AND x.relkind = 'r'
      )
  LOOP
    sch := r.nsp;
    EXECUTE format($c$
      CREATE TABLE IF NOT EXISTS %I.cliente_historial (
        id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id              uuid NOT NULL REFERENCES %I.empresas(id) ON DELETE CASCADE,
        cliente_id              uuid NOT NULL REFERENCES %I.clientes(id) ON DELETE CASCADE,
        suscripcion_id          uuid REFERENCES %I.suscripciones(id) ON DELETE SET NULL,
        tipo                    text NOT NULL,
        accion                  text NOT NULL,
        plan_anterior_id         uuid,
        plan_nuevo_id            uuid,
        plan_anterior_nombre     text,
        plan_nuevo_nombre        text,
        modo                     text,
        factura_id               uuid REFERENCES %I.facturas(id) ON DELETE SET NULL,
        plan_pendiente_vigente_desde date,
        creado_por_auth_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
        creado_por_email         text,
        detalle                  jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at               timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT cliente_historial_modo_check CHECK (modo IS NULL OR modo IN (
          'inmediato', 'proximo_mes', 'actualizar_factura_pendiente'
        ))
      )
    $c$, sch, sch, sch, sch, sch);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.cliente_historial (cliente_id, created_at DESC)', 'idx_cliente_historial_cliente_at', sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.cliente_historial (empresa_id, created_at DESC)', 'idx_cliente_historial_empresa_at', sch);

    EXECUTE format('ALTER TABLE %I.cliente_historial ENABLE ROW LEVEL SECURITY', sch);

    EXECUTE format('DROP POLICY IF EXISTS "cliente_historial_select" ON %I.cliente_historial', sch);
    EXECUTE format(
      'CREATE POLICY "cliente_historial_select" ON %I.cliente_historial FOR SELECT
       USING (public.puede_acceder_empresa(empresa_id))',
      sch
    );
    EXECUTE format('DROP POLICY IF EXISTS "cliente_historial_insert" ON %I.cliente_historial', sch);
    EXECUTE format(
      'CREATE POLICY "cliente_historial_insert" ON %I.cliente_historial FOR INSERT
       WITH CHECK (public.puede_acceder_empresa(empresa_id))',
      sch
    );
  END LOOP;
END $$;

COMMENT ON TABLE public.cliente_historial IS
  'Auditoría de acciones sobre clientes; persiste p. ej. cambios de plan. No sustituye emitEvent (webhook/log).';
