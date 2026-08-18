-- =============================================================================
-- Revendedores / referidos sorteo: catálogo, clicks (token), atribución por sesión,
-- snapshot en orden. Sin tocar flujo conversacional ni validación de comprobantes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Catálogo comercial (no usuarios ERP)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sorteo_revendedores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  sorteo_id       uuid NOT NULL REFERENCES public.sorteos(id) ON DELETE CASCADE,
  nombre          text NOT NULL,
  telefono        text,
  codigo_referido text NOT NULL,
  activo          boolean NOT NULL DEFAULT true,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_revendedores_sorteo_codigo_lower
  ON public.sorteo_revendedores (sorteo_id, lower(trim(codigo_referido)));

CREATE INDEX IF NOT EXISTS idx_sorteo_revendedores_empresa ON public.sorteo_revendedores(empresa_id);
CREATE INDEX IF NOT EXISTS idx_sorteo_revendedores_sorteo ON public.sorteo_revendedores(sorteo_id);

DROP TRIGGER IF EXISTS tr_sorteo_revendedores_updated ON public.sorteo_revendedores;
CREATE TRIGGER tr_sorteo_revendedores_updated
  BEFORE UPDATE ON public.sorteo_revendedores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sorteo_revendedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sorteo_rev_select" ON public.sorteo_revendedores FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_rev_insert" ON public.sorteo_revendedores FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_rev_update" ON public.sorteo_revendedores FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_rev_delete" ON public.sorteo_revendedores FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

COMMENT ON TABLE public.sorteo_revendedores IS
  'Revendedor del sorteo; código único por sorteo (case-insensitive).';

-- -----------------------------------------------------------------------------
-- Clicks desde URL /r/:codigo (token opaco en mensaje WhatsApp)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sorteo_revendedor_clicks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  sorteo_id             uuid NOT NULL REFERENCES public.sorteos(id) ON DELETE CASCADE,
  revendedor_id         uuid NOT NULL REFERENCES public.sorteo_revendedores(id) ON DELETE CASCADE,
  attribution_token     text NOT NULL,
  user_agent            text,
  ip_hash               text,
  conversation_id       uuid REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  flow_session_id       uuid REFERENCES public.chat_flow_sessions(id) ON DELETE SET NULL,
  contact_phone_norm    text,
  redeemed_at           timestamptz,
  expires_at            timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_rev_clicks_token ON public.sorteo_revendedor_clicks(attribution_token);
CREATE INDEX IF NOT EXISTS idx_sorteo_rev_clicks_revendedor ON public.sorteo_revendedor_clicks(revendedor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sorteo_rev_clicks_sorteo ON public.sorteo_revendedor_clicks(sorteo_id, created_at DESC);

ALTER TABLE public.sorteo_revendedor_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sorteo_rev_clicks_select" ON public.sorteo_revendedor_clicks FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_rev_clicks_insert" ON public.sorteo_revendedor_clicks FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_rev_clicks_update" ON public.sorteo_revendedor_clicks FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_rev_clicks_delete" ON public.sorteo_revendedor_clicks FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));

COMMENT ON TABLE public.sorteo_revendedor_clicks IS
  'Registro de click en landing /r; token canjeable una vez contra sesión de flujo.';

-- -----------------------------------------------------------------------------
-- Conversación: primer revendedor conocido (histórico)
-- -----------------------------------------------------------------------------
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS first_revendedor_id uuid REFERENCES public.sorteo_revendedores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_referral_captured_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_first_revendedor
  ON public.chat_conversations(first_revendedor_id)
  WHERE first_revendedor_id IS NOT NULL;

COMMENT ON COLUMN public.chat_conversations.first_revendedor_id IS
  'Primer revendedor atribuido en la vida de la conversación (no se pisa).';

-- -----------------------------------------------------------------------------
-- Sesión de flujo: verdad operativa para la compra actual
-- -----------------------------------------------------------------------------
ALTER TABLE public.chat_flow_sessions
  ADD COLUMN IF NOT EXISTS revendedor_id uuid REFERENCES public.sorteo_revendedores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS codigo_referido_snapshot text,
  ADD COLUMN IF NOT EXISTS referral_source text
    CHECK (referral_source IS NULL OR referral_source IN ('click_token', 'inbound_text'));

CREATE INDEX IF NOT EXISTS idx_chat_flow_sessions_revendedor
  ON public.chat_flow_sessions(revendedor_id)
  WHERE revendedor_id IS NOT NULL;

COMMENT ON COLUMN public.chat_flow_sessions.referral_source IS
  'click_token: canje desde sorteo_revendedor_clicks; inbound_text: parser ref= en mensaje.';

-- -----------------------------------------------------------------------------
-- Orden sorteo: snapshot comercial
-- -----------------------------------------------------------------------------
ALTER TABLE public.sorteo_entradas
  ADD COLUMN IF NOT EXISTS revendedor_id uuid REFERENCES public.sorteo_revendedores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS codigo_referido_snapshot text;

CREATE INDEX IF NOT EXISTS idx_sorteo_entradas_revendedor ON public.sorteo_entradas(revendedor_id)
  WHERE revendedor_id IS NOT NULL;

