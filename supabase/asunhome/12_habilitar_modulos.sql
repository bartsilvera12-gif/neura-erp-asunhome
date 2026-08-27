-- 12_habilitar_modulos.sql — Habilita módulos que estaban inactivos para ASUNHOME.
--
-- Síntoma: "Módulo no habilitado para esta empresa" al entrar a Comisiones.
-- Causa: el módulo no está activo en asunhome.empresa_modulos (el rol admin ve
-- solo los módulos activos de la empresa; super_admin sí ve todo).
--
-- Habilita: comisiones (reporte de ventas por vendedor) y pagos (Cuentas por pagar).
-- Idempotente.

DO $$
DECLARE
  v_empresa uuid := 'a5817a20-9fef-47c4-b44a-62aa5783d473';
  v_mod uuid;
  v_slug text;
BEGIN
  FOREACH v_slug IN ARRAY ARRAY['comisiones', 'pagos', 'reportes'] LOOP
    SELECT m.id INTO v_mod FROM asunhome.modulos m WHERE m.slug = v_slug LIMIT 1;
    IF v_mod IS NULL THEN
      RAISE NOTICE 'No existe el módulo con slug %, se omite.', v_slug;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM asunhome.empresa_modulos WHERE empresa_id = v_empresa AND modulo_id = v_mod) THEN
      UPDATE asunhome.empresa_modulos SET activo = true WHERE empresa_id = v_empresa AND modulo_id = v_mod;
    ELSE
      INSERT INTO asunhome.empresa_modulos (empresa_id, modulo_id, activo) VALUES (v_empresa, v_mod, true);
    END IF;
  END LOOP;
END $$;

-- Verificación: módulos activos de la empresa (deben figurar comisiones y pagos).
SELECT m.slug, em.activo
FROM asunhome.empresa_modulos em
JOIN asunhome.modulos m ON m.id = em.modulo_id
WHERE em.empresa_id = 'a5817a20-9fef-47c4-b44a-62aa5783d473'
  AND m.slug IN ('comisiones', 'pagos', 'reportes')
ORDER BY m.slug;
