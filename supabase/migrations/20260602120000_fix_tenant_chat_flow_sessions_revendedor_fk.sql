-- =============================================================================
-- chat_flow_sessions.revendedor_id en schemas tenant (erp_* / er_*):
-- Si la FK quedó como REFERENCES zentra_erp.sorteo_revendedores(id),
-- los UPDATE con UUID que solo existen en <tenant>.sorteo_revendedores fallan (23503).
--
-- Repara solo cuando la constraint chat_flow_sessions_revendedor_id_fkey apunta a
-- zentra_erp.sorteo_revendedores. Schemas que ya referencian el tenant se omiten.
--
-- Pre-chequeo: no debe haber revendedor_id NOT NULL en chat_flow_sessions sin fila
-- en <tenant>.sorteo_revendedores (si hay datos inválidos, la migración aborta).
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  orphan_count bigint;
  def_before text;
  def_after text;
  sess_oid oid;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1) Validar datos antes de tocar constraints
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT tn.nspname::text AS schema_name
    FROM pg_constraint c
    JOIN pg_class cf ON cf.oid = c.conrelid
    JOIN pg_namespace tn ON tn.oid = cf.relnamespace
    JOIN pg_class rt ON rt.oid = c.confrelid
    JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    WHERE c.contype = 'f'
      AND c.conname = 'chat_flow_sessions_revendedor_id_fkey'
      AND (
        tn.nspname ~ '^er_[0-9a-f]{32}$'
        OR tn.nspname ~ '^erp_[a-zA-Z0-9_]+$'
      )
      AND cf.relname = 'chat_flow_sessions'
      AND rn.nspname = 'zentra_erp'
      AND rt.relname = 'sorteo_revendedores'
  LOOP
    EXECUTE format(
      $q$
      SELECT COUNT(*)::bigint
      FROM %I.chat_flow_sessions s
      WHERE s.revendedor_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM %I.sorteo_revendedores r WHERE r.id = s.revendedor_id
        )
      $q$,
      r.schema_name,
      r.schema_name
    )
      INTO orphan_count;

    IF orphan_count > 0 THEN
      RAISE EXCEPTION
        'chat_flow_sessions en schema % tiene % filas con revendedor_id sin correspondencia en %.sorteo_revendedores',
        r.schema_name,
        orphan_count,
        r.schema_name;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 2) Dropear y recrear FK apuntando al tenant
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT
      tn.nspname::text AS schema_name,
      c.oid AS coid
    FROM pg_constraint c
    JOIN pg_class cf ON cf.oid = c.conrelid
    JOIN pg_namespace tn ON tn.oid = cf.relnamespace
    JOIN pg_class rt ON rt.oid = c.confrelid
    JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    WHERE c.contype = 'f'
      AND c.conname = 'chat_flow_sessions_revendedor_id_fkey'
      AND (
        tn.nspname ~ '^er_[0-9a-f]{32}$'
        OR tn.nspname ~ '^erp_[a-zA-Z0-9_]+$'
      )
      AND cf.relname = 'chat_flow_sessions'
      AND rn.nspname = 'zentra_erp'
      AND rt.relname = 'sorteo_revendedores'
  LOOP
    def_before := pg_get_constraintdef(r.coid, true);
    RAISE NOTICE '[chat_flow_sessions_revendedor_fk] ANTES %: %', r.schema_name, def_before;

    EXECUTE format(
      'ALTER TABLE %I.chat_flow_sessions DROP CONSTRAINT chat_flow_sessions_revendedor_id_fkey',
      r.schema_name
    );

    EXECUTE format(
      'ALTER TABLE %I.chat_flow_sessions ADD CONSTRAINT chat_flow_sessions_revendedor_id_fkey
       FOREIGN KEY (revendedor_id) REFERENCES %I.sorteo_revendedores(id) ON DELETE SET NULL',
      r.schema_name,
      r.schema_name
    );

    SELECT c.oid
      INTO sess_oid
    FROM pg_constraint c
    JOIN pg_class cf ON cf.oid = c.conrelid
    JOIN pg_namespace tn ON tn.oid = cf.relnamespace
    WHERE c.conname = 'chat_flow_sessions_revendedor_id_fkey'
      AND tn.nspname = r.schema_name
      AND cf.relname = 'chat_flow_sessions';

    def_after := pg_get_constraintdef(sess_oid, true);
    RAISE NOTICE '[chat_flow_sessions_revendedor_fk] DESPUÉS %: %', r.schema_name, def_after;
  END LOOP;
END;
$$;
