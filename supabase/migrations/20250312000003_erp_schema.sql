-- =============================================================================
-- ERP Schema - Neura
-- Tablas del ERP con empresa_id, RLS y relaciones UUID
-- Requiere: 20250312000000_rls_multiempresa.sql (funciones public.empresa_id_actual, etc.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PRODUCTOS
-- -----------------------------------------------------------------------------
CREATE TABLE public.productos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre            text NOT NULL,
  sku               text NOT NULL,
  costo_promedio    numeric NOT NULL DEFAULT 0,
  precio_venta      numeric NOT NULL DEFAULT 0,
  stock_actual      numeric NOT NULL DEFAULT 0,
  stock_minimo      numeric NOT NULL DEFAULT 0,
  unidad_medida     text NOT NULL DEFAULT 'Unidad',
  metodo_valuacion  text NOT NULL DEFAULT 'CPP' CHECK (metodo_valuacion IN ('CPP', 'FIFO', 'LIFO')),
  activo            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_productos_empresa ON public.productos(empresa_id);
CREATE UNIQUE INDEX idx_productos_empresa_sku ON public.productos(empresa_id, sku);

ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "productos_select" ON public.productos FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "productos_insert" ON public.productos FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "productos_update" ON public.productos FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "productos_delete" ON public.productos FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 2. PROVEEDORES
-- -----------------------------------------------------------------------------
CREATE TABLE public.proveedores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre         text NOT NULL,
  ruc            text,
  telefono       text,
  email          text,
  direccion      text,
  contacto       text,
  estado         text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_proveedores_empresa ON public.proveedores(empresa_id);

ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "proveedores_select" ON public.proveedores FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "proveedores_insert" ON public.proveedores FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "proveedores_update" ON public.proveedores FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "proveedores_delete" ON public.proveedores FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 3. VENTAS (cabecera)
-- -----------------------------------------------------------------------------
CREATE TABLE public.ventas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cliente_id      uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  numero_control  text NOT NULL,
  moneda          text NOT NULL DEFAULT 'GS' CHECK (moneda IN ('GS', 'USD')),
  tipo_cambio     numeric NOT NULL DEFAULT 1,
  subtotal        numeric NOT NULL DEFAULT 0,
  monto_iva       numeric NOT NULL DEFAULT 0,
  total           numeric NOT NULL DEFAULT 0,
  estado          text NOT NULL DEFAULT 'completada' CHECK (estado IN ('pendiente', 'completada', 'anulada')),
  tipo_venta      text NOT NULL DEFAULT 'CONTADO' CHECK (tipo_venta IN ('CONTADO', 'CREDITO')),
  plazo_dias      integer,
  fecha           timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ventas_empresa ON public.ventas(empresa_id);
CREATE INDEX idx_ventas_cliente ON public.ventas(cliente_id);
CREATE INDEX idx_ventas_fecha ON public.ventas(fecha);

ALTER TABLE public.ventas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ventas_select" ON public.ventas FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "ventas_insert" ON public.ventas FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "ventas_update" ON public.ventas FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "ventas_delete" ON public.ventas FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 4. VENTAS_ITEMS (líneas de venta)
-- -----------------------------------------------------------------------------
CREATE TABLE public.ventas_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  venta_id              uuid NOT NULL REFERENCES public.ventas(id) ON DELETE CASCADE,
  producto_id           uuid NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  producto_nombre       text NOT NULL,
  sku                   text NOT NULL,
  cantidad              numeric NOT NULL,
  precio_venta_original  numeric NOT NULL,
  precio_venta          numeric NOT NULL,
  tipo_iva              text NOT NULL DEFAULT '10%' CHECK (tipo_iva IN ('EXENTA', '5%', '10%')),
  subtotal              numeric NOT NULL,
  monto_iva             numeric NOT NULL,
  total_linea           numeric NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ventas_items_empresa ON public.ventas_items(empresa_id);
CREATE INDEX idx_ventas_items_venta ON public.ventas_items(venta_id);
CREATE INDEX idx_ventas_items_producto ON public.ventas_items(producto_id);

ALTER TABLE public.ventas_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ventas_items_select" ON public.ventas_items FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "ventas_items_insert" ON public.ventas_items FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "ventas_items_update" ON public.ventas_items FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "ventas_items_delete" ON public.ventas_items FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 5. MOVIMIENTOS_INVENTARIO
-- -----------------------------------------------------------------------------
CREATE TABLE public.movimientos_inventario (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id     uuid NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  producto_nombre text NOT NULL,
  producto_sku    text NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('ENTRADA', 'SALIDA', 'AJUSTE')),
  cantidad        numeric NOT NULL,
  costo_unitario  numeric NOT NULL DEFAULT 0,
  origen          text NOT NULL CHECK (origen IN ('compra', 'venta', 'ajuste_manual', 'inventario_inicial')),
  referencia      text,
  fecha           timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_movimientos_empresa ON public.movimientos_inventario(empresa_id);
CREATE INDEX idx_movimientos_producto ON public.movimientos_inventario(producto_id);
CREATE INDEX idx_movimientos_fecha ON public.movimientos_inventario(fecha);

ALTER TABLE public.movimientos_inventario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "movimientos_select" ON public.movimientos_inventario FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "movimientos_insert" ON public.movimientos_inventario FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "movimientos_update" ON public.movimientos_inventario FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "movimientos_delete" ON public.movimientos_inventario FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 6. COMPRAS
-- -----------------------------------------------------------------------------
CREATE TABLE public.compras (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  proveedor_id            uuid NOT NULL REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  proveedor_nombre        text NOT NULL,
  producto_id             uuid NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  producto_nombre        text NOT NULL,
  cantidad               numeric NOT NULL,
  moneda                 text NOT NULL DEFAULT 'PYG' CHECK (moneda IN ('PYG', 'USD')),
  tipo_cambio            numeric NOT NULL DEFAULT 1,
  costo_unitario_original numeric NOT NULL,
  costo_unitario         numeric NOT NULL,
  iva_tipo               text NOT NULL DEFAULT '10' CHECK (iva_tipo IN ('exenta', '5', '10')),
  subtotal               numeric NOT NULL,
  monto_iva              numeric NOT NULL,
  total                  numeric NOT NULL,
  precio_venta           numeric NOT NULL,
  margen_venta           numeric,
  tipo_pago              text NOT NULL DEFAULT 'contado' CHECK (tipo_pago IN ('contado', 'credito')),
  plazo_dias             integer,
  nro_timbrado           text NOT NULL,
  numero_control         text NOT NULL,
  estado                 text NOT NULL DEFAULT 'registrada' CHECK (estado IN ('registrada', 'pendiente', 'pagada', 'anulada')),
  fecha                  timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_compras_empresa ON public.compras(empresa_id);
CREATE INDEX idx_compras_proveedor ON public.compras(proveedor_id);
CREATE INDEX idx_compras_producto ON public.compras(producto_id);
CREATE INDEX idx_compras_fecha ON public.compras(fecha);

ALTER TABLE public.compras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compras_select" ON public.compras FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "compras_insert" ON public.compras FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "compras_update" ON public.compras FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "compras_delete" ON public.compras FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 7. CRM_PROSPECTOS
-- -----------------------------------------------------------------------------
CREATE TABLE public.crm_prospectos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  numero_control        text NOT NULL,
  empresa               text NOT NULL,
  contacto              text NOT NULL,
  email                 text,
  telefono              text,
  servicio              text NOT NULL,
  valor_estimado        numeric DEFAULT 0,
  etapa                 text NOT NULL DEFAULT 'LEAD' CHECK (etapa IN ('LEAD', 'CONTACTADO', 'NEGOCIACION', 'GANADO', 'PERDIDO')),
  proxima_accion        text,
  fecha_proxima_accion  date,
  creado_por            text,
  responsable           text,
  cliente_creado        boolean DEFAULT false,
  fecha_creacion        timestamptz NOT NULL DEFAULT now(),
  fecha_actualizacion   timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_prospectos_empresa ON public.crm_prospectos(empresa_id);
CREATE INDEX idx_crm_prospectos_etapa ON public.crm_prospectos(etapa);

ALTER TABLE public.crm_prospectos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_prospectos_select" ON public.crm_prospectos FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "crm_prospectos_insert" ON public.crm_prospectos FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "crm_prospectos_update" ON public.crm_prospectos FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "crm_prospectos_delete" ON public.crm_prospectos FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 8. CRM_NOTAS
-- -----------------------------------------------------------------------------
CREATE TABLE public.crm_notas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  prospecto_id uuid NOT NULL REFERENCES public.crm_prospectos(id) ON DELETE CASCADE,
  texto        text NOT NULL,
  fecha        timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_notas_empresa ON public.crm_notas(empresa_id);
CREATE INDEX idx_crm_notas_prospecto ON public.crm_notas(prospecto_id);

ALTER TABLE public.crm_notas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_notas_select" ON public.crm_notas FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "crm_notas_insert" ON public.crm_notas FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "crm_notas_update" ON public.crm_notas FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "crm_notas_delete" ON public.crm_notas FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 9. FACTURAS
-- -----------------------------------------------------------------------------
CREATE TABLE public.facturas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cliente_id          uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  numero_factura      text NOT NULL,
  fecha               date NOT NULL,
  fecha_vencimiento   date NOT NULL,
  monto               numeric NOT NULL,
  saldo               numeric NOT NULL DEFAULT 0,
  estado              text NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pagado', 'Pendiente', 'Vencido', 'Anulado')),
  tipo                text NOT NULL CHECK (tipo IN ('contado', 'credito', 'suscripcion')),
  moneda              text NOT NULL DEFAULT 'GS' CHECK (moneda IN ('GS', 'USD')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_facturas_empresa ON public.facturas(empresa_id);
CREATE INDEX idx_facturas_cliente ON public.facturas(cliente_id);
CREATE INDEX idx_facturas_fecha ON public.facturas(fecha);

ALTER TABLE public.facturas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "facturas_select" ON public.facturas FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "facturas_insert" ON public.facturas FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "facturas_update" ON public.facturas FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "facturas_delete" ON public.facturas FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 10. TIPIFICACIONES
-- -----------------------------------------------------------------------------
CREATE TABLE public.tipificaciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cliente_id    uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  usuario       text NOT NULL,
  tipo_gestion  text NOT NULL CHECK (tipo_gestion IN (
    'Consulta', 'Reclamo', 'Seguimiento', 'Promesa de pago', 'Soporte técnico', 'Cambio plan'
  )),
  resultado     text NOT NULL CHECK (resultado IN ('Pendiente', 'Resuelto', 'Escalar')),
  observacion   text NOT NULL,
  fecha         timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tipificaciones_empresa ON public.tipificaciones(empresa_id);
CREATE INDEX idx_tipificaciones_cliente ON public.tipificaciones(cliente_id);

ALTER TABLE public.tipificaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tipificaciones_select" ON public.tipificaciones FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "tipificaciones_insert" ON public.tipificaciones FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "tipificaciones_update" ON public.tipificaciones FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "tipificaciones_delete" ON public.tipificaciones FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 11. PLANES
-- -----------------------------------------------------------------------------
CREATE TABLE public.planes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  codigo_plan       text NOT NULL,
  nombre            text NOT NULL,
  descripcion       text,
  precio            numeric NOT NULL,
  moneda            text NOT NULL DEFAULT 'GS' CHECK (moneda IN ('GS', 'USD')),
  periodicidad      text NOT NULL DEFAULT 'mensual' CHECK (periodicidad IN ('mensual', 'anual', 'unico')),
  limite_usuarios   integer,
  limite_clientes   integer,
  limite_facturas   integer,
  estado            text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_planes_empresa ON public.planes(empresa_id);

ALTER TABLE public.planes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planes_select" ON public.planes FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "planes_insert" ON public.planes FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "planes_update" ON public.planes FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "planes_delete" ON public.planes FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- 12. Trigger para updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER productos_updated_at
  BEFORE UPDATE ON public.productos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER proveedores_updated_at
  BEFORE UPDATE ON public.proveedores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER ventas_updated_at
  BEFORE UPDATE ON public.ventas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER ventas_items_updated_at
  BEFORE UPDATE ON public.ventas_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER movimientos_updated_at
  BEFORE UPDATE ON public.movimientos_inventario
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER compras_updated_at
  BEFORE UPDATE ON public.compras
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.set_crm_prospectos_updated()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.fecha_actualizacion = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crm_prospectos_updated_at
  BEFORE UPDATE ON public.crm_prospectos
  FOR EACH ROW EXECUTE FUNCTION public.set_crm_prospectos_updated();

CREATE TRIGGER crm_notas_updated_at
  BEFORE UPDATE ON public.crm_notas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER facturas_updated_at
  BEFORE UPDATE ON public.facturas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER tipificaciones_updated_at
  BEFORE UPDATE ON public.tipificaciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER planes_updated_at
  BEFORE UPDATE ON public.planes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
