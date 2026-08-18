-- =============================================================================
-- Micro-correcciones Triple 7 — SOLO schema: erp_triple_7_82f8a15a
--
-- Documenta y reaplica de forma idempotente los cambios ya ejecutados en
-- producción (micro-pasos 3–8): FKs de sesiones/comprobantes/tickets y modo
-- ticket_delivery para el sorteo TRIPLE 7.
--
-- Alcance EXPLÍCITO:
-- - No bucles sobre erp_*; solo este schema.
-- - No inserta en zentra_erp.
-- - Repunta FK solo si aún referencia zentra_erp (si ya es local → NOTICE).
-- - Huérfanos = 0 antes de VALIDATE; si no, EXCEPTION.
-- - sorteos.ticket_delivery_mode: solo text_only → text_and_image para el UUID fijo.
--
-- NO incluye: UPDATE operativo de chat_conversations.active_flow_session_id en QA
-- (documentado en ZENTRA_ERP_MIGRATIONS.md como acción manual).
-- =============================================================================

DO $$
DECLARE
  v_schema text := 'erp_triple_7_82f8a15a';
  v_sorteo_trpl uuid := 'd891810e-114c-4276-a2f3-65aab8732fc8';

  ref_ns text;
  orphan bigint;
  v_mode text;
  upd_n bigint;
