-- Variables dinámicas por botón/lista en opciones de flujo.
ALTER TABLE public.chat_flow_options
  ADD COLUMN IF NOT EXISTS option_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.chat_flow_options.option_payload IS
  'Payload opcional de variables a guardar en contexto cuando el cliente elige la opción';
