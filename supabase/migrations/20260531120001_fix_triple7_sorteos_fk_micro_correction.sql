-- =============================================================================
-- Micro-corrección tenant Triple 7 — SOLO schema: erp_triple_7_82f8a15a
--
-- Contexto:
-- - Los FK de sorteos debían referenciar tablas EN EL MISMO schema tenant (UUID
--   del sorteo solo existe ahí), no zentra_erp.sorteos / sorteo_entradas.
-- - Estos cambios se aplicaron primero en producción de forma manual y gradual;
--   esta migración los documenta y permite reaplicación idempotente.
--
-- Alcance EXPLÍCITO (no extrapolar a otros tenants sin diagnóstico):
-- 1) chat_flows.sorteo_id → sorteos locales (+ UPDATE idempotente del flujo triple_7)
-- 2) sorteo_entradas.sorteo_id, sorteo_entradas.revendedor_id
-- 3) sorteo_cupones.sorteo_id, sorteo_cupones.entrada_id
--
-- NO toca: sorteo_ticket_deliveries, chat_comprobante_validaciones,
-- sorteo_conversaciones, chat_conversations, campañas, zentra_erp (salvo lectura
-- de catálogo implícita), ni otros schemas erp_*.
-- =============================================================================

DO $$
DECLARE
  v_schema text := 'erp_triple_7_82f8a15a';
  v_flow_id uuid := '21c8e43f-9c45-4a06-a44f-853a9b70c8a5';
  v_flow_code text := 'triple_7';
  v_empresa_id uuid := '82f8a15a-5dd6-48d9-99b3-97210b5130bd';
  v_sorteo_id uuid := 'd891810e-114c-4276-a2f3-65aab8732fc8';

  ref_ns text;
  orphan bigint;
  cur_sorteo uuid;
  upd_cnt bigint;
  sorteo_ok boolean;
