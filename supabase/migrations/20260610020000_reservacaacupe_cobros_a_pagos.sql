-- La interfaz de cuentas por cobrar / cobros se integró al módulo existente "Pagos".
-- Se oculta el módulo "Cobros" (desactiva su grant). NO se borran datos ni tablas
-- (cuentas_por_cobrar/cobros_clientes intactas). Idempotente.

-- 1) Asegurar que "Pagos" esté activo para las empresas con módulos activos.
INSERT INTO reservacaacupe.empresa_modulos (empresa_id, modulo_id, activo)
SELECT DISTINCT em.empresa_id, m.id, true
FROM reservacaacupe.empresa_modulos em
CROSS JOIN reservacaacupe.modulos m
WHERE m.slug = 'pagos'
  AND em.activo = true
  AND NOT EXISTS (
    SELECT 1 FROM reservacaacupe.empresa_modulos e2
    WHERE e2.empresa_id = em.empresa_id AND e2.modulo_id = m.id
  );

UPDATE reservacaacupe.empresa_modulos em
SET activo = true
FROM reservacaacupe.modulos m
WHERE em.modulo_id = m.id AND m.slug = 'pagos' AND em.activo = false;

-- 2) Desactivar el grant del módulo "Cobros" (no se borra el catálogo ni datos).
UPDATE reservacaacupe.empresa_modulos em
SET activo = false
FROM reservacaacupe.modulos m
WHERE em.modulo_id = m.id AND m.slug = 'cobros';
