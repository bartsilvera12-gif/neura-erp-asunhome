-- =============================================================================
-- Suscripciones, factura_items y pagos - Facturación recurrente integrada
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SUSCRIPCIONES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suscripciones (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cliente_id              uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  plan_id                 uuid REFERENCES public.planes(id) ON DELETE SET NULL,
  precio                  numeric NOT NULL DEFAULT 0,
  moneda                  text NOT NULL DEFAULT 'GS' CHECK (moneda IN ('GS', 'USD')),
  fecha_inicio            date NOT NULL,
  duracion_meses          integer NOT NULL DEFAULT 12,
  dia_facturacion         integer NOT NULL DEFAULT 1 CHECK (dia_facturacion >= 1 AND dia_facturacion <= 28),
  dia_vencimiento         integer NOT NULL DEFAULT 10 CHECK (dia_vencimiento >= 1 AND dia_vencimiento <= 31),
  estado                  text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'pausada', 'cancelada')),
  generar_factura_este_mes boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_suscripciones_empresa ON public.suscripciones(empresa_id);
CREATE INDEX idx_suscripciones_cliente ON public.suscripciones(cliente_id);
CREATE INDEX idx_suscripciones_plan ON public.suscripciones(plan_id);

ALTER TABLE public.suscripciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suscripciones_select" ON public.suscripciones FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "suscripciones_insert" ON public.suscripciones FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "suscripciones_update" ON public.suscripciones FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "suscripciones_delete" ON public.suscripciones FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 2. Añadir suscripcion_id a facturas (si no existe)
-- -----------------------------------------------------------------------------
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS suscripcion_id uuid REFERENCES public.suscripciones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_facturas_suscripcion ON public.facturas(suscripcion_id);

-- -----------------------------------------------------------------------------
-- 3. FACTURA_ITEMS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.factura_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id      uuid NOT NULL REFERENCES public.facturas(id) ON DELETE CASCADE,
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  descripcion     text NOT NULL,
  cantidad        numeric NOT NULL DEFAULT 1,
  precio_unitario numeric NOT NULL DEFAULT 0,
  subtotal        numeric NOT NULL DEFAULT 0,
  iva             numeric NOT NULL DEFAULT 0,
  total           numeric NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_factura_items_factura ON public.factura_items(factura_id);
CREATE INDEX idx_factura_items_empresa ON public.factura_items(empresa_id);

ALTER TABLE public.factura_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "factura_items_select" ON public.factura_items FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "factura_items_insert" ON public.factura_items FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "factura_items_update" ON public.factura_items FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "factura_items_delete" ON public.factura_items FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 4. PAGOS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pagos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  factura_id   uuid NOT NULL REFERENCES public.facturas(id) ON DELETE CASCADE,
  monto        numeric NOT NULL,
  fecha_pago   date NOT NULL,
  metodo_pago  text NOT NULL DEFAULT 'efectivo' CHECK (metodo_pago IN ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro')),
  referencia   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pagos_empresa ON public.pagos(empresa_id);
CREATE INDEX idx_pagos_factura ON public.pagos(factura_id);
CREATE INDEX idx_pagos_fecha ON public.pagos(fecha_pago);

ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pagos_select" ON public.pagos FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "pagos_insert" ON public.pagos FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "pagos_update" ON public.pagos FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "pagos_delete" ON public.pagos FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));
