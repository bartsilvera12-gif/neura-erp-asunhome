-- =============================================================================
-- Proyectos: configuración de prioridades por empresa (Kanban)
-- - No cambia proyectos.prioridad ni su CHECK existente.
-- - Crea/siembra los 4 códigos internos permitidos: baja, normal, alta, urgente.
-- - Replica en schemas con proyecto_estados: public, zentra_erp, er_*, erp_*.
-- =============================================================================

DO $$
DECLARE
  r   RECORD;
  sch text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyecto_estados'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    sch := r.sch;

    EXECUTE format(
      $sql$
      CREATE TABLE IF NOT EXISTS %I.proyecto_prioridades_config (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        codigo text NOT NULL,
        nombre text NOT NULL,
        color text,
        bg_color text,
        text_color text,
        border_color text,
        sort_order integer NOT NULL DEFAULT 0,
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_proyecto_prioridades_empresa_codigo UNIQUE (empresa_id, codigo),
        CONSTRAINT chk_proyecto_prioridades_codigo CHECK (codigo IN ('baja', 'normal', 'alta', 'urgente')),
        CONSTRAINT chk_proyecto_prioridades_nombre_non_empty CHECK (length(trim(nombre)) > 0),
        CONSTRAINT chk_proyecto_prioridades_color CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
        CONSTRAINT chk_proyecto_prioridades_bg_color CHECK (bg_color IS NULL OR bg_color ~ '^#[0-9A-Fa-f]{6}$'),
        CONSTRAINT chk_proyecto_prioridades_text_color CHECK (text_color IS NULL OR text_color ~ '^#[0-9A-Fa-f]{6}$'),
        CONSTRAINT chk_proyecto_prioridades_border_color CHECK (border_color IS NULL OR border_color ~ '^#[0-9A-Fa-f]{6}$')
      )
      $sql$,
      sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.proyecto_prioridades_config (empresa_id, activo, sort_order)',
      'ix_ppc_' || replace(md5(sch::text), '-', '_'),
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.proyecto_prioridades_config ENABLE ROW LEVEL SECURITY$pol$, sch);

    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_prioridades_config_select ON %I.proyecto_prioridades_config$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_prioridades_config_select ON %I.proyecto_prioridades_config FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_prioridades_config_insert ON %I.proyecto_prioridades_config$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_prioridades_config_insert ON %I.proyecto_prioridades_config FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_prioridades_config_update ON %I.proyecto_prioridades_config$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_prioridades_config_update ON %I.proyecto_prioridades_config FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS proyecto_prioridades_config_delete ON %I.proyecto_prioridades_config$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY proyecto_prioridades_config_delete ON %I.proyecto_prioridades_config FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );

    EXECUTE format($tr$DROP TRIGGER IF EXISTS tr_proyecto_prioridades_config_updated ON %I.proyecto_prioridades_config$tr$, sch);
    EXECUTE format(
      $tr$CREATE TRIGGER tr_proyecto_prioridades_config_updated BEFORE UPDATE ON %I.proyecto_prioridades_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$tr$,
      sch
    );
  END LOOP;
END $$;

DO $$
DECLARE
  r       RECORD;
  rec     RECORD;
  eid     uuid;
  rows_pr jsonb := '[
    {"codigo":"baja","nombre":"Baja","orden":10,"color":"#64748b","bg":"#f1f5f9","text":"#475569","border":"#cbd5e1"},
    {"codigo":"normal","nombre":"Media","orden":20,"color":"#475569","bg":"#e2e8f0","text":"#1e293b","border":"#cbd5e1"},
    {"codigo":"alta","nombre":"Alta","orden":30,"color":"#f97316","bg":"#f97316","text":"#ffffff","border":"#ea580c"},
    {"codigo":"urgente","nombre":"Urgente","orden":40,"color":"#dc2626","bg":"#dc2626","text":"#ffffff","border":"#b91c1c"}
  ]'::jsonb;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'proyecto_prioridades_config'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    FOR eid IN
      SELECT e.id
      FROM zentra_erp.empresas e
      WHERE CASE
        WHEN r.sch IN ('public', 'zentra_erp')
          THEN COALESCE(NULLIF(trim(e.data_schema), ''), 'zentra_erp') = 'zentra_erp'
        ELSE COALESCE(NULLIF(trim(e.data_schema), ''), 'zentra_erp') = r.sch
      END
    LOOP
      FOR rec IN SELECT * FROM jsonb_array_elements(rows_pr)
      LOOP
        EXECUTE format(
          $ins$
          INSERT INTO %I.proyecto_prioridades_config (
            empresa_id, codigo, nombre, color, bg_color, text_color, border_color, sort_order, activo
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, ($8)::int, true)
          ON CONFLICT (empresa_id, codigo) DO NOTHING
          $ins$,
          r.sch
        ) USING
          eid,
          rec.value->>'codigo',
          rec.value->>'nombre',
          rec.value->>'color',
          rec.value->>'bg',
          rec.value->>'text',
          rec.value->>'border',
          (rec.value->>'orden')::int;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
