-- Permite nodo saliente de imagen/caption en motor de flujos.
ALTER TABLE public.chat_flow_nodes
  DROP CONSTRAINT IF EXISTS chat_flow_nodes_node_type_check;

ALTER TABLE public.chat_flow_nodes
  ADD CONSTRAINT chat_flow_nodes_node_type_check
  CHECK (node_type IN ('buttons', 'list', 'text', 'media', 'image_input', 'human', 'end'));
