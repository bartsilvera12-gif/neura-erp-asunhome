-- Orden estable de nodos para editor de flujos.
ALTER TABLE public.chat_flow_nodes
  ADD COLUMN IF NOT EXISTS sort_order integer;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY empresa_id, flow_code
      ORDER BY created_at ASC, node_code ASC
    ) AS rn
  FROM public.chat_flow_nodes
)
UPDATE public.chat_flow_nodes n
SET sort_order = ranked.rn
FROM ranked
WHERE ranked.id = n.id
  AND n.sort_order IS NULL;

ALTER TABLE public.chat_flow_nodes
  ALTER COLUMN sort_order SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_flow_nodes_empresa_flow_sort
  ON public.chat_flow_nodes(empresa_id, flow_code, sort_order);
