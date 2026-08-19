-- Módulo Presupuestos (solo schema reservacaacupe). Idempotente.
-- 1) Tablas presupuestos + presupuesto_items.
-- 2) Registro del módulo en el catálogo y grant a la empresa (sidebar/acceso).
-- NO toca stock, ventas, compras, producción, SIFEN ni otros schemas.

-- 1) presupuestos ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservacaacupe.presupuestos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL,
  cliente_id           uuid,
  cliente_nombre       text NOT NULL,
  cliente_ruc          text,
  cliente_telefono     text,
  cliente_direccion    text,
  numero_control       text NOT NULL,
  estado               text NOT NULL DEFAULT 'creado',
  moneda               text NOT NULL DEFAULT 'PYG',
  subtotal             numeric NOT NULL DEFAULT 0,
  monto_iva            numeric NOT NULL DEFAULT 0,
  descuento_total      numeric NOT NULL DEFAULT 0,
  total                numeric NOT NULL DEFAULT 0,
  validez_dias         int,
  fecha                timestamptz NOT NULL DEFAULT now(),
  fecha_vencimiento    date,
  forma_pago           text,
  plazo_entrega        text,
  observaciones        text,
  convertido_pedido_id uuid,
  convertido_venta_id  uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reservacaacupe.presupuestos
  DROP CONSTRAINT IF EXISTS presupuestos_estado_check;
ALTER TABLE reservacaacupe.presupuestos
  ADD CONSTRAINT presupuestos_estado_check
  CHECK (estado = ANY (ARRAY['creado'::text, 'enviado'::text, 'aprobado'::text, 'rechazado'::text, 'convertido'::text]));

CREATE TABLE IF NOT EXISTS reservacaacupe.presupuesto_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  presupuesto_id  uuid NOT NULL REFERENCES reservacaacupe.presupuestos(id) ON DELETE CASCADE,
  producto_id     uuid,
  producto_nombre text NOT NULL,
  sku             text,
  cantidad        numeric NOT NULL,
  unidad_medida   text,
  precio_unitario numeric NOT NULL DEFAULT 0,
  iva_tipo        text NOT NULL DEFAULT '10%',
  subtotal        numeric NOT NULL DEFAULT 0,
  monto_iva       numeric NOT NULL DEFAULT 0,
  descuento       numeric NOT NULL DEFAULT 0,
  total           numeric NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presupuestos_empresa_fecha ON reservacaacupe.presupuestos (empresa_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_presupuestos_estado ON reservacaacupe.presupuestos (empresa_id, estado);
CREATE INDEX IF NOT EXISTS idx_presupuesto_items_presupuesto ON reservacaacupe.presupuesto_items (presupuesto_id);

-- 2) Módulo en catálogo + grant a TODAS las empresas con módulos activos ----
-- El sidebar usa allowlist estricta (single_client): el módulo debe existir en
-- `modulos` y estar activo en `empresa_modulos` para verse.
INSERT INTO reservacaacupe.modulos (nombre, descripcion, slug)
SELECT 'Presupuestos', 'Presupuestos / cotizaciones comerciales', 'presupuestos'
WHERE NOT EXISTS (SELECT 1 FROM reservacaacupe.modulos WHERE slug = 'presupuestos');

-- Otorgar el módulo a cada empresa que ya tenga al menos un módulo activo
-- (evita activarlo en empresas que deliberadamente no tienen ninguno).
INSERT INTO reservacaacupe.empresa_modulos (empresa_id, modulo_id, activo)
SELECT DISTINCT em.empresa_id, m.id, true
FROM reservacaacupe.empresa_modulos em
CROSS JOIN reservacaacupe.modulos m
WHERE m.slug = 'presupuestos'
  AND em.activo = true
  AND NOT EXISTS (
    SELECT 1 FROM reservacaacupe.empresa_modulos e2
    WHERE e2.empresa_id = em.empresa_id AND e2.modulo_id = m.id
  );
