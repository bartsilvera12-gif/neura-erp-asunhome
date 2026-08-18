-- =============================================================================
-- Presencia operativa: marcas de tiempo para UI (turno disponible/pausa,
-- heartbeat inbox) + RPC batch para “esperando respuesta humana” en listados.
-- Aplica en todos los esquemas que tengan chat_agents (plantilla y tenants).
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_agents'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.chat_agents
         ADD COLUMN IF NOT EXISTS operational_status_changed_at timestamptz NOT NULL DEFAULT now(),
         ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz',
      r.sch
    );
    EXECUTE format(
      'COMMENT ON COLUMN %I.chat_agents.operational_status_changed_at IS %L',
      r.sch,
      'Momento del último cambio de operational_status (ready/offline) en esta fila.'
    );
    EXECUTE format(
      'COMMENT ON COLUMN %I.chat_agents.last_heartbeat_at IS %L',
      r.sch,
      'Último ping desde el inbox del agente (sesión activa en conversaciones).'
    );
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- RPC: por lote de conversaciones, último mensaje del contacto sin respuesta
-- humana (sender_type human) posterior.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.neura_inbox_awaiting_reply_since_batch(
  p_schema text,
  p_empresa_id uuid,
  p_conversation_ids uuid[]
)
RETURNS TABLE(conversation_id uuid, awaiting_since timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  sch text := trim(both from coalesce(p_schema, ''));
BEGIN
  IF sch IS NULL OR sch = '' OR sch !~ '^(zentra_erp|public|er_[0-9a-f]{32}|erp_[a-z0-9_]+)$' THEN
    RAISE EXCEPTION 'schema no permitido: %', p_schema;
  END IF;

  RETURN QUERY EXECUTE format(
    $q$
    WITH conv AS (SELECT unnest($1::uuid[]) AS id),
    last_contact AS (
      SELECT DISTINCT ON (m.conversation_id)
        m.conversation_id,
        m.created_at AS at
      FROM %I.chat_messages m
      INNER JOIN conv c ON c.id = m.conversation_id
      WHERE m.empresa_id = $2::uuid
        AND m.from_me = false
        AND lower(coalesce(m.sender_type, 'contact')) IN ('contact')
      ORDER BY m.conversation_id, m.created_at DESC
    ),
    last_human AS (
      SELECT m.conversation_id, max(m.created_at) AS at
      FROM %I.chat_messages m
      INNER JOIN conv c ON c.id = m.conversation_id
      WHERE m.empresa_id = $2::uuid
        AND m.from_me = true
        AND lower(coalesce(m.sender_type, '')) = 'human'
      GROUP BY m.conversation_id
    )
    SELECT lc.conversation_id,
      CASE
        WHEN lc.at > coalesce(lh.at, '-infinity'::timestamptz) THEN lc.at
        ELSE NULL::timestamptz
      END AS awaiting_since
    FROM last_contact lc
    LEFT JOIN last_human lh ON lh.conversation_id = lc.conversation_id
    $q$,
    sch
  )
  USING p_conversation_ids, p_empresa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.neura_inbox_awaiting_reply_since_batch(text, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.neura_inbox_awaiting_reply_since_batch(text, uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.neura_inbox_awaiting_reply_since_batch(text, uuid, uuid[]) IS
  'Inbox: por conversación, timestamp del último mensaje del contacto si aún no hubo respuesta humana posterior.';
