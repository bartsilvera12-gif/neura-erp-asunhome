-- =============================================================================
-- Marketing Ops independiente (multi-schema)
-- Datos operativos en zentra_erp / schemas tenant. No usa public.marketing_tasks.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
  tbl text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'clientes'
      AND c.relkind = 'r'
      AND (
        n.nspname = 'zentra_erp'
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    sch := r.sch;

    EXECUTE format(
      $sql$
      CREATE TABLE IF NOT EXISTS %I.marketing_calendarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        cliente_id uuid REFERENCES %I.clientes(id) ON DELETE SET NULL,
        mes text,
        semana integer,
        fecha_inicio date,
        fecha_fin date,
        estado_calendario text NOT NULL DEFAULT 'pendiente',
        enviado_estado text NOT NULL DEFAULT 'no_enviado',
        aprobado_estado text NOT NULL DEFAULT 'pendiente',
        observaciones text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        updated_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
      $sql$,
      sch,
      sch
    );

    EXECUTE format(
      $sql$
      CREATE TABLE IF NOT EXISTS %I.marketing_piezas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        calendario_id uuid REFERENCES %I.marketing_calendarios(id) ON DELETE SET NULL,
        cliente_id uuid REFERENCES %I.clientes(id) ON DELETE SET NULL,
        titulo text NOT NULL,
        tipo_pieza text,
        canal text,
        responsable_id uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        fecha_limite date,
        fecha_publicacion date,
        prioridad text NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta', 'urgente')),
        estado_produccion text NOT NULL DEFAULT 'por_hacer' CHECK (estado_produccion IN ('por_hacer', 'en_produccion', 'revision_interna', 'correccion_interna', 'listo_para_enviar')),
        estado_cliente text NOT NULL DEFAULT 'no_enviado' CHECK (estado_cliente IN ('no_enviado', 'enviado', 'aprobado', 'con_correcciones', 'sin_respuesta')),
        estado_publicacion text NOT NULL DEFAULT 'pendiente' CHECK (estado_publicacion IN ('pendiente', 'programado', 'publicado', 'cancelado')),
        link_archivo text,
        observaciones text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        updated_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_marketing_piezas_titulo_non_empty CHECK (length(trim(titulo)) > 0)
      )
      $sql$,
      sch,
      sch,
      sch
    );

    EXECUTE format(
      $sql$
      CREATE TABLE IF NOT EXISTS %I.marketing_comentarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        pieza_id uuid NOT NULL REFERENCES %I.marketing_piezas(id) ON DELETE CASCADE,
        usuario_id uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        comentario text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_marketing_comentarios_texto_non_empty CHECK (length(trim(comentario)) > 0)
      )
      $sql$,
      sch,
      sch
    );

    EXECUTE format(
      $sql$
      CREATE TABLE IF NOT EXISTS %I.marketing_historial_estados (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        pieza_id uuid NOT NULL REFERENCES %I.marketing_piezas(id) ON DELETE CASCADE,
        campo text NOT NULL,
        estado_anterior text,
        estado_nuevo text,
        changed_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        changed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_marketing_historial_campo_non_empty CHECK (length(trim(campo)) > 0)
      )
      $sql$,
      sch,
      sch
    );

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.marketing_calendarios (empresa_id, cliente_id, mes)', 'ix_mk_cal_' || replace(md5(sch::text), '-', '_'), sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.marketing_piezas (empresa_id, fecha_limite)', 'ix_mk_pz_lim_' || replace(md5(sch::text), '-', '_'), sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.marketing_piezas (empresa_id, cliente_id)', 'ix_mk_pz_cli_' || replace(md5(sch::text), '-', '_'), sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.marketing_piezas (empresa_id, responsable_id)', 'ix_mk_pz_resp_' || replace(md5(sch::text), '-', '_'), sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.marketing_piezas (empresa_id, estado_produccion)', 'ix_mk_pz_prod_' || replace(md5(sch::text), '-', '_'), sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.marketing_comentarios (empresa_id, pieza_id, created_at DESC)', 'ix_mk_com_' || replace(md5(sch::text), '-', '_'), sch);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.marketing_historial_estados (empresa_id, pieza_id, changed_at DESC)', 'ix_mk_hist_' || replace(md5(sch::text), '-', '_'), sch);

    EXECUTE format($pol$ALTER TABLE %I.marketing_calendarios ENABLE ROW LEVEL SECURITY$pol$, sch);
    EXECUTE format($pol$ALTER TABLE %I.marketing_piezas ENABLE ROW LEVEL SECURITY$pol$, sch);
    EXECUTE format($pol$ALTER TABLE %I.marketing_comentarios ENABLE ROW LEVEL SECURITY$pol$, sch);
    EXECUTE format($pol$ALTER TABLE %I.marketing_historial_estados ENABLE ROW LEVEL SECURITY$pol$, sch);

    FOREACH tbl IN ARRAY ARRAY[
      'marketing_calendarios',
      'marketing_piezas',
      'marketing_comentarios',
      'marketing_historial_estados'
    ]
    LOOP
      EXECUTE format($pol$DROP POLICY IF EXISTS %I ON %I.%I$pol$, tbl || '_select', sch, tbl);
      EXECUTE format($pol$CREATE POLICY %I ON %I.%I FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$, tbl || '_select', sch, tbl);
      EXECUTE format($pol$DROP POLICY IF EXISTS %I ON %I.%I$pol$, tbl || '_insert', sch, tbl);
      EXECUTE format($pol$CREATE POLICY %I ON %I.%I FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$, tbl || '_insert', sch, tbl);
      EXECUTE format($pol$DROP POLICY IF EXISTS %I ON %I.%I$pol$, tbl || '_update', sch, tbl);
      EXECUTE format($pol$CREATE POLICY %I ON %I.%I FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$, tbl || '_update', sch, tbl);
      EXECUTE format($pol$DROP POLICY IF EXISTS %I ON %I.%I$pol$, tbl || '_delete', sch, tbl);
      EXECUTE format($pol$CREATE POLICY %I ON %I.%I FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$, tbl || '_delete', sch, tbl);
    END LOOP;

    EXECUTE format($tr$DROP TRIGGER IF EXISTS tr_marketing_calendarios_updated ON %I.marketing_calendarios$tr$, sch);
    EXECUTE format($tr$CREATE TRIGGER tr_marketing_calendarios_updated BEFORE UPDATE ON %I.marketing_calendarios FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$tr$, sch);
    EXECUTE format($tr$DROP TRIGGER IF EXISTS tr_marketing_piezas_updated ON %I.marketing_piezas$tr$, sch);
    EXECUTE format($tr$CREATE TRIGGER tr_marketing_piezas_updated BEFORE UPDATE ON %I.marketing_piezas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$tr$, sch);
  END LOOP;
END $$;

INSERT INTO zentra_erp.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Marketing Ops', 'marketing_ops'
WHERE NOT EXISTS (SELECT 1 FROM zentra_erp.modulos WHERE slug = 'marketing_ops');

INSERT INTO zentra_erp.empresa_modulos (empresa_id, modulo_id, activo)
SELECT e.id, m.id, true
FROM zentra_erp.empresas e
CROSS JOIN zentra_erp.modulos m
WHERE m.slug = 'marketing_ops'
  AND NOT EXISTS (
    SELECT 1
    FROM zentra_erp.empresa_modulos em
    WHERE em.empresa_id = e.id
      AND em.modulo_id = m.id
  );
