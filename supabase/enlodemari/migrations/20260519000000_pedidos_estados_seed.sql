-- =============================================================================
-- Pedidos (Fase 1) — Solo schema enlodemari, solo empresa En lo de Mari.
-- Activa el módulo `proyectos` (que se renombra UI como "Pedidos") + siembra
-- el tipo "Pedido" + 6 estados de cocina. Idempotente.
-- NO toca otros schemas. NO toca otras empresas. NO borra datos.
-- =============================================================================

DO $$
DECLARE
  v_empresa uuid := '3983553a-de4b-4edf-bc6f-3f86025a97dc'; -- En lo de Mari
  v_modulo_proyectos_id uuid;
BEGIN
  -- 1) Activar módulo "proyectos" en empresa_modulos para Mari (renombrado a "Pedidos" en UI).
  SELECT id INTO v_modulo_proyectos_id FROM enlodemari.modulos WHERE slug = 'proyectos';
  IF v_modulo_proyectos_id IS NULL THEN
    RAISE EXCEPTION 'Slug proyectos no existe en enlodemari.modulos';
  END IF;

  IF EXISTS (
    SELECT 1 FROM enlodemari.empresa_modulos
    WHERE empresa_id = v_empresa AND modulo_id = v_modulo_proyectos_id
  ) THEN
    UPDATE enlodemari.empresa_modulos SET activo = true
    WHERE empresa_id = v_empresa AND modulo_id = v_modulo_proyectos_id;
  ELSE
    INSERT INTO enlodemari.empresa_modulos (empresa_id, modulo_id, activo)
    VALUES (v_empresa, v_modulo_proyectos_id, true);
  END IF;

  -- 2) Desactivar estados viejos para Mari (preservar historial, no borrar).
  --    Si existían estados con códigos distintos a los 6 de cocina, quedan inactivos.
  UPDATE enlodemari.proyecto_estados
  SET activo = false
  WHERE empresa_id = v_empresa
    AND codigo NOT IN ('nuevo','en_preparacion','listo','en_camino','entregado','cancelado');

  -- 3) Tipo "Pedido" (idempotente).
  INSERT INTO enlodemari.proyecto_tipos (empresa_id, nombre, codigo, activo)
  VALUES (v_empresa, 'Pedido', 'pedido', true)
  ON CONFLICT (empresa_id, codigo) DO UPDATE SET nombre = EXCLUDED.nombre, activo = true;

  -- 4) Estados de cocina (idempotente vía UNIQUE empresa_id+codigo).
  INSERT INTO enlodemari.proyecto_estados
    (empresa_id, codigo, nombre, color, sort_order, es_estado_inicial, es_estado_final, tipo_sla, activo)
  VALUES
    (v_empresa, 'nuevo',          'Nuevo',          '#2563eb', 10, true,  false, 'interno', true),
    (v_empresa, 'en_preparacion', 'En preparación', '#f59e0b', 20, false, false, 'interno', true),
    (v_empresa, 'listo',          'Listo',          '#10b981', 30, false, false, 'interno', true),
    (v_empresa, 'en_camino',      'En camino',      '#8b5cf6', 40, false, false, 'interno', true),
    (v_empresa, 'entregado',      'Entregado',      '#16a34a', 50, false, true,  'final',   true),
    (v_empresa, 'cancelado',      'Cancelado',      '#ef4444', 60, false, true,  'final',   true)
  ON CONFLICT (empresa_id, codigo) DO UPDATE
    SET nombre            = EXCLUDED.nombre,
        color             = EXCLUDED.color,
        sort_order        = EXCLUDED.sort_order,
        es_estado_inicial = EXCLUDED.es_estado_inicial,
        es_estado_final   = EXCLUDED.es_estado_final,
        tipo_sla          = EXCLUDED.tipo_sla,
        activo            = true;
END $$;
