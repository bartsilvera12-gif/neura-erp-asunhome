-- Monto de orden desde promo del flujo (monto explícito) + metadatos en sorteo_entradas.
-- Reemplaza sorteos_ensure_order_from_chat: si viene monto_compra válido, no usar precio_por_boleto * qty.

ALTER TABLE public.sorteo_entradas
  ADD COLUMN IF NOT EXISTS promo_nombre text,
  ADD COLUMN IF NOT EXISTS precio_fuente text,
  ADD COLUMN IF NOT EXISTS precio_regular_referencia numeric;

ALTER TABLE public.sorteo_entradas
  DROP CONSTRAINT IF EXISTS sorteo_entradas_precio_fuente_check;

ALTER TABLE public.sorteo_entradas
  ADD CONSTRAINT sorteo_entradas_precio_fuente_check
  CHECK (precio_fuente IS NULL OR precio_fuente IN ('lista', 'promo'));

COMMENT ON COLUMN public.sorteo_entradas.promo_nombre IS
  'Nombre legible de la promo elegida en el flujo (option_payload), si aplica.';
COMMENT ON COLUMN public.sorteo_entradas.precio_fuente IS
  'lista: monto_total = precio_por_boleto * cantidad; promo: monto explícito del flujo.';
COMMENT ON COLUMN public.sorteo_entradas.precio_regular_referencia IS
  'Referencia opcional (ej. precio de lista) cuando precio_fuente = promo.';

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
    precio_regular_referencia
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
    v_precio_regular_ref
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
  'Idempotente: crea sorteo_entradas + cupones; monto_compra opcional (promo del flujo) evita precio_por_boleto * qty.';

REVOKE ALL ON FUNCTION public.sorteos_ensure_order_from_chat(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sorteos_ensure_order_from_chat(jsonb) TO service_role;