BEGIN
  EXECUTE 'SET LOCAL lock_timeout = ''8s''';
  EXECUTE 'SET LOCAL statement_timeout = ''120s''';

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_schema) THEN
    RAISE NOTICE '[triple7 micro] Schema % no existe; omitiendo.', v_schema;
    RETURN;
  END IF;

  IF to_regclass(format('%I.sorteo_entradas', v_schema)) IS NULL
     OR to_regclass(format('%I.sorteo_ticket_deliveries', v_schema)) IS NULL
     OR to_regclass(format('%I.chat_conversations', v_schema)) IS NULL
     OR to_regclass(format('%I.chat_flow_sessions', v_schema)) IS NULL
     OR to_regclass(format('%I.chat_flow_events', v_schema)) IS NULL
     OR to_regclass(format('%I.chat_flow_data', v_schema)) IS NULL
     OR to_regclass(format('%I.chat_comprobante_validaciones', v_schema)) IS NULL
     OR to_regclass(format('%I.sorteos', v_schema)) IS NULL
     OR to_regclass(format('%I.clientes', v_schema)) IS NULL THEN
    RAISE NOTICE '[triple7 micro] Faltan tablas base en %; omitiendo.', v_schema;
    RETURN;
  END IF;

  -- ---------------------------------------------------------------------------
  -- Micro 3 — sorteo_entradas (cliente, conversación, validación comprobante)
  -- ---------------------------------------------------------------------------

  SELECT rn.nspname::text
  INTO ref_ns
  FROM pg_constraint c
  JOIN pg_class cf ON cf.oid = c.conrelid
  JOIN pg_namespace tn ON tn.oid = cf.relnamespace
  JOIN pg_class rt ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND tn.nspname = v_schema
    AND cf.relname = 'sorteo_entradas'
    AND c.conname = 'sorteo_entradas_cliente_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro] sorteo_entradas_cliente_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro] sorteo_entradas_cliente_id_fkey ya local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro] sorteo_entradas_cliente_id_fkey esquema inesperado: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas DROP CONSTRAINT IF EXISTS sorteo_entradas_cliente_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas ADD CONSTRAINT sorteo_entradas_cliente_id_fkey
       FOREIGN KEY (cliente_id) REFERENCES %I.clientes(id) ON DELETE SET NULL NOT VALID',
      v_schema,
      v_schema
    );
    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.sorteo_entradas t
        WHERE t.cliente_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.clientes x WHERE x.id = t.cliente_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;
    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro] Huérfanos sorteo_entradas.cliente_id: %', orphan;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas VALIDATE CONSTRAINT sorteo_entradas_cliente_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro] sorteo_entradas_cliente_id_fkey → clientes locales.';
  END IF;

  SELECT rn.nspname::text INTO ref_ns
  FROM pg_constraint c
  JOIN pg_class cf ON cf.oid = c.conrelid
  JOIN pg_namespace tn ON tn.oid = cf.relnamespace
  JOIN pg_class rt ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND tn.nspname = v_schema
    AND cf.relname = 'sorteo_entradas'
    AND c.conname = 'sorteo_entradas_chat_conversation_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro] sorteo_entradas_chat_conversation_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro] sorteo_entradas_chat_conversation_id_fkey ya local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro] sorteo_entradas_chat_conversation_id_fkey esquema inesperado: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas DROP CONSTRAINT IF EXISTS sorteo_entradas_chat_conversation_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas ADD CONSTRAINT sorteo_entradas_chat_conversation_id_fkey
       FOREIGN KEY (chat_conversation_id) REFERENCES %I.chat_conversations(id) ON DELETE SET NULL NOT VALID',
      v_schema,
      v_schema
    );
    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.sorteo_entradas t
        WHERE t.chat_conversation_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.chat_conversations x WHERE x.id = t.chat_conversation_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;
    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro] Huérfanos sorteo_entradas.chat_conversation_id: %', orphan;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas VALIDATE CONSTRAINT sorteo_entradas_chat_conversation_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro] sorteo_entradas_chat_conversation_id_fkey → chat_conversations locales.';
  END IF;

  SELECT rn.nspname::text INTO ref_ns
  FROM pg_constraint c
  JOIN pg_class cf ON cf.oid = c.conrelid
  JOIN pg_namespace tn ON tn.oid = cf.relnamespace
  JOIN pg_class rt ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND tn.nspname = v_schema
    AND cf.relname = 'sorteo_entradas'
    AND c.conname = 'sorteo_entradas_comprobante_validacion_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro] sorteo_entradas_comprobante_validacion_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro] sorteo_entradas_comprobante_validacion_id_fkey ya local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro] sorteo_entradas_comprobante_validacion_id_fkey esquema inesperado: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas DROP CONSTRAINT IF EXISTS sorteo_entradas_comprobante_validacion_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas ADD CONSTRAINT sorteo_entradas_comprobante_validacion_id_fkey
       FOREIGN KEY (comprobante_validacion_id) REFERENCES %I.chat_comprobante_validaciones(id) ON DELETE SET NULL NOT VALID',
      v_schema,
      v_schema
    );
    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.sorteo_entradas t
        WHERE t.comprobante_validacion_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.chat_comprobante_validaciones x WHERE x.id = t.comprobante_validacion_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;
    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro] Huérfanos sorteo_entradas.comprobante_validacion_id: %', orphan;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas VALIDATE CONSTRAINT sorteo_entradas_comprobante_validacion_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro] sorteo_entradas_comprobante_validacion_id_fkey → chat_comprobante_validaciones locales.';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Micro 4 — sorteo_ticket_deliveries (sorteo_id, entrada_id)
  -- ---------------------------------------------------------------------------

  SELECT rn.nspname::text INTO ref_ns
  FROM pg_constraint c
  JOIN pg_class cf ON cf.oid = c.conrelid
  JOIN pg_namespace tn ON tn.oid = cf.relnamespace
  JOIN pg_class rt ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND tn.nspname = v_schema
    AND cf.relname = 'sorteo_ticket_deliveries'
    AND c.conname = 'sorteo_ticket_deliveries_sorteo_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro] sorteo_ticket_deliveries_sorteo_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro] sorteo_ticket_deliveries_sorteo_id_fkey ya local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro] sorteo_ticket_deliveries_sorteo_id_fkey esquema inesperado: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.sorteo_ticket_deliveries DROP CONSTRAINT IF EXISTS sorteo_ticket_deliveries_sorteo_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteo_ticket_deliveries ADD CONSTRAINT sorteo_ticket_deliveries_sorteo_id_fkey
       FOREIGN KEY (sorteo_id) REFERENCES %I.sorteos(id) ON DELETE CASCADE NOT VALID',
      v_schema,
      v_schema
    );
    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.sorteo_ticket_deliveries t
        WHERE t.sorteo_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.sorteos x WHERE x.id = t.sorteo_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;
    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro] Huérfanos sorteo_ticket_deliveries.sorteo_id: %', orphan;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.sorteo_ticket_deliveries VALIDATE CONSTRAINT sorteo_ticket_deliveries_sorteo_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro] sorteo_ticket_deliveries_sorteo_id_fkey → sorteos locales.';
  END IF;

  SELECT rn.nspname::text INTO ref_ns
  FROM pg_constraint c
  JOIN pg_class cf ON cf.oid = c.conrelid
  JOIN pg_namespace tn ON tn.oid = cf.relnamespace
  JOIN pg_class rt ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND tn.nspname = v_schema
    AND cf.relname = 'sorteo_ticket_deliveries'
    AND c.conname = 'sorteo_ticket_deliveries_entrada_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro] sorteo_ticket_deliveries_entrada_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro] sorteo_ticket_deliveries_entrada_id_fkey ya local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro] sorteo_ticket_deliveries_entrada_id_fkey esquema inesperado: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.sorteo_ticket_deliveries DROP CONSTRAINT IF EXISTS sorteo_ticket_deliveries_entrada_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteo_ticket_deliveries ADD CONSTRAINT sorteo_ticket_deliveries_entrada_id_fkey
       FOREIGN KEY (entrada_id) REFERENCES %I.sorteo_entradas(id) ON DELETE CASCADE NOT VALID',
      v_schema,
      v_schema
    );
    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.sorteo_ticket_deliveries t
        WHERE t.entrada_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.sorteo_entradas x WHERE x.id = t.entrada_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;
    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro] Huérfanos sorteo_ticket_deliveries.entrada_id: %', orphan;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.sorteo_ticket_deliveries VALIDATE CONSTRAINT sorteo_ticket_deliveries_entrada_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro] sorteo_ticket_deliveries_entrada_id_fkey → sorteo_entradas locales.';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Micro 5 — chat_conversations.active_flow_session_id
  -- ---------------------------------------------------------------------------

  SELECT rn.nspname::text INTO ref_ns
  FROM pg_constraint c
  JOIN pg_class cf ON cf.oid = c.conrelid
  JOIN pg_namespace tn ON tn.oid = cf.relnamespace
  JOIN pg_class rt ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND tn.nspname = v_schema
    AND cf.relname = 'chat_conversations'
    AND c.conname = 'chat_conversations_active_flow_session_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro] chat_conversations_active_flow_session_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro] chat_conversations_active_flow_session_id_fkey ya local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro] chat_conversations_active_flow_session_id_fkey esquema inesperado: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_active_flow_session_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_conversations ADD CONSTRAINT chat_conversations_active_flow_session_id_fkey
       FOREIGN KEY (active_flow_session_id) REFERENCES %I.chat_flow_sessions(id) ON DELETE SET NULL NOT VALID',
      v_schema,
      v_schema
    );
    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.chat_conversations t
        WHERE t.active_flow_session_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.chat_flow_sessions x WHERE x.id = t.active_flow_session_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;
    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro] Huérfanos chat_conversations.active_flow_session_id: %', orphan;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.chat_conversations VALIDATE CONSTRAINT chat_conversations_active_flow_session_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro] chat_conversations_active_flow_session_id_fkey → chat_flow_sessions locales.';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Micro 6 — chat_flow_events / chat_flow_data → chat_flow_sessions
  -- ---------------------------------------------------------------------------

  SELECT rn.nspname::text INTO ref_ns
  FROM pg_constraint c
  JOIN pg_class cf ON cf.oid = c.conrelid
  JOIN pg_namespace tn ON tn.oid = cf.relnamespace
  JOIN pg_class rt ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND tn.nspname = v_schema
    AND cf.relname = 'chat_flow_events'
    AND c.conname = 'chat_flow_events_flow_session_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro] chat_flow_events_flow_session_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro] chat_flow_events_flow_session_id_fkey ya local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro] chat_flow_events_flow_session_id_fkey esquema inesperado: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_events DROP CONSTRAINT IF EXISTS chat_flow_events_flow_session_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_events ADD CONSTRAINT chat_flow_events_flow_session_id_fkey
       FOREIGN KEY (flow_session_id) REFERENCES %I.chat_flow_sessions(id) ON DELETE SET NULL NOT VALID',
      v_schema,
      v_schema
    );
    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.chat_flow_events t
        WHERE t.flow_session_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.chat_flow_sessions x WHERE x.id = t.flow_session_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;
    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro] Huérfanos chat_flow_events.flow_session_id: %', orphan;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_events VALIDATE CONSTRAINT chat_flow_events_flow_session_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro] chat_flow_events_flow_session_id_fkey → chat_flow_sessions locales.';
  END IF;

  SELECT rn.nspname::text INTO ref_ns
  FROM pg_constraint c
  JOIN pg_class cf ON cf.oid = c.conrelid
  JOIN pg_namespace tn ON tn.oid = cf.relnamespace
  JOIN pg_class rt ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND tn.nspname = v_schema
    AND cf.relname = 'chat_flow_data'
    AND c.conname = 'chat_flow_data_flow_session_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro] chat_flow_data_flow_session_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro] chat_flow_data_flow_session_id_fkey ya local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro] chat_flow_data_flow_session_id_fkey esquema inesperado: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_data DROP CONSTRAINT IF EXISTS chat_flow_data_flow_session_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_data ADD CONSTRAINT chat_flow_data_flow_session_id_fkey
       FOREIGN KEY (flow_session_id) REFERENCES %I.chat_flow_sessions(id) ON DELETE CASCADE NOT VALID',
      v_schema,
      v_schema
    );
    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.chat_flow_data t
        WHERE t.flow_session_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.chat_flow_sessions x WHERE x.id = t.flow_session_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;
    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro] Huérfanos chat_flow_data.flow_session_id: %', orphan;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_data VALIDATE CONSTRAINT chat_flow_data_flow_session_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro] chat_flow_data_flow_session_id_fkey → chat_flow_sessions locales.';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Micro 7 — chat_comprobante_validaciones.flow_session_id
  -- ---------------------------------------------------------------------------

  SELECT rn.nspname::text INTO ref_ns
  FROM pg_constraint c
  JOIN pg_class cf ON cf.oid = c.conrelid
  JOIN pg_namespace tn ON tn.oid = cf.relnamespace
  JOIN pg_class rt ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND tn.nspname = v_schema
    AND cf.relname = 'chat_comprobante_validaciones'
    AND c.conname = 'chat_comprobante_validaciones_flow_session_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro] chat_comprobante_validaciones_flow_session_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro] chat_comprobante_validaciones_flow_session_id_fkey ya local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro] chat_comprobante_validaciones_flow_session_id_fkey esquema inesperado: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.chat_comprobante_validaciones DROP CONSTRAINT IF EXISTS chat_comprobante_validaciones_flow_session_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_comprobante_validaciones ADD CONSTRAINT chat_comprobante_validaciones_flow_session_id_fkey
       FOREIGN KEY (flow_session_id) REFERENCES %I.chat_flow_sessions(id) ON DELETE CASCADE NOT VALID',
      v_schema,
      v_schema
    );
    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.chat_comprobante_validaciones t
        WHERE t.flow_session_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.chat_flow_sessions x WHERE x.id = t.flow_session_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;
    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro] Huérfanos chat_comprobante_validaciones.flow_session_id: %', orphan;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.chat_comprobante_validaciones VALIDATE CONSTRAINT chat_comprobante_validaciones_flow_session_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro] chat_comprobante_validaciones_flow_session_id_fkey → chat_flow_sessions locales.';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Micro 8 — sorteos.ticket_delivery_mode (TRIPLE 7 solamente)
  -- ---------------------------------------------------------------------------

  EXECUTE format(
    'SELECT ticket_delivery_mode::text FROM %I.sorteos WHERE id = $1',
    v_schema
  )
    INTO STRICT v_mode
    USING v_sorteo_trpl;

  IF v_mode = 'text_and_image' THEN
    RAISE NOTICE '[triple7 micro] sorteos.ticket_delivery_mode ya es text_and_image; sin cambio.';
  ELSIF v_mode = 'image_only' THEN
    RAISE NOTICE '[triple7 micro] sorteos.ticket_delivery_mode es image_only; no se sobrescribe (manual si se desea text_and_image).';
  ELSIF v_mode = 'text_only' THEN
    EXECUTE format(
      'UPDATE %I.sorteos SET ticket_delivery_mode = ''text_and_image''
       WHERE id = $1 AND ticket_delivery_mode = ''text_only''',
      v_schema
    )
      USING v_sorteo_trpl;
    GET DIAGNOSTICS upd_n = ROW_COUNT;
    IF upd_n <> 1 THEN
      RAISE EXCEPTION '[triple7 micro] UPDATE ticket_delivery_mode esperaba 1 fila, obtuvo %', upd_n;
    END IF;
    RAISE NOTICE '[triple7 micro] sorteos.ticket_delivery_mode → text_and_image (sorteo TRIPLE 7).';
  ELSE
    RAISE EXCEPTION '[triple7 micro] sorteos.ticket_delivery_mode valor inesperado % (sorteo %); revisar manualmente.', v_mode, v_sorteo_trpl;
  END IF;

END $$;
