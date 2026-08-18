-- =============================================================================
-- Estados / subestados de cierre por cola + registro de finalización de chats
-- Esquemas: public, zentra_erp, tenant er_* / erp_*
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

    EXECUTE format(
      $f$
      CREATE TABLE IF NOT EXISTS %I.chat_queue_closure_states (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        queue_id uuid NOT NULL REFERENCES %I.chat_queues(id) ON DELETE CASCADE,
        label text NOT NULL,
        sort_order integer NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
      $f$,
      r.sch,
      r.sch
    );

    EXECUTE format(
      $f$
      CREATE TABLE IF NOT EXISTS %I.chat_queue_closure_substates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        closure_state_id uuid NOT NULL REFERENCES %I.chat_queue_closure_states(id) ON DELETE CASCADE,
        label text NOT NULL,
        sort_order integer NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
      $f$,
      r.sch,
      r.sch
    );

    EXECUTE format(
      $f$
      CREATE TABLE IF NOT EXISTS %I.chat_conversation_closures (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        conversation_id uuid NOT NULL REFERENCES %I.chat_conversations(id) ON DELETE CASCADE,
        queue_id uuid REFERENCES %I.chat_queues(id) ON DELETE SET NULL,
        closure_state_id uuid REFERENCES %I.chat_queue_closure_states(id) ON DELETE SET NULL,
        closure_substate_id uuid REFERENCES %I.chat_queue_closure_substates(id) ON DELETE SET NULL,
        closure_state_label text NOT NULL,
        closure_substate_label text NOT NULL,
        comment text NOT NULL,
        closed_at timestamptz NOT NULL DEFAULT now(),
        closed_by_usuario_id uuid NOT NULL
      )
      $f$,
      r.sch,
      r.sch,
      r.sch,
      r.sch,
      r.sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_closure_states_queue ON %I.chat_queue_closure_states (queue_id, sort_order)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_closure_states_empresa ON %I.chat_queue_closure_states (empresa_id)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_closure_substates_state ON %I.chat_queue_closure_substates (closure_state_id, sort_order)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_conversation_closures_empresa_closed ON %I.chat_conversation_closures (empresa_id, closed_at DESC)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_conversation_closures_conv ON %I.chat_conversation_closures (conversation_id)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_conversation_closures_queue ON %I.chat_conversation_closures (empresa_id, queue_id, closed_at DESC)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_conversation_closures_labels ON %I.chat_conversation_closures (empresa_id, closure_state_label, closure_substate_label)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_conversation_closures_agent ON %I.chat_conversation_closures (empresa_id, closed_by_usuario_id, closed_at DESC)',
      r.sch
    );

    EXECUTE format(
      'ALTER TABLE %I.chat_conversations ADD COLUMN IF NOT EXISTS closed_at timestamptz',
      r.sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_conversations ADD COLUMN IF NOT EXISTS closed_by_usuario_id uuid',
      r.sch
    );

    EXECUTE format('ALTER TABLE %I.chat_queue_closure_states ENABLE ROW LEVEL SECURITY', r.sch);
    EXECUTE format('ALTER TABLE %I.chat_queue_closure_substates ENABLE ROW LEVEL SECURITY', r.sch);
    EXECUTE format('ALTER TABLE %I.chat_conversation_closures ENABLE ROW LEVEL SECURITY', r.sch);

    EXECUTE format('DROP POLICY IF EXISTS chat_queue_closure_states_select ON %I.chat_queue_closure_states', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_queue_closure_states_insert ON %I.chat_queue_closure_states', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_queue_closure_states_update ON %I.chat_queue_closure_states', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_queue_closure_states_delete ON %I.chat_queue_closure_states', r.sch);
    EXECUTE format(
      'CREATE POLICY chat_queue_closure_states_select ON %I.chat_queue_closure_states FOR SELECT USING (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_queue_closure_states_insert ON %I.chat_queue_closure_states FOR INSERT WITH CHECK (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_queue_closure_states_update ON %I.chat_queue_closure_states FOR UPDATE USING (%s) WITH CHECK (%s)',
      r.sch,
      pol,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_queue_closure_states_delete ON %I.chat_queue_closure_states FOR DELETE USING (%s)',
      r.sch,
      pol
    );

    EXECUTE format('DROP POLICY IF EXISTS chat_queue_closure_substates_select ON %I.chat_queue_closure_substates', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_queue_closure_substates_insert ON %I.chat_queue_closure_substates', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_queue_closure_substates_update ON %I.chat_queue_closure_substates', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_queue_closure_substates_delete ON %I.chat_queue_closure_substates', r.sch);
    EXECUTE format(
      'CREATE POLICY chat_queue_closure_substates_select ON %I.chat_queue_closure_substates FOR SELECT USING (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_queue_closure_substates_insert ON %I.chat_queue_closure_substates FOR INSERT WITH CHECK (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_queue_closure_substates_update ON %I.chat_queue_closure_substates FOR UPDATE USING (%s) WITH CHECK (%s)',
      r.sch,
      pol,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_queue_closure_substates_delete ON %I.chat_queue_closure_substates FOR DELETE USING (%s)',
      r.sch,
      pol
    );

    EXECUTE format('DROP POLICY IF EXISTS chat_conversation_closures_select ON %I.chat_conversation_closures', r.sch);
    EXECUTE format('DROP POLICY IF EXISTS chat_conversation_closures_insert ON %I.chat_conversation_closures', r.sch);
    EXECUTE format(
      'CREATE POLICY chat_conversation_closures_select ON %I.chat_conversation_closures FOR SELECT USING (%s)',
      r.sch,
      pol
    );
    EXECUTE format(
      'CREATE POLICY chat_conversation_closures_insert ON %I.chat_conversation_closures FOR INSERT WITH CHECK (%s)',
      r.sch,
      pol
    );
  END LOOP;
END;
$$;

COMMENT ON TABLE zentra_erp.chat_queue_closure_states IS 'Estados de cierre configurables por cola (modal Finalizar).';
COMMENT ON TABLE zentra_erp.chat_queue_closure_substates IS 'Subestados por estado de cierre.';
COMMENT ON TABLE zentra_erp.chat_conversation_closures IS 'Registro auditable al finalizar conversación (estado, subestado, comentario, agente, cola).';
