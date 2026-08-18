-- =============================================================================
-- Módulo Sorteos (multiempresa, aislado)
-- Requiere: RLS multiempresa, tabla modulos, empresa_modulos
-- =============================================================================

-- Compatibilidad: la RPC inserta en clientes.nombre (además de nombre_contacto)
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS nombre text;

-- 1) Registro del módulo (activación por empresa vía empresa_modulos en admin)
INSERT INTO public.modulos (id, nombre, slug)
SELECT gen_random_uuid(), 'Sorteos', 'sorteos'
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'sorteos');

-- updated_at: usar public.set_updated_at() ya definida en el esquema ERP

-- -----------------------------------------------------------------------------
-- Tabla: sorteos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sorteos (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre                  text NOT NULL,
  descripcion             text,
  precio_por_boleto       numeric NOT NULL DEFAULT 0,
  max_boletos             integer NOT NULL DEFAULT 100,
  total_boletos_vendidos  integer NOT NULL DEFAULT 0,
  ultimo_numero_cupon     integer NOT NULL DEFAULT 0,
  fecha_sorteo            timestamptz,
  estado                  text NOT NULL DEFAULT 'activo'
    CHECK (estado IN ('activo', 'pausado', 'cerrado', 'finalizado')),
  datos_bancarios         jsonb NOT NULL DEFAULT '{}',
  imagen_url              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sorteos_empresa ON public.sorteos(empresa_id);

DROP TRIGGER IF EXISTS tr_sorteos_updated ON public.sorteos;
CREATE TRIGGER tr_sorteos_updated
  BEFORE UPDATE ON public.sorteos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sorteos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sorteos_select" ON public.sorteos FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteos_insert" ON public.sorteos FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteos_update" ON public.sorteos FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteos_delete" ON public.sorteos FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- Tabla: sorteo_conversaciones
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sorteo_conversaciones (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  sorteo_id             uuid NOT NULL REFERENCES public.sorteos(id) ON DELETE CASCADE,
  whatsapp_numero       text NOT NULL,
  cliente_id            uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  estado                text NOT NULL DEFAULT 'new_lead'
    CHECK (estado IN (
      'new_lead',
      'awaiting_ticket_selection',
      'awaiting_customer_data',
      'awaiting_payment',
      'awaiting_receipt',
      'receipt_under_review',
      'paid_confirmed',
      'human_handoff',
      'cancelled',
      'closed_no_response'
    )),
  ultimo_mensaje        text,
  cantidad_boletos      integer,
  datos_cliente         jsonb DEFAULT '{}',
  recordatorio_24h      boolean DEFAULT false,
  recordatorio_48h      boolean DEFAULT false,
  recordatorio_72h      boolean DEFAULT false,
  ultimo_recordatorio_at timestamptz,
  human_handoff_at      timestamptz,
  activa                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sorteo_conv_empresa ON public.sorteo_conversaciones(empresa_id);
CREATE INDEX IF NOT EXISTS idx_sorteo_conv_sorteo ON public.sorteo_conversaciones(sorteo_id);
CREATE INDEX IF NOT EXISTS idx_sorteo_conv_wa ON public.sorteo_conversaciones(whatsapp_numero);
CREATE INDEX IF NOT EXISTS idx_sorteo_conv_estado ON public.sorteo_conversaciones(estado);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_conv_activa
  ON public.sorteo_conversaciones (sorteo_id, whatsapp_numero)
  WHERE activa = true;

DROP TRIGGER IF EXISTS tr_sorteo_conv_updated ON public.sorteo_conversaciones;
CREATE TRIGGER tr_sorteo_conv_updated
  BEFORE UPDATE ON public.sorteo_conversaciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sorteo_conversaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sorteo_conv_select" ON public.sorteo_conversaciones FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_conv_insert" ON public.sorteo_conversaciones FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_conv_update" ON public.sorteo_conversaciones FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_conv_delete" ON public.sorteo_conversaciones FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- Tabla: sorteo_entradas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sorteo_entradas (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  sorteo_id                 uuid NOT NULL REFERENCES public.sorteos(id) ON DELETE CASCADE,
  conversacion_id           uuid REFERENCES public.sorteo_conversaciones(id) ON DELETE SET NULL,
  cliente_id                uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  whatsapp_numero           text NOT NULL,
  nombre_participante       text NOT NULL,
  documento                 text,
  cantidad_boletos          integer NOT NULL,
  monto_total               numeric NOT NULL,
  moneda                    text NOT NULL DEFAULT 'PYG' CHECK (moneda IN ('PYG')),
  estado_pago               text NOT NULL DEFAULT 'pendiente'
    CHECK (estado_pago IN ('pendiente', 'confirmado', 'rechazado')),
  fecha_pago                timestamptz,
  monto_pagado              numeric,
  banco_origen              text,
  comprobante_url           text,
  comprobante_ia_resultado  jsonb DEFAULT '{}',
  comprobante_ia_confianza  numeric,
  validado_por              text DEFAULT 'IA',
  validado_por_user_id      uuid,
  validado_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sorteo_ent_empresa ON public.sorteo_entradas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_sorteo_ent_sorteo ON public.sorteo_entradas(sorteo_id);
CREATE INDEX IF NOT EXISTS idx_sorteo_ent_cliente ON public.sorteo_entradas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_sorteo_ent_conv ON public.sorteo_entradas(conversacion_id);

DROP TRIGGER IF EXISTS tr_sorteo_ent_updated ON public.sorteo_entradas;
CREATE TRIGGER tr_sorteo_ent_updated
  BEFORE UPDATE ON public.sorteo_entradas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sorteo_entradas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sorteo_ent_select" ON public.sorteo_entradas FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_ent_insert" ON public.sorteo_entradas FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_ent_update" ON public.sorteo_entradas FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_ent_delete" ON public.sorteo_entradas FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- Tabla: sorteo_cupones
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sorteo_cupones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  sorteo_id     uuid NOT NULL REFERENCES public.sorteos(id) ON DELETE CASCADE,
  entrada_id    uuid NOT NULL REFERENCES public.sorteo_entradas(id) ON DELETE CASCADE,
  numero_cupon  text NOT NULL,
  ganador       boolean DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sorteo_id, numero_cupon)
);

CREATE INDEX IF NOT EXISTS idx_sorteo_cup_empresa ON public.sorteo_cupones(empresa_id);
CREATE INDEX IF NOT EXISTS idx_sorteo_cup_sorteo ON public.sorteo_cupones(sorteo_id);
CREATE INDEX IF NOT EXISTS idx_sorteo_cup_entrada ON public.sorteo_cupones(entrada_id);

ALTER TABLE public.sorteo_cupones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sorteo_cup_select" ON public.sorteo_cupones FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_cup_insert" ON public.sorteo_cupones FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_cup_update" ON public.sorteo_cupones FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_cup_delete" ON public.sorteo_cupones FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

-- -----------------------------------------------------------------------------
-- RPC atómica: registro de compra desde n8n (SECURITY DEFINER, sin RLS dentro)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sorteos_registrar_compra_n8n(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id       uuid := (p->>'empresa_id')::uuid;
  v_sorteo_id        uuid := (p->>'sorteo_id')::uuid;
  v_wa               text := trim(p->>'whatsapp_numero');
  v_nombre           text := trim(p->>'nombre_completo');
  v_cedula           text := nullif(trim(p->>'cedula'), '');
  v_celular          text := nullif(trim(p->>'celular'), '');
  v_ciudad           text := nullif(trim(p->>'ciudad'), '');
  v_qty              int := coalesce((p->>'cantidad_boletos')::int, 0);
  v_fecha_pago       timestamptz := nullif(p->>'fecha_pago', '')::timestamptz;
  v_monto_pago       numeric := coalesce((p->>'monto_pago')::numeric, 0);
  v_banco            text := nullif(trim(p->>'banco_origen'), '');
  v_comp_url         text := p->>'comprobante_url';
  v_ultimo_msg       text := p->>'ultimo_mensaje';

  s                  record;
  v_cliente_id       uuid;
  v_conv_id          uuid;
  v_entrada_id       uuid;
  v_monto_total      numeric;
  i                  int;
  v_num              int;
  v_num_str          text;
BEGIN
  IF v_empresa_id IS NULL OR v_sorteo_id IS NULL OR v_wa = '' OR v_nombre = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Faltan datos obligatorios (empresa_id, sorteo_id, whatsapp_numero, nombre_completo)');
  END IF;
  IF v_qty < 1 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'cantidad_boletos debe ser mayor a 0');
  END IF;

  SELECT * INTO s FROM public.sorteos WHERE id = v_sorteo_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sorteo no encontrado');
  END IF;
  IF s.empresa_id IS DISTINCT FROM v_empresa_id THEN
    RETURN jsonb_build_object('ok', false, 'message', 'El sorteo no pertenece a la empresa indicada');
  END IF;
  IF s.estado IS DISTINCT FROM 'activo' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'El sorteo no está activo');
  END IF;
  IF s.total_boletos_vendidos + v_qty > s.max_boletos THEN
    RETURN jsonb_build_object('ok', false, 'message', 'No hay boletos disponibles para esta cantidad');
  END IF;

  v_monto_total := s.precio_por_boleto * v_qty;

  -- Cliente: por documento o teléfono en la empresa
  SELECT id INTO v_cliente_id
  FROM public.clientes
  WHERE empresa_id = v_empresa_id
    AND deleted_at IS NULL
    AND (
      (v_cedula IS NOT NULL AND documento IS NOT NULL AND trim(documento) = v_cedula)
      OR (v_celular IS NOT NULL AND telefono IS NOT NULL AND trim(telefono) = v_celular)
    )
  LIMIT 1;

  IF v_cliente_id IS NULL THEN
    INSERT INTO public.clientes (
      empresa_id, tipo_cliente, nombre_contacto, nombre, documento, telefono, ciudad, origen
    ) VALUES (
      v_empresa_id, 'persona', v_nombre, v_nombre, v_cedula, coalesce(v_celular, v_wa), v_ciudad, 'SORTEO'
    )
    RETURNING id INTO v_cliente_id;
  END IF;

  SELECT id INTO v_conv_id
  FROM public.sorteo_conversaciones
  WHERE sorteo_id = v_sorteo_id AND whatsapp_numero = v_wa AND activa = true
  LIMIT 1;

  IF v_conv_id IS NULL THEN
    INSERT INTO public.sorteo_conversaciones (
      empresa_id, sorteo_id, whatsapp_numero, cliente_id, estado, ultimo_mensaje, cantidad_boletos, datos_cliente
    ) VALUES (
      v_empresa_id, v_sorteo_id, v_wa, v_cliente_id, 'paid_confirmed', v_ultimo_msg, v_qty,
      jsonb_build_object('nombre_completo', v_nombre, 'cedula', v_cedula, 'celular', v_celular, 'ciudad', v_ciudad)
    )
    RETURNING id INTO v_conv_id;
  ELSE
    UPDATE public.sorteo_conversaciones SET
      cliente_id = coalesce(v_cliente_id, cliente_id),
      estado = 'paid_confirmed',
      ultimo_mensaje = coalesce(v_ultimo_msg, ultimo_mensaje),
      cantidad_boletos = v_qty,
      datos_cliente = coalesce(datos_cliente, '{}'::jsonb) || jsonb_build_object(
        'nombre_completo', v_nombre, 'cedula', v_cedula, 'celular', v_celular, 'ciudad', v_ciudad
      ),
      updated_at = now()
    WHERE id = v_conv_id;
  END IF;

  INSERT INTO public.sorteo_entradas (
    empresa_id, sorteo_id, conversacion_id, cliente_id, whatsapp_numero, nombre_participante, documento,
    cantidad_boletos, monto_total, moneda, estado_pago, fecha_pago, monto_pagado, banco_origen, comprobante_url, validado_por
  ) VALUES (
    v_empresa_id, v_sorteo_id, v_conv_id, v_cliente_id, v_wa, v_nombre, v_cedula,
    v_qty, v_monto_total, 'PYG', 'confirmado', v_fecha_pago, v_monto_pago, v_banco, v_comp_url, 'n8n'
  )
  RETURNING id INTO v_entrada_id;

  FOR i IN 1..v_qty LOOP
    v_num := s.ultimo_numero_cupon + i;
    v_num_str := lpad(v_num::text, 4, '0');
    INSERT INTO public.sorteo_cupones (empresa_id, sorteo_id, entrada_id, numero_cupon)
    VALUES (v_empresa_id, v_sorteo_id, v_entrada_id, v_num_str);
  END LOOP;

  UPDATE public.sorteos SET
    total_boletos_vendidos = total_boletos_vendidos + v_qty,
    ultimo_numero_cupon = s.ultimo_numero_cupon + v_qty,
    updated_at = now()
  WHERE id = v_sorteo_id;

  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Compra registrada correctamente',
    'cliente', jsonb_build_object('id', v_cliente_id, 'nombre', v_nombre),
    'conversacion', jsonb_build_object('id', v_conv_id, 'estado', 'paid_confirmed'),
    'entrada', jsonb_build_object(
      'id', v_entrada_id,
      'cantidad_boletos', v_qty,
      'monto_total', v_monto_total,
      'estado_pago', 'confirmado'
    ),
    'cupones', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object('id', c.id, 'numero_cupon', c.numero_cupon)
        ORDER BY c.numero_cupon
      ), '[]'::jsonb)
      FROM public.sorteo_cupones c
      WHERE c.entrada_id = v_entrada_id
    )
  );
END;
$$;

COMMENT ON FUNCTION public.sorteos_registrar_compra_n8n(jsonb) IS 'Registro atómico de compra sorteo desde n8n; usa service role en API';

REVOKE ALL ON FUNCTION public.sorteos_registrar_compra_n8n(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sorteos_registrar_compra_n8n(jsonb) TO service_role;