COMMENT ON COLUMN public.sorteo_entradas.codigo_referido_snapshot IS
  'Copia del código al confirmar orden (histórico / comisiones).';

-- -----------------------------------------------------------------------------
-- RPC: extiende INSERT con revendedor (validado contra empresa + sorteo)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sorteos_ensure_order_from_chat(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id          uuid := (p->>'empresa_id')::uuid;
  v_sorteo_id           uuid := (p->>'sorteo_id')::uuid;
  v_conv_id             uuid := (p->>'chat_conversation_id')::uuid;
  v_flow_code           text := nullif(trim(p->>'flow_code'), '');
  v_idem                text := nullif(trim(p->>'idempotency_key'), '');
  v_wa                  text := trim(p->>'whatsapp_numero');
  v_nombre              text := trim(p->>'nombre_completo');
  v_cedula              text := nullif(trim(p->>'cedula'), '');
  v_ciudad              text := nullif(trim(p->>'ciudad'), '');
  v_qty                 int := coalesce((p->>'cantidad_boletos')::int, 0);
  v_comp_url            text := nullif(trim(p->>'comprobante_url'), '');
  v_validado_por        text := coalesce(nullif(trim(p->>'validado_por'), ''), 'chat_flow');

  v_monto_explicit      numeric := NULL;
  v_promo_nombre        text := nullif(trim(p->>'promo_nombre'), '');
  v_precio_regular_ref  numeric := NULL;

  v_revendedor_id       uuid := NULL;
  v_codigo_ref_snap     text := NULL;

  s                     record;
  v_entrada_id          uuid;
  v_numero_orden        int;
  v_cliente_id          uuid;
  v_monto_total         numeric;
  v_precio_fuente_ins   text;
  v_lista_calc          numeric;
  i                     int;
  v_num                 int;
  v_num_str             text;
  v_existing            record;
  v_cant_existente      int;
  v_mt_existente        numeric;
  v_promo_existente     text;
  v_pf_existente        text;
BEGIN
  IF v_empresa_id IS NULL OR v_sorteo_id IS NULL OR v_conv_id IS NULL OR v_idem IS NULL OR v_idem = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Faltan empresa_id, sorteo_id, chat_conversation_id o idempotency_key');
  END IF;
  IF v_wa = '' OR v_nombre = '' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Faltan whatsapp_numero o nombre_completo');
  END IF;
  IF v_qty < 1 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'cantidad_boletos debe ser mayor a 0');
  END IF;

  IF p ? 'monto_compra' THEN
    BEGIN
      v_monto_explicit := NULLIF(trim(p->>'monto_compra'), '')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_monto_explicit := NULL;
    END;
  END IF;
  IF v_monto_explicit IS NOT NULL AND v_monto_explicit <= 0 THEN
    v_monto_explicit := NULL;
  END IF;

  IF p ? 'precio_regular_referencia' THEN
    BEGIN
      v_precio_regular_ref := NULLIF(trim(p->>'precio_regular_referencia'), '')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_precio_regular_ref := NULL;
    END;
  END IF;
  IF v_precio_regular_ref IS NOT NULL AND v_precio_regular_ref <= 0 THEN
    v_precio_regular_ref := NULL;
  END IF;

  v_codigo_ref_snap := nullif(trim(p->>'codigo_referido'), '');
  IF p ? 'revendedor_id' AND nullif(trim(p->>'revendedor_id'), '') IS NOT NULL THEN
    BEGIN
      v_revendedor_id := (p->>'revendedor_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_revendedor_id := NULL;
    END;
  END IF;

  SELECT e.id, e.numero_orden, e.estado_pago
  INTO v_existing
  FROM public.sorteo_entradas e
  WHERE e.idempotency_key = v_idem
  LIMIT 1;

  IF FOUND THEN
    SELECT
      e.cantidad_boletos,
      e.monto_total,
      e.promo_nombre,
      e.precio_fuente
    INTO v_cant_existente, v_mt_existente, v_promo_existente, v_pf_existente
    FROM public.sorteo_entradas e
    WHERE e.id = (v_existing).id;

    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'message', 'Orden ya existía (idempotencia)',
      'entrada', jsonb_build_object(
        'id', (v_existing).id,
        'numero_orden', (v_existing).numero_orden,
        'cantidad_boletos', coalesce(v_cant_existente, v_qty),
        'monto_total', v_mt_existente,
        'promo_nombre', coalesce(v_promo_existente, ''),
        'precio_fuente', coalesce(v_pf_existente, 'lista'),
        'estado_pago', (v_existing).estado_pago
      ),
      'cupones', (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object('id', c.id, 'numero_cupon', c.numero_cupon)
          ORDER BY c.numero_cupon
        ), '[]'::jsonb)
        FROM public.sorteo_cupones c
        WHERE c.entrada_id = (v_existing).id
      )
    );
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

  v_lista_calc := s.precio_por_boleto * v_qty;

  IF v_monto_explicit IS NOT NULL THEN
    v_monto_total := v_monto_explicit;
    v_precio_fuente_ins := 'promo';
    IF v_precio_regular_ref IS NULL THEN
      v_precio_regular_ref := v_lista_calc;
    END IF;
  ELSE
    v_monto_total := v_lista_calc;
    v_precio_fuente_ins := 'lista';
    v_precio_regular_ref := NULL;
  END IF;

  SELECT id INTO v_cliente_id
  FROM public.clientes
  WHERE empresa_id = v_empresa_id
    AND deleted_at IS NULL
    AND (
      (v_cedula IS NOT NULL AND documento IS NOT NULL AND trim(documento) = v_cedula)
      OR (trim(telefono) = v_wa)
    )
  LIMIT 1;

  IF v_cliente_id IS NULL THEN
    INSERT INTO public.clientes (
      empresa_id, tipo_cliente, nombre_contacto, nombre, documento, telefono, ciudad, origen
    ) VALUES (
      v_empresa_id, 'persona', v_nombre, v_nombre, v_cedula, v_wa, v_ciudad, 'SORTEO_CHAT'
    )
    RETURNING id INTO v_cliente_id;
  END IF;

  v_numero_orden := s.ultimo_numero_orden + 1;

  IF v_revendedor_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.sorteo_revendedores r
      WHERE r.id = v_revendedor_id
        AND r.empresa_id = v_empresa_id
        AND r.sorteo_id = v_sorteo_id
        AND r.activo = true
    ) THEN
      v_revendedor_id := NULL;
      v_codigo_ref_snap := NULL;
    END IF;
  ELSE
    v_codigo_ref_snap := NULL;
  END IF;

  INSERT INTO public.sorteo_entradas (
    empresa_id,
    sorteo_id,
    conversacion_id,
    cliente_id,
    whatsapp_numero,
    nombre_participante,
    documento,
    cantidad_boletos,
    monto_total,
    moneda,
    estado_pago,
    comprobante_url,
    validado_por,
    numero_orden,
    chat_conversation_id,
    flow_code,
    idempotency_key,
    promo_nombre,
    precio_fuente,
    precio_regular_referencia,
    revendedor_id,
    codigo_referido_snapshot
  ) VALUES (
    v_empresa_id,
    v_sorteo_id,
    NULL,
    v_cliente_id,
    v_wa,
    v_nombre,
    v_cedula,
    v_qty,
    v_monto_total,
    'PYG',
    'pendiente_revision',
    v_comp_url,
    v_validado_por,
    v_numero_orden,
    v_conv_id,
    v_flow_code,
    v_idem,
    v_promo_nombre,
    v_precio_fuente_ins,
    v_precio_regular_ref,
    v_revendedor_id,
    v_codigo_ref_snap
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
    ultimo_numero_orden = v_numero_orden,
    updated_at = now()
  WHERE id = v_sorteo_id;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'message', 'Orden y cupones creados',
    'entrada', jsonb_build_object(
      'id', v_entrada_id,
      'numero_orden', v_numero_orden,
      'cantidad_boletos', v_qty,
      'monto_total', v_monto_total,
      'promo_nombre', coalesce(v_promo_nombre, ''),
      'precio_fuente', v_precio_fuente_ins,
      'estado_pago', 'pendiente_revision'
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

EXCEPTION
  WHEN unique_violation THEN
    SELECT e.id, e.numero_orden, e.estado_pago
    INTO v_existing
    FROM public.sorteo_entradas e
    WHERE e.idempotency_key = v_idem
    LIMIT 1;
    IF FOUND THEN
      SELECT
        e.cantidad_boletos,
        e.monto_total,
        e.promo_nombre,
        e.precio_fuente
      INTO v_cant_existente, v_mt_existente, v_promo_existente, v_pf_existente
      FROM public.sorteo_entradas e
      WHERE e.id = (v_existing).id;
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'message', 'Orden ya existía (carrera concurrente)',
        'entrada', jsonb_build_object(
          'id', (v_existing).id,
          'numero_orden', (v_existing).numero_orden,
          'cantidad_boletos', coalesce(v_cant_existente, v_qty),
          'monto_total', v_mt_existente,
          'promo_nombre', coalesce(v_promo_existente, ''),
          'precio_fuente', coalesce(v_pf_existente, 'lista'),
          'estado_pago', (v_existing).estado_pago
        ),
        'cupones', (
          SELECT coalesce(jsonb_agg(
            jsonb_build_object('id', c.id, 'numero_cupon', c.numero_cupon)
            ORDER BY c.numero_cupon
          ), '[]'::jsonb)
          FROM public.sorteo_cupones c
          WHERE c.entrada_id = (v_existing).id
        )
      );
    END IF;
    RETURN jsonb_build_object('ok', false, 'message', 'Error de unicidad al crear orden');
END;
$$;

COMMENT ON FUNCTION public.sorteos_ensure_order_from_chat(jsonb) IS
  'Idempotente: crea sorteo_entradas + cupones; opcional revendedor_id + codigo_referido (validados).';

REVOKE ALL ON FUNCTION public.sorteos_ensure_order_from_chat(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sorteos_ensure_order_from_chat(jsonb) TO service_role;
