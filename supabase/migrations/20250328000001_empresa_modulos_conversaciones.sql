-- =============================================================================
-- Conversaciones WhatsApp: activar módulo para todas las empresas + nuevas
-- =============================================================================

-- 1) Todas las empresas existentes: habilitar "conversaciones" sin duplicar
INSERT INTO public.empresa_modulos (empresa_id, modulo_id, activo)
SELECT e.id, m.id, true
FROM public.empresas e
CROSS JOIN public.modulos m
WHERE m.slug = 'conversaciones'
  AND NOT EXISTS (
    SELECT 1
    FROM public.empresa_modulos em
    WHERE em.empresa_id = e.id
      AND em.modulo_id = m.id
  );

-- 2) Cada nueva empresa: insertar fila en empresa_modulos automáticamente
CREATE OR REPLACE FUNCTION public.empresa_modulos_insertar_conversaciones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.empresa_modulos (empresa_id, modulo_id, activo)
  SELECT NEW.id, m.id, true
  FROM public.modulos m
  WHERE m.slug = 'conversaciones'
    AND NOT EXISTS (
      SELECT 1
      FROM public.empresa_modulos em
      WHERE em.empresa_id = NEW.id
        AND em.modulo_id = m.id
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_empresas_modulo_conversaciones ON public.empresas;
CREATE TRIGGER tr_empresas_modulo_conversaciones
  AFTER INSERT ON public.empresas
  FOR EACH ROW
  EXECUTE FUNCTION public.empresa_modulos_insertar_conversaciones();

COMMENT ON FUNCTION public.empresa_modulos_insertar_conversaciones() IS
  'Activa el módulo conversaciones (WhatsApp) para cada empresa nueva';
