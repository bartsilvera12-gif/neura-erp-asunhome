-- =============================================================================
-- Módulo Proyectos (Kanban, SLA configurable, multi-schema)
-- Réplica en todo schema con tabla `clientes` (public, zentra_erp, er_*, erp_*).
-- RLS: public.puede_acceder_empresa(empresa_id)
-- =============================================================================

DO $$
DECLARE
  r       RECORD;
  sch     text;
  fq_tipos regclass;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'clientes'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    sch := r.sch;
    fq_tipos := to_regclass(format('%I.proyecto_tipos', sch));
    IF fq_tipos IS NOT NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      $sql$
      CREATE TABLE %I.proyecto_tipos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        nombre text NOT NULL,
        codigo text NOT NULL,
        descripcion text,
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_proyecto_tipos_empresa_codigo UNIQUE (empresa_id, codigo),
        CONSTRAINT chk_proyecto_tipos_codigo_non_empty CHECK (length(trim(codigo)) > 0)
      )
      $sql$,
      sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_tipos (empresa_id, activo)',
      'ix_pt_' || replace(md5(sch::text), '-', '_'),
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.proyecto_tipos ENABLE ROW LEVEL SECURITY$pol$, sch);

    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_tipos_select ON %I.proyecto_tipos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_tipos_select ON %I.proyecto_tipos FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_tipos_insert ON %I.proyecto_tipos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_tipos_insert ON %I.proyecto_tipos FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_tipos_update ON %I.proyecto_tipos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_tipos_update ON %I.proyecto_tipos FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_tipos_delete ON %I.proyecto_tipos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_tipos_delete ON %I.proyecto_tipos FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );

    EXECUTE format($tr$DROP TRIGGER IF EXISTS tr_proyecto_tipos_updated ON %I.proyecto_tipos$tr$, sch);
    EXECUTE format(
      $tr$CREATE TRIGGER tr_proyecto_tipos_updated BEFORE UPDATE ON %I.proyecto_tipos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$tr$,
      sch
    );

    EXECUTE format(
      $sql$
      CREATE TABLE %I.proyecto_estados (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        nombre text NOT NULL,
        codigo text NOT NULL,
        descripcion text,
        color text NOT NULL DEFAULT '#64748b',
        sort_order integer NOT NULL DEFAULT 0,
        cuenta_sla boolean NOT NULL DEFAULT true,
        tipo_sla text NOT NULL CHECK (tipo_sla IN ('interno', 'cliente', 'pausado', 'final')),
        sla_horas_objetivo integer,
        es_estado_inicial boolean NOT NULL DEFAULT false,
        es_estado_final boolean NOT NULL DEFAULT false,
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_proyecto_estados_empresa_codigo UNIQUE (empresa_id, codigo),
        CONSTRAINT chk_proyecto_estados_codigo_non_empty CHECK (length(trim(codigo)) > 0)
      )
      $sql$,
      sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_estados (empresa_id, activo, sort_order)',
      'ix_pe_' || replace(md5(sch::text), '-', '_'),
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.proyecto_estados ENABLE ROW LEVEL SECURITY$pol$, sch);

    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_estados_select ON %I.proyecto_estados$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_estados_select ON %I.proyecto_estados FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_estados_insert ON %I.proyecto_estados$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_estados_insert ON %I.proyecto_estados FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_estados_update ON %I.proyecto_estados$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_estados_update ON %I.proyecto_estados FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_estados_delete ON %I.proyecto_estados$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_estados_delete ON %I.proyecto_estados FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );

    EXECUTE format($tr$DROP TRIGGER IF EXISTS tr_proyecto_estados_updated ON %I.proyecto_estados$tr$, sch);
    EXECUTE format(
      $tr$CREATE TRIGGER tr_proyecto_estados_updated BEFORE UPDATE ON %I.proyecto_estados FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$tr$,
      sch
    );

    EXECUTE format(
      $sql$
      CREATE TABLE %I.proyectos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        cliente_id uuid REFERENCES %I.clientes(id) ON DELETE SET NULL,
        tipo_id uuid NOT NULL REFERENCES %I.proyecto_tipos(id) ON DELETE RESTRICT,
        estado_id uuid NOT NULL REFERENCES %I.proyecto_estados(id) ON DELETE RESTRICT,
        titulo text NOT NULL,
        descripcion text,
        prioridad text NOT NULL DEFAULT 'normal' CHECK (prioridad IN ('baja', 'normal', 'alta', 'urgente')),
        responsable_comercial_id uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        responsable_tecnico_id uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        fecha_ingreso timestamptz NOT NULL DEFAULT now(),
        fecha_prometida timestamptz,
        fecha_entrega timestamptz,
        monto_vendido numeric(14,2),
        observaciones_comerciales text,
        brief_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        bloqueado boolean NOT NULL DEFAULT false,
        bloqueo_motivo text,
        archivado boolean NOT NULL DEFAULT false,
        ultimo_movimiento_at timestamptz NOT NULL DEFAULT now(),
        last_activity_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        updated_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_proyectos_titulo_non_empty CHECK (length(trim(titulo)) > 0)
      )
      $sql$,
      sch,
      sch,
      sch,
      sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyectos (empresa_id, estado_id, archivado)',
      'ix_pr_est_' || replace(md5(sch::text), '-', '_'),
      sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyectos (empresa_id, cliente_id)',
      'ix_pr_cli_' || replace(md5(sch::text), '-', '_'),
      sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyectos (empresa_id, tipo_id)',
      'ix_pr_tip_' || replace(md5(sch::text), '-', '_'),
      sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyectos (empresa_id, fecha_prometida)',
      'ix_pr_fp_' || replace(md5(sch::text), '-', '_'),
      sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyectos (empresa_id, responsable_comercial_id)',
      'ix_pr_rc_' || replace(md5(sch::text), '-', '_'),
      sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyectos (empresa_id, responsable_tecnico_id)',
      'ix_pr_rt_' || replace(md5(sch::text), '-', '_'),
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.proyectos ENABLE ROW LEVEL SECURITY$pol$, sch);

    EXECUTE format($pol$DROP POLICY IF EXISTS proyectos_select ON %I.proyectos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyectos_select ON %I.proyectos FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyectos_insert ON %I.proyectos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyectos_insert ON %I.proyectos FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyectos_update ON %I.proyectos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyectos_update ON %I.proyectos FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyectos_delete ON %I.proyectos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyectos_delete ON %I.proyectos FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );

    EXECUTE format($tr$DROP TRIGGER IF EXISTS tr_proyectos_updated ON %I.proyectos$tr$, sch);
    EXECUTE format(
      $tr$CREATE TRIGGER tr_proyectos_updated BEFORE UPDATE ON %I.proyectos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$tr$,
      sch
    );

    EXECUTE format(
      $sql$
      CREATE TABLE %I.proyecto_tareas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        proyecto_id uuid NOT NULL REFERENCES %I.proyectos(id) ON DELETE CASCADE,
        titulo text NOT NULL,
        descripcion text,
        estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_proceso', 'completada', 'bloqueada')),
        responsable_id uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        fecha_limite timestamptz,
        sort_order integer NOT NULL DEFAULT 0,
        completed_at timestamptz,
        created_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_proyecto_tareas_titulo_non_empty CHECK (length(trim(titulo)) > 0)
      )
      $sql$,
      sch,
      sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_tareas (empresa_id, proyecto_id)',
      'ix_ptar_' || replace(md5(sch::text), '-', '_'),
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.proyecto_tareas ENABLE ROW LEVEL SECURITY$pol$, sch);

    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_tareas_select ON %I.proyecto_tareas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_tareas_select ON %I.proyecto_tareas FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_tareas_insert ON %I.proyecto_tareas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_tareas_insert ON %I.proyecto_tareas FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_tareas_update ON %I.proyecto_tareas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_tareas_update ON %I.proyecto_tareas FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_tareas_delete ON %I.proyecto_tareas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_tareas_delete ON %I.proyecto_tareas FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );

    EXECUTE format($tr$DROP TRIGGER IF EXISTS tr_proyecto_tareas_updated ON %I.proyecto_tareas$tr$, sch);
    EXECUTE format(
      $tr$CREATE TRIGGER tr_proyecto_tareas_updated BEFORE UPDATE ON %I.proyecto_tareas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$tr$,
      sch
    );

    EXECUTE format(
      $sql$
      CREATE TABLE %I.proyecto_comentarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        proyecto_id uuid NOT NULL REFERENCES %I.proyectos(id) ON DELETE CASCADE,
        usuario_id uuid NOT NULL REFERENCES zentra_erp.usuarios(id) ON DELETE CASCADE,
        comentario text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_proyecto_comentarios_texto_non_empty CHECK (length(trim(comentario)) > 0)
      )
      $sql$,
      sch,
      sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_comentarios (empresa_id, proyecto_id, created_at DESC)',
      'ix_pc_' || replace(md5(sch::text), '-', '_'),
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.proyecto_comentarios ENABLE ROW LEVEL SECURITY$pol$, sch);

    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_comentarios_select ON %I.proyecto_comentarios$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_comentarios_select ON %I.proyecto_comentarios FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_comentarios_insert ON %I.proyecto_comentarios$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_comentarios_insert ON %I.proyecto_comentarios FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_comentarios_update ON %I.proyecto_comentarios$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_comentarios_update ON %I.proyecto_comentarios FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_comentarios_delete ON %I.proyecto_comentarios$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_comentarios_delete ON %I.proyecto_comentarios FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );

    EXECUTE format($tr$DROP TRIGGER IF EXISTS tr_proyecto_comentarios_updated ON %I.proyecto_comentarios$tr$, sch);
    EXECUTE format(
      $tr$CREATE TRIGGER tr_proyecto_comentarios_updated BEFORE UPDATE ON %I.proyecto_comentarios FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$tr$,
      sch
    );

    EXECUTE format(
      $sql$
      CREATE TABLE %I.proyecto_archivos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        proyecto_id uuid NOT NULL REFERENCES %I.proyectos(id) ON DELETE CASCADE,
        nombre text NOT NULL,
        storage_bucket text NOT NULL DEFAULT 'proyectos',
        storage_path text NOT NULL,
        mime_type text,
        size_bytes bigint,
        uploaded_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_proyecto_archivos_storage_natural UNIQUE (empresa_id, storage_bucket, storage_path),
        CONSTRAINT chk_proyecto_archivos_nombre_non_empty CHECK (length(trim(nombre)) > 0)
      )
      $sql$,
      sch,
      sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_archivos (empresa_id, proyecto_id)',
      'ix_paf_' || replace(md5(sch::text), '-', '_'),
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.proyecto_archivos ENABLE ROW LEVEL SECURITY$pol$, sch);

    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_archivos_select ON %I.proyecto_archivos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_archivos_select ON %I.proyecto_archivos FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_archivos_insert ON %I.proyecto_archivos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_archivos_insert ON %I.proyecto_archivos FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_archivos_update ON %I.proyecto_archivos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_archivos_update ON %I.proyecto_archivos FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_archivos_delete ON %I.proyecto_archivos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_archivos_delete ON %I.proyecto_archivos FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );

    EXECUTE format(
      $sql$
      CREATE TABLE %I.proyecto_estado_historial (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        proyecto_id uuid NOT NULL REFERENCES %I.proyectos(id) ON DELETE CASCADE,
        estado_anterior_id uuid REFERENCES %I.proyecto_estados(id) ON DELETE SET NULL,
        estado_nuevo_id uuid NOT NULL REFERENCES %I.proyecto_estados(id) ON DELETE RESTRICT,
        changed_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        changed_at timestamptz NOT NULL DEFAULT now(),
        entered_at timestamptz NOT NULL DEFAULT now(),
        exited_at timestamptz,
        duration_seconds bigint,
        tipo_sla_snapshot text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      )
      $sql$,
      sch,
      sch,
      sch,
      sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_estado_historial (empresa_id, proyecto_id, entered_at)',
      'ix_peh_' || replace(md5(sch::text), '-', '_'),
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.proyecto_estado_historial ENABLE ROW LEVEL SECURITY$pol$, sch);

    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_estado_historial_select ON %I.proyecto_estado_historial$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_estado_historial_select ON %I.proyecto_estado_historial FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_estado_historial_insert ON %I.proyecto_estado_historial$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_estado_historial_insert ON %I.proyecto_estado_historial FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_estado_historial_update ON %I.proyecto_estado_historial$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_estado_historial_update ON %I.proyecto_estado_historial FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_estado_historial_delete ON %I.proyecto_estado_historial$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_estado_historial_delete ON %I.proyecto_estado_historial FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );

  END LOOP;
