-- Cuentas por cobrar + cobros de clientes (solo schema reservacaacupe). Idempotente.
-- Crédito a clientes: la venta a crédito genera una cuenta por cobrar; los cobros la reducen.
-- NO toca stock, ventas, compras, producción, SIFEN ni otros schemas.

-- 1) cuentas_por_cobrar -----------------------------------------------------
CREATE TABLE IF NOT EXISTS reservacaacupe.cuentas_por_cobrar (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  cliente_id         uuid NOT NULL,
  venta_id           uuid NOT NULL,
  numero_venta       text,
  fecha_emision      date NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento  date,
  moneda             text NOT NULL DEFAULT 'PYG',
  total              numeric NOT NULL DEFAULT 0,
  saldo              numeric NOT NULL DEFAULT 0,
  estado             text NOT NULL DEFAULT 'pendiente',
  observaciones      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reservacaacupe.cuentas_por_cobrar
  DROP CONSTRAINT IF EXISTS cuentas_por_cobrar_estado_check;
ALTER TABLE reservacaacupe.cuentas_por_cobrar
  ADD CONSTRAINT cuentas_por_cobrar_estado_check
  CHECK (estado = ANY (ARRAY['pendiente'::text, 'parcial'::text, 'pagado'::text, 'vencido'::text, 'anulado'::text]));

-- Una sola cuenta por cobrar por venta (evita duplicados si la venta se reintenta).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cxc_venta ON reservacaacupe.cuentas_por_cobrar (venta_id);
CREATE INDEX IF NOT EXISTS idx_cxc_empresa_estado ON reservacaacupe.cuentas_por_cobrar (empresa_id, estado);
CREATE INDEX IF NOT EXISTS idx_cxc_cliente ON reservacaacupe.cuentas_por_cobrar (empresa_id, cliente_id);
CREATE INDEX IF NOT EXISTS idx_cxc_vencimiento ON reservacaacupe.cuentas_por_cobrar (empresa_id, fecha_vencimiento);

-- 2) cobros_clientes --------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservacaacupe.cobros_clientes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL,
  cliente_id            uuid NOT NULL,
  cuenta_por_cobrar_id  uuid NOT NULL REFERENCES reservacaacupe.cuentas_por_cobrar(id) ON DELETE CASCADE,
  venta_id              uuid,
  fecha_pago            timestamptz NOT NULL DEFAULT now(),
  monto                 numeric NOT NULL DEFAULT 0,
  metodo_pago           text NOT NULL DEFAULT 'efectivo',
  entidad_bancaria_id   uuid,
  referencia            text,
  titular               text,
  observaciones         text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cobros_empresa_fecha ON reservacaacupe.cobros_clientes (empresa_id, fecha_pago DESC);
CREATE INDEX IF NOT EXISTS idx_cobros_cuenta ON reservacaacupe.cobros_clientes (cuenta_por_cobrar_id);
CREATE INDEX IF NOT EXISTS idx_cobros_cliente ON reservacaacupe.cobros_clientes (empresa_id, cliente_id);

-- 3) Backfill: ventas a CRÉDITO existentes con cliente y sin CxC todavía. -----
-- saldo = total (sin cobros previos registrados en este modelo), estado pendiente.
INSERT INTO reservacaacupe.cuentas_por_cobrar
  (empresa_id, cliente_id, venta_id, numero_venta, fecha_emision, fecha_vencimiento, moneda, total, saldo, estado)
SELECT
  v.empresa_id, v.cliente_id, v.id, v.numero_control,
  (v.fecha)::date,
  CASE WHEN v.plazo_dias IS NOT NULL AND v.plazo_dias > 0 THEN (v.fecha)::date + (v.plazo_dias || ' days')::interval ELSE NULL END,
  CASE WHEN v.moneda = 'USD' THEN 'USD' ELSE 'PYG' END,
  v.total, v.total, 'pendiente'
FROM reservacaacupe.ventas v
WHERE v.tipo_venta = 'CREDITO'
  AND v.cliente_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM reservacaacupe.cuentas_por_cobrar c WHERE c.venta_id = v.id);

-- 4) Módulo "Cobros" en catálogo + grant a empresas con módulos activos -------
INSERT INTO reservacaacupe.modulos (nombre, descripcion, slug)
SELECT 'Cobros', 'Cuentas por cobrar y cobros de clientes', 'cobros'
WHERE NOT EXISTS (SELECT 1 FROM reservacaacupe.modulos WHERE slug = 'cobros');

INSERT INTO reservacaacupe.empresa_modulos (empresa_id, modulo_id, activo)
SELECT DISTINCT em.empresa_id, m.id, true
FROM reservacaacupe.empresa_modulos em
CROSS JOIN reservacaacupe.modulos m
WHERE m.slug = 'cobros'
  AND em.activo = true
  AND NOT EXISTS (
    SELECT 1 FROM reservacaacupe.empresa_modulos e2
    WHERE e2.empresa_id = em.empresa_id AND e2.modulo_id = m.id
  );
