-- Obsoleto respecto al modelo por sesión (ver 20260330180000_chat_flow_sessions.sql):
-- unique(conversation_id, flow_code, field_name) impediría guardar el mismo field_name
-- en dos sesiones del mismo flujo (reinicios). El índice vigente es
-- uq_chat_flow_data_session_field ON (flow_session_id, field_name).

DROP INDEX IF EXISTS public.uq_chat_flow_data_conversation_field;
DROP INDEX IF EXISTS public.uq_chat_flow_data_conversation_flow_field;
