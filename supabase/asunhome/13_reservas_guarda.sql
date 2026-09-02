-- 13_reservas_guarda.sql — Módulo de Reservas / Mercadería en guarda.
--
-- Flujo: el cliente compra varios productos y los deja en el local con un anticipo.
--  · Al crear la reserva, la mercadería SALE del stock (movimiento SALIDA origen 'reserva')
--    y queda identificada como "en guarda" (no vuelve a descontarse al facturar).
--  · Se registran anticipos/pagos (entran a caja); se ve el saldo pendiente.
--  · Retiros parciales: se marca cantidad_entregada por ítem.
--  · Al facturar (una factura al final), se crea la venta SIN re-descontar stock.
--
-- Idempotente.

-- ── 1) Cabecera de reserva ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asunhome.reservas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  numero_control text,
  cliente_id     uuid,
  cliente_nombre text,
  fecha          timestamptz NOT NULL DEFAULT now(),
  estado         text NOT NULL DEFAULT 'activa'
                   CHECK (estado IN ('activa', 'facturada', 'cancelada')),
  total          numeric(14,2) NOT NULL DEFAULT 0,
  pagado         numeric(14,2) NOT NULL DEFAULT 0,
  saldo          numeric(14,2) NOT NULL DEFAULT 0,
  observaciones  text,
  venta_id       uuid,
  created_by     uuid,
  usuario_nombre text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reservas_uq_numero ON asunhome.reservas (empresa_id, numero_control) WHERE numero_control IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservas_idx_estado   ON asunhome.reservas (empresa_id, estado);
CREATE INDEX IF NOT EXISTS reservas_idx_cliente  ON asunhome.reservas (empresa_id, cliente_id);

-- ── 2) Ítems de la reserva (con cantidad entregada para retiros parciales) ────
CREATE TABLE IF NOT EXISTS asunhome.reserva_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  reserva_id         uuid NOT NULL REFERENCES asunhome.reservas (id) ON DELETE CASCADE,
  producto_id        uuid,
  producto_nombre    text,
  sku                text,
  cantidad           numeric(14,3) NOT NULL DEFAULT 0,
  cantidad_entregada numeric(14,3) NOT NULL DEFAULT 0,
  precio_unitario    numeric(14,2) NOT NULL DEFAULT 0,
  tipo_iva           text,
  subtotal           numeric(14,2) NOT NULL DEFAULT 0,
  monto_iva          numeric(14,2) NOT NULL DEFAULT 0,
  total              numeric(14,2) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reserva_items_idx_reserva  ON asunhome.reserva_items (reserva_id);
CREATE INDEX IF NOT EXISTS reserva_items_idx_producto ON asunhome.reserva_items (empresa_id, producto_id);

-- ── 3) Pagos / anticipos de la reserva (cada uno entra a caja) ────────────────
CREATE TABLE IF NOT EXISTS asunhome.reserva_pagos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  reserva_id          uuid NOT NULL REFERENCES asunhome.reservas (id) ON DELETE CASCADE,
  fecha               date NOT NULL DEFAULT current_date,
  monto               numeric(14,2) NOT NULL,
  metodo_pago         text,
  entidad_bancaria_id uuid,
  referencia          text,
  caja_movimiento_id  uuid,
  observaciones       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reserva_pagos_idx_reserva ON asunhome.reserva_pagos (reserva_id);

-- ── 4) Origen 'reserva' (y su reverso) en movimientos_inventario ──────────────
DO $$
DECLARE
  v_origen text := '''compra'',''venta'',''ajuste_manual'',''inventario_inicial'',''produccion'','
                || '''devolucion_venta'',''transferencia'',''servicio_tecnico'',''averia'','
                || '''devolucion_proveedor'',''reserva'',''anulacion_reserva''';
BEGIN
  EXECUTE 'ALTER TABLE asunhome.movimientos_inventario DROP CONSTRAINT IF EXISTS movimientos_inventario_origen_check';
  EXECUTE 'ALTER TABLE asunhome.movimientos_inventario ADD CONSTRAINT movimientos_inventario_origen_check CHECK (origen IN (' || v_origen || '))';
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'origen_check: %', SQLERRM;
END $$;

-- ── 5) Grants + RLS (mismo criterio que el resto del schema) ──────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON asunhome.reservas, asunhome.reserva_items, asunhome.reserva_pagos TO authenticated;
GRANT ALL ON asunhome.reservas, asunhome.reserva_items, asunhome.reserva_pagos TO postgres, service_role;
ALTER TABLE asunhome.reservas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE asunhome.reserva_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE asunhome.reserva_pagos  ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
  tiene_fn boolean := EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='asunhome' AND p.proname='puede_acceder_empresa');
BEGIN
  FOREACH t IN ARRAY ARRAY['reservas','reserva_items','reserva_pagos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON asunhome.%I', t||'_rls', t);
    IF tiene_fn THEN
      EXECUTE format('CREATE POLICY %I ON asunhome.%I FOR ALL TO authenticated USING (asunhome.puede_acceder_empresa(empresa_id)) WITH CHECK (asunhome.puede_acceder_empresa(empresa_id))', t||'_rls', t);
    ELSE
      EXECUTE format('CREATE POLICY %I ON asunhome.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t||'_rls', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- Verificación:
SELECT
  to_regclass('asunhome.reservas')       IS NOT NULL AS tbl_reservas_ok,
  to_regclass('asunhome.reserva_items')  IS NOT NULL AS tbl_items_ok,
  to_regclass('asunhome.reserva_pagos')  IS NOT NULL AS tbl_pagos_ok,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='asunhome.movimientos_inventario'::regclass
            AND pg_get_constraintdef(oid) ILIKE '%reserva%') AS origen_reserva_ok;
