-- =============================================================================
-- Desactivar módulo `pagos` para En lo de Mari.
-- Solo schema enlodemari. Solo empresa Mari. Idempotente.
-- NO toca otros schemas. NO toca otras empresas. NO borra datos.
-- =============================================================================

DO $$
DECLARE
  v_empresa uuid := '3983553a-de4b-4edf-bc6f-3f86025a97dc';
  v_modulo_pagos_id uuid;
BEGIN
  SELECT id INTO v_modulo_pagos_id FROM enlodemari.modulos WHERE slug = 'pagos';

  IF v_modulo_pagos_id IS NULL THEN
    RAISE NOTICE 'Slug "pagos" no existe en enlodemari.modulos — nada para desactivar.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM enlodemari.empresa_modulos
    WHERE empresa_id = v_empresa AND modulo_id = v_modulo_pagos_id
  ) THEN
    UPDATE enlodemari.empresa_modulos SET activo = false
    WHERE empresa_id = v_empresa AND modulo_id = v_modulo_pagos_id;
  ELSE
    INSERT INTO enlodemari.empresa_modulos (empresa_id, modulo_id, activo)
    VALUES (v_empresa, v_modulo_pagos_id, false);
  END IF;
END $$;