END $$;

-- Seed idempotente: tipo "Proyecto Web" + estados Kanban por empresa
DO $$
DECLARE
  r       RECORD;
  rec     RECORD;
  sch     text;
  eid     uuid;
  rows_st jsonb := '[
    {"codigo":"nuevo","nombre":"Nuevo / Pendiente de brief","orden":10,"color":"#94a3b8","tipo":"interno","cuenta":true,"ini":true,"fin":false},
    {"codigo":"brief_cargado","nombre":"Brief cargado","orden":20,"color":"#38bdf8","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"cola_produccion","nombre":"En cola de producción","orden":30,"color":"#6366f1","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"diseno","nombre":"En diseño","orden":40,"color":"#a855f7","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"desarrollo","nombre":"En desarrollo","orden":50,"color":"#8b5cf6","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"revision_interna","nombre":"Revisión interna","orden":60,"color":"#f97316","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"enviado_cliente","nombre":"Enviado al cliente","orden":70,"color":"#22c55e","tipo":"cliente","cuenta":true,"ini":false,"fin":false},
    {"codigo":"espera_cliente","nombre":"Esperando respuesta del cliente","orden":80,"color":"#eab308","tipo":"cliente","cuenta":true,"ini":false,"fin":false},
    {"codigo":"cambios_solicitados","nombre":"Cambios solicitados","orden":90,"color":"#ef4444","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"listo_publicar","nombre":"Listo para publicar","orden":100,"color":"#14b8a6","tipo":"interno","cuenta":true,"ini":false,"fin":false},
    {"codigo":"publicado","nombre":"Publicado / Entregado","orden":110,"color":"#22c55e","tipo":"final","cuenta":false,"ini":false,"fin":true},
    {"codigo":"pausado","nombre":"Pausado","orden":120,"color":"#64748b","tipo":"pausado","cuenta":false,"ini":false,"fin":false},
    {"codigo":"cancelado","nombre":"Cancelado","orden":130,"color":"#475569","tipo":"final","cuenta":false,"ini":false,"fin":true}
  ]'::jsonb;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyecto_tipos'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    sch := r.sch;
    FOR eid IN SELECT id FROM zentra_erp.empresas
    LOOP
      EXECUTE format(
        $ins$
        INSERT INTO %I.proyecto_tipos (empresa_id, nombre, codigo, descripcion, activo)
        SELECT $1, 'Proyecto Web', 'web', 'Sitios y landings vendidos por comercial', true
        WHERE NOT EXISTS (
          SELECT 1 FROM %I.proyecto_tipos t WHERE t.empresa_id = $1 AND t.codigo = 'web'
        )
        $ins$,
        sch,
        sch
      ) USING eid;

      FOR rec IN SELECT * FROM jsonb_array_elements(rows_st)
      LOOP
        EXECUTE format(
          $ins$
          INSERT INTO %I.proyecto_estados (
            empresa_id, nombre, codigo, color, sort_order, cuenta_sla, tipo_sla,
            es_estado_inicial, es_estado_final, activo
          )
          SELECT
            $1,
            $2,
            $3,
            $4,
            ($5)::int,
            ($6)::boolean,
            $7,
            ($8)::boolean,
            ($9)::boolean,
            true
          WHERE NOT EXISTS (
            SELECT 1 FROM %I.proyecto_estados e
            WHERE e.empresa_id = $1 AND e.codigo = $3
          )
          $ins$,
          sch,
          sch
        ) USING
          eid,
          rec.value->>'nombre',
          rec.value->>'codigo',
          rec.value->>'color',
          (rec.value->>'orden')::int,
          (rec.value->>'cuenta')::boolean,
          rec.value->>'tipo',
          (rec.value->>'ini')::boolean,
          (rec.value->>'fin')::boolean;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- Catálogo módulos + habilitación empresas (zentra_erp / public legacy)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'zentra_erp' AND table_name = 'modulos'
  ) THEN
    INSERT INTO zentra_erp.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Proyectos', 'proyectos'
    WHERE NOT EXISTS (SELECT 1 FROM zentra_erp.modulos WHERE slug = 'proyectos');

    INSERT INTO zentra_erp.empresa_modulos (empresa_id, modulo_id, activo)
    SELECT e.id, m.id, true
    FROM zentra_erp.empresas e
    CROSS JOIN zentra_erp.modulos m
    WHERE m.slug = 'proyectos'
      AND NOT EXISTS (
        SELECT 1 FROM zentra_erp.empresa_modulos em
        WHERE em.empresa_id = e.id AND em.modulo_id = m.id
      );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'modulos'
  ) THEN
    INSERT INTO public.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Proyectos', 'proyectos'
    WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'proyectos');

    INSERT INTO public.empresa_modulos (empresa_id, modulo_id, activo)
    SELECT e.id, m.id, true
    FROM public.empresas e
    CROSS JOIN public.modulos m
    WHERE m.slug = 'proyectos'
      AND NOT EXISTS (
        SELECT 1 FROM public.empresa_modulos em
        WHERE em.empresa_id = e.id AND em.modulo_id = m.id
      );
  END IF;
END $$;
