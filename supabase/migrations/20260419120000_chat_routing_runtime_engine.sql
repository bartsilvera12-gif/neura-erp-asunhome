-- Motor operativo de routing: SLA primera respuesta, preferencia de asesor, auditoría y estado circular.
-- Aplica en todos los esquemas que tengan chat_queues (public, zentra_erp, er_*, erp_*).

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
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
    EXECUTE format(
      'ALTER TABLE %I.chat_queues ADD COLUMN IF NOT EXISTS assignment_state jsonb NOT NULL DEFAULT ''{}''::jsonb',
      sch
    );

    IF EXISTS (
      SELECT 1 FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE n2.nspname = sch AND c2.relname = 'chat_contacts' AND c2.relkind = 'r'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.chat_contacts ADD COLUMN IF NOT EXISTS last_routed_chat_agent_id uuid',
        sch
      );
      EXECUTE format(
        'ALTER TABLE %I.chat_contacts ADD COLUMN IF NOT EXISTS last_routed_at timestamptz',
        sch
      );
      EXECUTE format(
        'ALTER TABLE %I.chat_contacts ADD COLUMN IF NOT EXISTS last_routed_channel_id uuid',
        sch
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_class c3
      JOIN pg_namespace n3 ON n3.oid = c3.relnamespace
      WHERE n3.nspname = sch AND c3.relname = 'chat_conversations' AND c3.relkind = 'r'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.chat_conversations ADD COLUMN IF NOT EXISTS initial_assignment_at timestamptz',
        sch
      );
      EXECUTE format(
        'ALTER TABLE %I.chat_conversations ADD COLUMN IF NOT EXISTS first_human_response_at timestamptz',
        sch
      );
      EXECUTE format(
        'ALTER TABLE %I.chat_conversations ADD COLUMN IF NOT EXISTS initial_reassign_count integer NOT NULL DEFAULT 0',
        sch
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_class c4
      JOIN pg_namespace n4 ON n4.oid = c4.relnamespace
      WHERE n4.nspname = sch AND c4.relname = 'chat_conversations' AND c4.relkind = 'r'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_class c5
      JOIN pg_namespace n5 ON n5.oid = c5.relnamespace
      WHERE n5.nspname = sch AND c5.relname = 'chat_routing_events' AND c5.relkind = 'r'
    ) THEN
      EXECUTE format(
        $f$
        CREATE TABLE %I.chat_routing_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id uuid NOT NULL,
          conversation_id uuid NOT NULL REFERENCES %I.chat_conversations(id) ON DELETE CASCADE,
          queue_id uuid REFERENCES %I.chat_queues(id) ON DELETE SET NULL,
          event_type text NOT NULL,
          payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        $f$,
        sch,
        sch,
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_cre_conv ON %I.chat_routing_events(conversation_id, created_at DESC)',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_cre_emp ON %I.chat_routing_events(empresa_id, created_at DESC)',
        sch
      );
      EXECUTE format('COMMENT ON TABLE %I.chat_routing_events IS %L', sch,
        'Auditoría de enrutamiento: asignación, reasignación, cola y estrategia');

      EXECUTE format('ALTER TABLE %I.chat_routing_events ENABLE ROW LEVEL SECURITY', sch);

      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_routing_events_select ON %I.chat_routing_events;
        CREATE POLICY chat_routing_events_select ON %I.chat_routing_events FOR SELECT
          USING (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );
      EXECUTE format(
        $f$
        DROP POLICY IF EXISTS chat_routing_events_insert ON %I.chat_routing_events;
        CREATE POLICY chat_routing_events_insert ON %I.chat_routing_events FOR INSERT
          WITH CHECK (public.puede_acceder_empresa(empresa_id))
        $f$,
        sch,
        sch
      );

      EXECUTE format(
        'GRANT SELECT, INSERT ON TABLE %I.chat_routing_events TO postgres, anon, authenticated, service_role',
        sch
      );
    END IF;
  END LOOP;
END;
$$;
