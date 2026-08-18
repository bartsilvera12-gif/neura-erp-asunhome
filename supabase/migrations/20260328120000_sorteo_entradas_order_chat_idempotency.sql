-- =============================================================================
-- Sorteos: sorteo_entradas como ORDEN + idempotencia + enlace al chat Neura
-- No se modifica sorteo_conversaciones ni su índice único en esta migración.
-- =============================================================================

-- 1) Flujo de chat → sorteo opcional
ALTER TABLE public.chat_flows
  ADD COLUMN IF NOT EXISTS sorteo_id uuid REFERENCES public.sorteos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_flows_sorteo
  ON public.chat_flows(sorteo_id)
  WHERE sorteo_id IS NOT NULL;

COMMENT ON COLUMN public.chat_flows.sorteo_id IS
  'Si está definido, al recibir comprobante (imagen) en este flow se crea orden en sorteo_entradas + cupones (idempotente).';

-- 2) Contador de órdenes por sorteo (similar a ultimo_numero_cupon)
ALTER TABLE public.sorteos
  ADD COLUMN IF NOT EXISTS ultimo_numero_orden integer NOT NULL DEFAULT 0;

-- 3) sorteo_entradas: columnas de orden + idempotencia
ALTER TABLE public.sorteo_entradas
  ADD COLUMN IF NOT EXISTS numero_orden integer,
  ADD COLUMN IF NOT EXISTS chat_conversation_id uuid REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS flow_code text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Backfill numero_orden y ultimo_numero_orden
WITH ranked AS (
  SELECT
    id,
    sorteo_id,
    row_number() OVER (PARTITION BY sorteo_id ORDER BY created_at ASC, id ASC) AS rn
  FROM public.sorteo_entradas
)
UPDATE public.sorteo_entradas e
SET numero_orden = r.rn
FROM ranked r
WHERE e.id = r.id AND e.numero_orden IS NULL;

UPDATE public.sorteo_entradas
SET numero_orden = 1
WHERE numero_orden IS NULL;

ALTER TABLE public.sorteo_entradas
  ALTER COLUMN numero_orden SET NOT NULL;

UPDATE public.sorteos s
SET ultimo_numero_orden = sub.mx
FROM (
  SELECT sorteo_id, COALESCE(MAX(numero_orden), 0) AS mx
  FROM public.sorteo_entradas
  GROUP BY sorteo_id
) sub
WHERE s.id = sub.sorteo_id;

-- 4) estado_pago: agregar pendiente_revision
ALTER TABLE public.sorteo_entradas
  DROP CONSTRAINT IF EXISTS sorteo_entradas_estado_pago_check;

ALTER TABLE public.sorteo_entradas
  ADD CONSTRAINT sorteo_entradas_estado_pago_check
  CHECK (estado_pago IN ('pendiente', 'pendiente_revision', 'confirmado', 'rechazado'));

-- 5) Idempotencia: una clave = una orden (NULL permitido en filas históricas)
CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_entradas_idempotency_key
  ON public.sorteo_entradas(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sorteo_entradas_chat_conversation
  ON public.sorteo_entradas(chat_conversation_id)
  WHERE chat_conversation_id IS NOT NULL;

COMMENT ON COLUMN public.sorteo_entradas.numero_orden IS
  'Secuencia de compras/inscripciones por sorteo (distinta de numero_cupon).';
COMMENT ON COLUMN public.sorteo_entradas.idempotency_key IS
  'Clave estable (conv + flow + media_id) para evitar duplicar orden/cupones en reintentos.';

-- =============================================================================
-- RPC: crear orden + N cupones en una transacción, idempotente
-- =============================================================================
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

  s                     record;
  v_entrada_id          uuid;
  v_numero_orden        int;
  v_cliente_id          uuid;
  v_monto_total         numeric;
  i                     int;
  v_num                 int;
  v_num_str             text;
  v_existing            record;
  v_cant_existente      int;
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

  SELECT e.id, e.numero_orden, e.estado_pago
  INTO v_existing
  FROM public.sorteo_entradas e
  WHERE e.idempotency_key = v_idem
  LIMIT 1;

  IF FOUND THEN
    SELECT cantidad_boletos INTO v_cant_existente
    FROM public.sorteo_entradas WHERE id = (v_existing).id;
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'message', 'Orden ya existía (idempotencia)',
      'entrada', jsonb_build_object(
        'id', (v_existing).id,
        'numero_orden', (v_existing).numero_orden,
        'cantidad_boletos', coalesce(v_cant_existente, v_qty),
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

  v_monto_total := s.precio_por_boleto * v_qty;

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
    idempotency_key
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
    v_idem
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
      SELECT cantidad_boletos INTO v_cant_existente
      FROM public.sorteo_entradas WHERE id = (v_existing).id;
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'message', 'Orden ya existía (carrera concurrente)',
        'entrada', jsonb_build_object(
          'id', (v_existing).id,
          'numero_orden', (v_existing).numero_orden,
          'cantidad_boletos', coalesce(v_cant_existente, v_qty),
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
  'Idempotente: crea sorteo_entradas + sorteo_cupones tras comprobante en chat; clave idempotency_key.';

REVOKE ALL ON FUNCTION public.sorteos_ensure_order_from_chat(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sorteos_ensure_order_from_chat(jsonb) TO service_role;
