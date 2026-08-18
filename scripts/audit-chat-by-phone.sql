-- =============================================================================
-- Auditoría: conversación + sesiones de flujo + datos + eventos + sorteo_entradas
-- por número de teléfono (solo dígitos, igual que normalizeWaPhone sin +).
-- Editar el literal en `phone_digits` (y opcional empresa_id) en el CTE params.
-- Ejecutar cada sección en el SQL Editor de Supabase o el bloque completo si el
-- cliente permite varias sentencias.
-- =============================================================================

WITH params AS (
  SELECT
    '595981234567'::text AS phone_digits, -- <-- EDITAR (solo dígitos)
    NULL::uuid AS empresa_id -- <-- opcional: uuid de empresa
),
resolved_contact AS (
  SELECT
    cc.id AS contact_id,
    cc.empresa_id,
    cc.phone_number,
    cc.name AS contact_name
  FROM public.chat_contacts cc
  CROSS JOIN params p
  WHERE regexp_replace(coalesce(cc.phone_number, ''), '\D', '', 'g') = p.phone_digits
    AND (p.empresa_id IS NULL OR cc.empresa_id = p.empresa_id)
  LIMIT 1
),
conv AS (
  SELECT c.*
  FROM public.chat_conversations c
  INNER JOIN resolved_contact rc
    ON rc.contact_id = c.contact_id AND rc.empresa_id = c.empresa_id
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1
)
-- Sección A: contacto + conversión elegida (más reciente por updated_at)
SELECT
  'A_contacto_y_conversacion'::text AS seccion,
  p.phone_digits AS matched_phone_digits,
  rc.contact_id,
  rc.empresa_id,
  rc.phone_number AS contact_phone_raw,
  rc.contact_name,
  c.id AS conversation_id,
  c.active_flow_session_id,
  c.flow_code,
  c.flow_current_node,
  c.flow_status,
  c.human_taken_over,
  c.status AS inbox_status,
  c.last_message_at,
  c.updated_at
FROM params p
CROSS JOIN resolved_contact rc
LEFT JOIN conv c ON true;

-- Sección B: todas las sesiones de flujo de esa conversación
WITH params AS (
  SELECT '595981234567'::text AS phone_digits, NULL::uuid AS empresa_id
),
resolved_contact AS (
  SELECT cc.id AS contact_id, cc.empresa_id
  FROM public.chat_contacts cc
  CROSS JOIN params p
  WHERE regexp_replace(coalesce(cc.phone_number, ''), '\D', '', 'g') = p.phone_digits
    AND (p.empresa_id IS NULL OR cc.empresa_id = p.empresa_id)
  LIMIT 1
),
conv AS (
  SELECT c.id AS conversation_id
  FROM public.chat_conversations c
  INNER JOIN resolved_contact rc
    ON rc.contact_id = c.contact_id AND rc.empresa_id = c.empresa_id
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1
)
SELECT
  'B_chat_flow_sessions'::text AS seccion,
  s.id AS flow_session_id,
  s.flow_code,
  s.status,
  s.started_at,
  s.ended_at,
  s.end_reason
FROM public.chat_flow_sessions s
WHERE s.conversation_id = (SELECT conversation_id FROM conv)
ORDER BY s.started_at ASC NULLS FIRST, s.created_at ASC NULLS FIRST;

-- Sección C: chat_flow_data agrupado por flow_session_id (JSON por sesión)
WITH params AS (
  SELECT '595981234567'::text AS phone_digits, NULL::uuid AS empresa_id
),
resolved_contact AS (
  SELECT cc.id AS contact_id, cc.empresa_id
  FROM public.chat_contacts cc
  CROSS JOIN params p
  WHERE regexp_replace(coalesce(cc.phone_number, ''), '\D', '', 'g') = p.phone_digits
    AND (p.empresa_id IS NULL OR cc.empresa_id = p.empresa_id)
  LIMIT 1
),
conv AS (
  SELECT c.id AS conversation_id
  FROM public.chat_conversations c
  INNER JOIN resolved_contact rc
    ON rc.contact_id = c.contact_id AND rc.empresa_id = c.empresa_id
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1
)
SELECT
  'C_chat_flow_data_by_session'::text AS seccion,
  d.flow_session_id,
  count(*)::int AS row_count,
  jsonb_object_agg(d.field_name, d.field_value ORDER BY d.field_name) AS data_by_field
FROM public.chat_flow_data d
WHERE d.conversation_id = (SELECT conversation_id FROM conv)
GROUP BY d.flow_session_id
ORDER BY d.flow_session_id;

-- Sección D: chat_flow_events agrupado por flow_session_id (conteos por tipo)
WITH params AS (
  SELECT '595981234567'::text AS phone_digits, NULL::uuid AS empresa_id
),
resolved_contact AS (
  SELECT cc.id AS contact_id, cc.empresa_id
  FROM public.chat_contacts cc
  CROSS JOIN params p
  WHERE regexp_replace(coalesce(cc.phone_number, ''), '\D', '', 'g') = p.phone_digits
    AND (p.empresa_id IS NULL OR cc.empresa_id = p.empresa_id)
  LIMIT 1
),
conv AS (
  SELECT c.id AS conversation_id
  FROM public.chat_conversations c
  INNER JOIN resolved_contact rc
    ON rc.contact_id = c.contact_id AND rc.empresa_id = c.empresa_id
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1
)
SELECT
  'D_chat_flow_events_by_session'::text AS seccion,
  e.flow_session_id,
  e.event_type,
  count(*)::int AS event_count,
  min(e.created_at) AS first_at,
  max(e.created_at) AS last_at
FROM public.chat_flow_events e
WHERE e.conversation_id = (SELECT conversation_id FROM conv)
GROUP BY e.flow_session_id, e.event_type
ORDER BY e.flow_session_id, e.event_type;

-- Sección E: sorteo_entradas para esa conversación (no filtra por flow_session_id)
WITH params AS (
  SELECT '595981234567'::text AS phone_digits, NULL::uuid AS empresa_id
),
resolved_contact AS (
  SELECT cc.id AS contact_id, cc.empresa_id
  FROM public.chat_contacts cc
  CROSS JOIN params p
  WHERE regexp_replace(coalesce(cc.phone_number, ''), '\D', '', 'g') = p.phone_digits
    AND (p.empresa_id IS NULL OR cc.empresa_id = p.empresa_id)
  LIMIT 1
),
conv AS (
  SELECT c.id AS conversation_id
  FROM public.chat_conversations c
  INNER JOIN resolved_contact rc
    ON rc.contact_id = c.contact_id AND rc.empresa_id = c.empresa_id
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1
)
SELECT
  'E_sorteo_entradas'::text AS seccion,
  se.id AS entrada_id,
  se.sorteo_id,
  se.chat_conversation_id,
  se.flow_code,
  se.numero_orden,
  se.estado_pago,
  se.idempotency_key,
  se.cantidad_boletos,
  se.created_at
FROM public.sorteo_entradas se
WHERE se.chat_conversation_id = (SELECT conversation_id FROM conv)
ORDER BY se.created_at ASC;
