-- =============================================================================
-- Empresas con conversaciones u omnicanal activo reciben también los submódulos
-- del stack dashboard (historial, finalizadas, monitoreo) en empresa_modulos.
--
-- Causa: la UI de asignación de módulos por usuario lista solo lo que está en
-- empresa_modulos; sin estas filas no aparecen checkboxes y no se pueden persistir
-- en usuario_modulos (trigger valida contra empresa_modulos).
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'zentra_erp' AND table_name = 'modulos'
  ) THEN
    INSERT INTO zentra_erp.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Historial omnicanal', 'historial-omnicanal'
    WHERE NOT EXISTS (SELECT 1 FROM zentra_erp.modulos WHERE slug = 'historial-omnicanal');

    INSERT INTO zentra_erp.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Conversaciones finalizadas', 'conversaciones-finalizadas'
    WHERE NOT EXISTS (SELECT 1 FROM zentra_erp.modulos WHERE slug = 'conversaciones-finalizadas');

    INSERT INTO zentra_erp.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Monitoreo', 'monitoreo'
    WHERE NOT EXISTS (SELECT 1 FROM zentra_erp.modulos WHERE slug = 'monitoreo');

    INSERT INTO zentra_erp.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Omnicanal (paquete)', 'omnicanal'
    WHERE NOT EXISTS (SELECT 1 FROM zentra_erp.modulos WHERE slug = 'omnicanal');
  END IF;
END $$;

-- zentra_erp: backfill empresa_modulos
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'zentra_erp' AND table_name = 'empresa_modulos'
  ) THEN
    INSERT INTO zentra_erp.empresa_modulos (empresa_id, modulo_id, activo)
    SELECT DISTINCT em.empresa_id, om.id, TRUE
    FROM zentra_erp.empresa_modulos em
    JOIN zentra_erp.modulos m_src ON m_src.id = em.modulo_id
    JOIN zentra_erp.modulos om ON om.slug IN (
      'historial-omnicanal',
      'conversaciones-finalizadas',
      'monitoreo'
    )
    WHERE em.activo IS TRUE
      AND m_src.slug IN ('conversaciones', 'omnicanal')
      AND NOT EXISTS (
        SELECT 1
        FROM zentra_erp.empresa_modulos z
        WHERE z.empresa_id = em.empresa_id
          AND z.modulo_id = om.id
      );
  END IF;
END $$;

-- public (legado / duplicado): mismo criterio si existen las tablas
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'modulos'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'empresa_modulos'
  ) THEN
    INSERT INTO public.empresa_modulos (empresa_id, modulo_id, activo)
    SELECT DISTINCT em.empresa_id, om.id, TRUE
    FROM public.empresa_modulos em
    JOIN public.modulos m_src ON m_src.id = em.modulo_id
    JOIN public.modulos om ON om.slug IN (
      'historial-omnicanal',
      'conversaciones-finalizadas',
      'monitoreo'
    )
    WHERE em.activo IS TRUE
      AND m_src.slug IN ('conversaciones', 'omnicanal')
      AND NOT EXISTS (
        SELECT 1
        FROM public.empresa_modulos z
        WHERE z.empresa_id = em.empresa_id
          AND z.modulo_id = om.id
      );
  END IF;
END $$;
