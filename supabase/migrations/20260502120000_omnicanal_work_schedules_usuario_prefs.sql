-- =============================================================================
-- Horarios de trabajo omnicanal + preferencias por usuario (habilitación / turno)
-- Esquemas: public, zentra_erp, tenant er_* / erp_* donde exista chat_queues
-- Backfill: usuarios que ya tienen chat_agents activos → omnicanal_agent_enabled true
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  pol text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_queues'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    IF r.sch = 'public' THEN
      pol := 'public.puede_acceder_empresa(empresa_id)';
    ELSE
      pol := 'zentra_erp.puede_acceder_empresa(empresa_id)';
    END IF;

    ---------------------------------------------------------------------------
    -- chat_omnicanal_work_schedules
    ---------------------------------------------------------------------------
    EXECUTE format(
      $f$
      CREATE TABLE IF NOT EXISTS %I.chat_omnicanal_work_schedules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        nombre text NOT NULL,
        time_start time NOT NULL,
        time_end time NOT NULL,
        days_of_week smallint[] NOT NULL DEFAULT '{}'::smallint[],
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chat_omnicanal_work_schedules_days_check CHECK (
          days_of_week <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
        )
      )
      $f$,
      r.sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_omn_sched_empresa ON %I.chat_omnicanal_work_schedules (empresa_id)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_omn_sched_activo ON %I.chat_omnicanal_work_schedules (empresa_id, is_active)',
      r.sch
    );

    EXECUTE format(
      'COMMENT ON TABLE %I.chat_omnicanal_work_schedules IS %L',
      r.sch,
      'Plantillas de horario omnicanal (nombre, franja horaria, días ISO 1=Lun … 7=Dom).'
    );

    EXECUTE format('ALTER TABLE %I.chat_omnicanal_work_schedules ENABLE ROW LEVEL SECURITY', r.sch);
    EXECUTE format(
      'DROP POLICY IF EXISTS chat_omn_sched_select ON %I.chat_omnicanal_work_schedules',
      r.sch
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS chat_omn_sched_insert ON %I.chat_omnicanal_work_schedules',
      r.sch
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS chat_omn_sched_update ON %I.chat_omnicanal_work_schedules',
      r.sch
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS chat_omn_sched_delete ON %I.chat_omnicanal_work_schedules',
      r.sch
    );
    EXECUTE format(
      'CREATE POLICY chat_omn_sched_select ON %I.chat_omnicanal_work_schedules FOR SELECT USING (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_omn_sched_insert ON %I.chat_omnicanal_work_schedules FOR INSERT WITH CHECK (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_omn_sched_update ON %I.chat_omnicanal_work_schedules FOR UPDATE USING (%s) WITH CHECK (%s)',
      r.sch,
      pol,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_omn_sched_delete ON %I.chat_omnicanal_work_schedules FOR DELETE USING (%s)',
      r.sch,
      pol
    );

    EXECUTE format(
      'DROP TRIGGER IF EXISTS tr_chat_omn_sched_updated ON %I.chat_omnicanal_work_schedules',
      r.sch
    );
    BEGIN
      EXECUTE format(
        'CREATE TRIGGER tr_chat_omn_sched_updated
         BEFORE UPDATE ON %I.chat_omnicanal_work_schedules
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
        r.sch
      );
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'omnicanal_schedules: set_updated_at ausente en %', r.sch;
    END;

    ---------------------------------------------------------------------------
    -- chat_usuario_omnicanal
    ---------------------------------------------------------------------------
    EXECUTE format(
      $f$
      CREATE TABLE IF NOT EXISTS %I.chat_usuario_omnicanal (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
        omnicanal_agent_enabled boolean NOT NULL DEFAULT false,
        work_schedule_id uuid REFERENCES %I.chat_omnicanal_work_schedules(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chat_usuario_omnicanal_empresa_usuario_key UNIQUE (empresa_id, usuario_id)
      )
      $f$,
      r.sch,
      r.sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_usuario_omnicanal_empresa ON %I.chat_usuario_omnicanal (empresa_id)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_usuario_omnicanal_usuario ON %I.chat_usuario_omnicanal (usuario_id)',
      r.sch
    );

    EXECUTE format(
      'COMMENT ON TABLE %I.chat_usuario_omnicanal IS %L',
      r.sch,
      'Habilitación explícita como agente omnicanal y turno (horario) por empresa + usuario catálogo.'
    );
    EXECUTE format(
      'COMMENT ON COLUMN %I.chat_usuario_omnicanal.omnicanal_agent_enabled IS %L',
      r.sch,
      'Si es true, el usuario puede operar como agente (autoasignación, circuito operativo).'
    );

    EXECUTE format('ALTER TABLE %I.chat_usuario_omnicanal ENABLE ROW LEVEL SECURITY', r.sch);
    EXECUTE format(
      'DROP POLICY IF EXISTS chat_usuario_omnicanal_select ON %I.chat_usuario_omnicanal',
      r.sch
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS chat_usuario_omnicanal_insert ON %I.chat_usuario_omnicanal',
      r.sch
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS chat_usuario_omnicanal_update ON %I.chat_usuario_omnicanal',
      r.sch
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS chat_usuario_omnicanal_delete ON %I.chat_usuario_omnicanal',
      r.sch
    );
    EXECUTE format(
      'CREATE POLICY chat_usuario_omnicanal_select ON %I.chat_usuario_omnicanal FOR SELECT USING (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_usuario_omnicanal_insert ON %I.chat_usuario_omnicanal FOR INSERT WITH CHECK (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_usuario_omnicanal_update ON %I.chat_usuario_omnicanal FOR UPDATE USING (%s) WITH CHECK (%s)',
      r.sch,
      pol,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_usuario_omnicanal_delete ON %I.chat_usuario_omnicanal FOR DELETE USING (%s)',
      r.sch,
      pol
    );

    EXECUTE format(
      'DROP TRIGGER IF EXISTS tr_chat_usuario_omnicanal_updated ON %I.chat_usuario_omnicanal',
      r.sch
    );
    BEGIN
      EXECUTE format(
        'CREATE TRIGGER tr_chat_usuario_omnicanal_updated
         BEFORE UPDATE ON %I.chat_usuario_omnicanal
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
        r.sch
      );
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'chat_usuario_omnicanal: set_updated_at ausente en %', r.sch;
    END;

    ---------------------------------------------------------------------------
    -- Backfill habilitación para agentes ya existentes
    ---------------------------------------------------------------------------
    EXECUTE format(
      $f$
      INSERT INTO %I.chat_usuario_omnicanal (empresa_id, usuario_id, omnicanal_agent_enabled, created_at, updated_at)
      SELECT DISTINCT ca.empresa_id, ca.usuario_id, true, now(), now()
      FROM %I.chat_agents ca
      WHERE COALESCE(ca.is_active, true) = true
      ON CONFLICT (empresa_id, usuario_id) DO NOTHING
      $f$,
      r.sch,
      r.sch
    );

  END LOOP;
END;
$$;
