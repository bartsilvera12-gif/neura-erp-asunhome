-- Base para frontend de administración de flujos conversacionales

CREATE TABLE IF NOT EXISTS public.chat_flows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  flow_code   text NOT NULL,
  label       text,
  channel     text NOT NULL DEFAULT 'whatsapp',
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, flow_code)
);

CREATE INDEX IF NOT EXISTS idx_chat_flows_empresa
  ON public.chat_flows(empresa_id);

DROP TRIGGER IF EXISTS tr_chat_flows_updated ON public.chat_flows;
CREATE TRIGGER tr_chat_flows_updated
  BEFORE UPDATE ON public.chat_flows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.chat_flows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_flows_select" ON public.chat_flows;
DROP POLICY IF EXISTS "chat_flows_insert" ON public.chat_flows;
DROP POLICY IF EXISTS "chat_flows_update" ON public.chat_flows;
DROP POLICY IF EXISTS "chat_flows_delete" ON public.chat_flows;

CREATE POLICY "chat_flows_select" ON public.chat_flows FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flows_insert" ON public.chat_flows FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flows_update" ON public.chat_flows FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "chat_flows_delete" ON public.chat_flows FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- Preparación para integración CRM (aún sin ejecución funcional)
ALTER TABLE public.chat_flow_nodes
  ADD COLUMN IF NOT EXISTS crm_action_type text,
  ADD COLUMN IF NOT EXISTS crm_action_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.chat_flow_nodes.crm_action_type IS
  'Preparado para acciones CRM por nodo (ej: create_lead, move_funnel_stage, assign_advisor)';
COMMENT ON COLUMN public.chat_flow_nodes.crm_action_config IS
  'Configuración de acción CRM por nodo';

-- Backfill de flows desde nodos existentes
INSERT INTO public.chat_flows (empresa_id, flow_code, label, channel, activo)
SELECT
  n.empresa_id,
  n.flow_code,
  initcap(replace(n.flow_code, '_', ' ')) AS label,
  'whatsapp',
  true
FROM public.chat_flow_nodes n
GROUP BY n.empresa_id, n.flow_code
ON CONFLICT (empresa_id, flow_code) DO NOTHING;
