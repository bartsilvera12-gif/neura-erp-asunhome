-- Comentarios / observaciones internas del prospecto (distinto de crm_notas = timeline).
ALTER TABLE public.crm_prospectos
  ADD COLUMN IF NOT EXISTS observaciones text;

COMMENT ON COLUMN public.crm_prospectos.observaciones IS
  'Notas internas comercial (contexto, objeciones, próximos pasos). Las crm_notas siguen siendo el historial por entrada.';
