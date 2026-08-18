-- Extiende neura_inbox_awaiting_reply_since_batch: además de awaiting_since (contacto esperando humano),
-- devuelve client_turn_since cuando el último mensaje del hilo es saliente (empresa) y no aplica awaiting_since.

DROP FUNCTION IF EXISTS public.neura_inbox_awaiting_reply_since_batch(text, uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.neura_inbox_awaiting_reply_since_batch(
  p_schema text,
  p_empresa_id uuid,
  p_conversation_ids uuid[]
)
RETURNS TABLE(conversation_id uuid, awaiting_since timestamptz, client_turn_since timestamptz)
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
    ),
    last_global AS (
      SELECT DISTINCT ON (m.conversation_id)
        m.conversation_id,
        m.from_me,
        m.created_at AS at
      FROM %I.chat_messages m
      INNER JOIN conv c ON c.id = m.conversation_id
      WHERE m.empresa_id = $2::uuid
      ORDER BY m.conversation_id, m.created_at DESC
    )
    SELECT
      conv.id AS conversation_id,
      CASE
        WHEN lc.at IS NOT NULL AND lc.at > coalesce(lh.at, '-infinity'::timestamptz) THEN lc.at
        ELSE NULL::timestamptz
      END AS awaiting_since,
      CASE
        WHEN lc.at IS NOT NULL AND lc.at > coalesce(lh.at, '-infinity'::timestamptz) THEN NULL::timestamptz
        WHEN lg.from_me IS TRUE THEN lg.at
        ELSE NULL::timestamptz
      END AS client_turn_since
    FROM conv
    LEFT JOIN last_contact lc ON lc.conversation_id = conv.id
    LEFT JOIN last_human lh ON lh.conversation_id = conv.id
    LEFT JOIN last_global lg ON lg.conversation_id = conv.id
    $q$,
    sch
  )
  USING p_conversation_ids, p_empresa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.neura_inbox_awaiting_reply_since_batch(text, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.neura_inbox_awaiting_reply_since_batch(text, uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.neura_inbox_awaiting_reply_since_batch(text, uuid, uuid[]) IS
  'Inbox: awaiting_since = contacto esperando respuesta humana; client_turn_since = último mensaje saliente, turno del contacto.';