BEGIN
  EXECUTE 'SET LOCAL lock_timeout = ''8s''';
  EXECUTE 'SET LOCAL statement_timeout = ''120s''';

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_schema) THEN
    RAISE NOTICE '[triple7 micro-fk] Schema % no existe en esta base; omitiendo.', v_schema;
    RETURN;
  END IF;

  IF to_regclass(format('%I.chat_flows', v_schema)) IS NULL
     OR to_regclass(format('%I.sorteos', v_schema)) IS NULL
     OR to_regclass(format('%I.sorteo_entradas', v_schema)) IS NULL
     OR to_regclass(format('%I.sorteo_cupones', v_schema)) IS NULL
     OR to_regclass(format('%I.sorteo_revendedores', v_schema)) IS NULL THEN
    RAISE NOTICE '[triple7 micro-fk] Faltan tablas base en %; omitiendo.', v_schema;
    RETURN;
  END IF;

  -- -------------------------------------------------------------------------
  -- Micro 1 — chat_flows.sorteo_id
  -- -------------------------------------------------------------------------
  SELECT rn.nspname::text
  INTO ref_ns
  FROM pg_constraint c
  JOIN pg_class cf ON cf.oid = c.conrelid
  JOIN pg_namespace tn ON tn.oid = cf.relnamespace
  JOIN pg_class rt ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND tn.nspname = v_schema
    AND cf.relname = 'chat_flows'
    AND c.conname = 'chat_flows_sorteo_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro-fk] Constraint chat_flows_sorteo_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro-fk] chat_flows_sorteo_id_fkey ya apunta a schema local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro-fk] chat_flows_sorteo_id_fkey referencia esquema inesperado: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.chat_flows DROP CONSTRAINT IF EXISTS chat_flows_sorteo_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_flows ADD CONSTRAINT chat_flows_sorteo_id_fkey
       FOREIGN KEY (sorteo_id) REFERENCES %I.sorteos(id) ON DELETE SET NULL NOT VALID',
      v_schema,
      v_schema
    );

    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.chat_flows cf
        WHERE cf.sorteo_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.sorteos s WHERE s.id = cf.sorteo_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;

    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro-fk] Huérfanos en chat_flows.sorteo_id respecto a sorteos locales: %', orphan;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.chat_flows VALIDATE CONSTRAINT chat_flows_sorteo_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro-fk] chat_flows_sorteo_id_fkey repuntado a schema local.';
  END IF;

  -- UPDATE idempotente del flujo triple_7
  EXECUTE format(
    'SELECT sorteo_id FROM %I.chat_flows WHERE id = $1 AND flow_code = $2 AND empresa_id = $3',
    v_schema
  )
    INTO cur_sorteo
    USING v_flow_id, v_flow_code, v_empresa_id;

  IF NOT FOUND THEN
    RAISE NOTICE '[triple7 micro-fk] Fila chat_flows triple_7 no encontrada; omitiendo UPDATE.';
  ELSIF cur_sorteo IS NOT DISTINCT FROM v_sorteo_id THEN
    RAISE NOTICE '[triple7 micro-fk] chat_flows triple_7 ya tiene sorteo_id correcto.';
  ELSIF cur_sorteo IS NOT NULL THEN
    RAISE EXCEPTION '[triple7 micro-fk] chat_flows triple_7 tiene sorteo_id distinto (%); no se sobrescribe.', cur_sorteo;
  ELSE
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.sorteos WHERE id = $1 AND empresa_id = $2)',
      v_schema
    )
      INTO sorteo_ok
      USING v_sorteo_id, v_empresa_id;

    IF NOT sorteo_ok THEN
      RAISE EXCEPTION '[triple7 micro-fk] Sorteo local % no existe o empresa_id no coincide.', v_sorteo_id;
    END IF;

    EXECUTE format(
      'UPDATE %I.chat_flows SET sorteo_id = $1
       WHERE id = $2 AND flow_code = $3 AND empresa_id = $4 AND sorteo_id IS NULL',
      v_schema
    )
      USING v_sorteo_id, v_flow_id, v_flow_code, v_empresa_id;

    GET DIAGNOSTICS upd_cnt = ROW_COUNT;

    IF upd_cnt <> 1 THEN
      RAISE EXCEPTION '[triple7 micro-fk] UPDATE chat_flows esperaba 1 fila, obtuvo %', upd_cnt;
    END IF;

    RAISE NOTICE '[triple7 micro-fk] chat_flows triple_7 vinculado a sorteo local.';
  END IF;

  -- -------------------------------------------------------------------------
  -- Micro 2 — sorteo_entradas + sorteo_cupones
  -- -------------------------------------------------------------------------

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
    AND c.conname = 'sorteo_entradas_sorteo_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro-fk] sorteo_entradas_sorteo_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro-fk] sorteo_entradas_sorteo_id_fkey ya local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro-fk] sorteo_entradas_sorteo_id_fkey referencia inesperada: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas DROP CONSTRAINT IF EXISTS sorteo_entradas_sorteo_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas ADD CONSTRAINT sorteo_entradas_sorteo_id_fkey
       FOREIGN KEY (sorteo_id) REFERENCES %I.sorteos(id) ON DELETE CASCADE NOT VALID',
      v_schema,
      v_schema
    );
    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.sorteo_entradas se
        WHERE se.sorteo_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.sorteos s WHERE s.id = se.sorteo_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;
    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro-fk] Huérfanos sorteo_entradas.sorteo_id: %', orphan;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas VALIDATE CONSTRAINT sorteo_entradas_sorteo_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro-fk] sorteo_entradas_sorteo_id_fkey repuntado.';
  END IF;

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
    AND c.conname = 'sorteo_entradas_revendedor_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro-fk] sorteo_entradas_revendedor_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro-fk] sorteo_entradas_revendedor_id_fkey ya local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro-fk] sorteo_entradas_revendedor_id_fkey referencia inesperada: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas DROP CONSTRAINT IF EXISTS sorteo_entradas_revendedor_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas ADD CONSTRAINT sorteo_entradas_revendedor_id_fkey
       FOREIGN KEY (revendedor_id) REFERENCES %I.sorteo_revendedores(id) ON DELETE SET NULL NOT VALID',
      v_schema,
      v_schema
    );
    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.sorteo_entradas se
        WHERE se.revendedor_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.sorteo_revendedores r WHERE r.id = se.revendedor_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;
    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro-fk] Huérfanos sorteo_entradas.revendedor_id: %', orphan;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas VALIDATE CONSTRAINT sorteo_entradas_revendedor_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro-fk] sorteo_entradas_revendedor_id_fkey repuntado.';
  END IF;

  SELECT rn.nspname::text
  INTO ref_ns
  FROM pg_constraint c
  JOIN pg_class cf ON cf.oid = c.conrelid
  JOIN pg_namespace tn ON tn.oid = cf.relnamespace
  JOIN pg_class rt ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND tn.nspname = v_schema
    AND cf.relname = 'sorteo_cupones'
    AND c.conname = 'sorteo_cupones_sorteo_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro-fk] sorteo_cupones_sorteo_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro-fk] sorteo_cupones_sorteo_id_fkey ya local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro-fk] sorteo_cupones_sorteo_id_fkey referencia inesperada: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.sorteo_cupones DROP CONSTRAINT IF EXISTS sorteo_cupones_sorteo_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteo_cupones ADD CONSTRAINT sorteo_cupones_sorteo_id_fkey
       FOREIGN KEY (sorteo_id) REFERENCES %I.sorteos(id) ON DELETE CASCADE NOT VALID',
      v_schema,
      v_schema
    );
    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.sorteo_cupones sc
        WHERE sc.sorteo_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.sorteos s WHERE s.id = sc.sorteo_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;
    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro-fk] Huérfanos sorteo_cupones.sorteo_id: %', orphan;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.sorteo_cupones VALIDATE CONSTRAINT sorteo_cupones_sorteo_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro-fk] sorteo_cupones_sorteo_id_fkey repuntado.';
  END IF;

  SELECT rn.nspname::text
  INTO ref_ns
  FROM pg_constraint c
  JOIN pg_class cf ON cf.oid = c.conrelid
  JOIN pg_namespace tn ON tn.oid = cf.relnamespace
  JOIN pg_class rt ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND tn.nspname = v_schema
    AND cf.relname = 'sorteo_cupones'
    AND c.conname = 'sorteo_cupones_entrada_id_fkey';

  IF ref_ns IS NULL THEN
    RAISE NOTICE '[triple7 micro-fk] sorteo_cupones_entrada_id_fkey ausente; omitiendo.';
  ELSIF ref_ns = v_schema THEN
    RAISE NOTICE '[triple7 micro-fk] sorteo_cupones_entrada_id_fkey ya local.';
  ELSIF ref_ns <> 'zentra_erp' THEN
    RAISE EXCEPTION '[triple7 micro-fk] sorteo_cupones_entrada_id_fkey referencia inesperada: %', ref_ns;
  ELSE
    EXECUTE format(
      'ALTER TABLE %I.sorteo_cupones DROP CONSTRAINT IF EXISTS sorteo_cupones_entrada_id_fkey',
      v_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.sorteo_cupones ADD CONSTRAINT sorteo_cupones_entrada_id_fkey
       FOREIGN KEY (entrada_id) REFERENCES %I.sorteo_entradas(id) ON DELETE CASCADE NOT VALID',
      v_schema,
      v_schema
    );
    EXECUTE format(
      $q$
        SELECT COUNT(*)::bigint FROM %I.sorteo_cupones sc
        WHERE sc.entrada_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM %I.sorteo_entradas e WHERE e.id = sc.entrada_id)
      $q$,
      v_schema,
      v_schema
    ) INTO orphan;
    IF orphan > 0 THEN
      RAISE EXCEPTION '[triple7 micro-fk] Huérfanos sorteo_cupones.entrada_id: %', orphan;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.sorteo_cupones VALIDATE CONSTRAINT sorteo_cupones_entrada_id_fkey',
      v_schema
    );
    RAISE NOTICE '[triple7 micro-fk] sorteo_cupones_entrada_id_fkey repuntado.';
  END IF;

END $$;
