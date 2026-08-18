-- =============================================================================
-- 1) Garantiza columna empresas.data_schema (idempotente; por si un entorno no
--    aplicó aún 20260415120000).
-- 2) Repunta FKs que resolvían contra public.* hacia el esquema correcto:
--    - Si la tabla referenciada existe en el mismo esquema fuente (p_schema),
--      la FK apunta a p_schema (datos de negocio clonados en tenant).
--    - Si no, pero existe en zentra_erp, apunta a zentra_erp (catálogo ERP).
-- 3) Ejecuta el fix en zentra_erp y en todos los data_schema tenant erp_*.
-- =============================================================================

ALTER TABLE zentra_erp.empresas
  ADD COLUMN IF NOT EXISTS data_schema text;

CREATE UNIQUE INDEX IF NOT EXISTS empresas_data_schema_unique
  ON zentra_erp.empresas (data_schema)
  WHERE data_schema IS NOT NULL;

-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS zentra_erp.neura_fix_foreign_keys_retarget_from_public(text);

CREATE OR REPLACE FUNCTION zentra_erp.neura_fix_foreign_keys_retarget_from_public(p_schema text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  r          record;
  v_new_ns   text;
  v_del      text;
  v_upd      text;
  v_extra    text;
  v_sql      text;
  v_cnt      integer := 0;
BEGIN
  IF p_schema IS NULL OR btrim(p_schema) = '' THEN
    RAISE EXCEPTION 'p_schema vacío';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = p_schema) THEN
    RAISE NOTICE 'neura_fix_fk: schema % no existe', p_schema;
    RETURN 0;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _neura_fk_fix_queue (
    conname     text NOT NULL,
    src_table   text NOT NULL,
    ref_table   text NOT NULL,
    src_cols    text NOT NULL,
    ref_cols    text NOT NULL,
    confdeltype "char",
    confupdtype "char",
    condeferrable boolean,
    condeferred   boolean,
    convalidated  boolean
  ) ON COMMIT DROP;

  TRUNCATE _neura_fk_fix_queue;

  INSERT INTO _neura_fk_fix_queue (
    conname, src_table, ref_table, src_cols, ref_cols,
    confdeltype, confupdtype, condeferrable, condeferred, convalidated
  )
  SELECT
    c.conname::text,
    cl.relname::text,
    cr.relname::text,
    (
      SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord)
      FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = u.attnum AND NOT a.attisdropped
    ),
    (
      SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY u.ord)
      FROM unnest(c.confkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a
        ON a.attrelid = c.confrelid AND a.attnum = u.attnum AND NOT a.attisdropped
    ),
    c.confdeltype,
    c.confupdtype,
    c.condeferrable,
    c.condeferred,
    c.convalidated
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_class cr ON cr.oid = c.confrelid
  JOIN pg_namespace nr ON nr.oid = cr.relnamespace
  WHERE c.contype = 'f'
    AND n.nspname = p_schema
    AND nr.nspname = 'public';

  FOR r IN SELECT * FROM _neura_fk_fix_queue
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
      p_schema,
      r.src_table,
      r.conname
    );
  END LOOP;

  FOR r IN SELECT * FROM _neura_fk_fix_queue
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = p_schema AND tablename = r.ref_table
    ) THEN
      v_new_ns := p_schema;
    ELSIF EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'zentra_erp' AND tablename = r.ref_table
    ) THEN
      v_new_ns := 'zentra_erp';
    ELSE
      RAISE NOTICE 'neura_fix_fk: sin destino para %.% -> public.% (omitido ADD)',
        p_schema, r.src_table, r.ref_table;
      CONTINUE;
    END IF;

    v_del := CASE r.confdeltype
      WHEN 'a' THEN ''
      WHEN 'r' THEN ' ON DELETE RESTRICT'
      WHEN 'c' THEN ' ON DELETE CASCADE'
      WHEN 'n' THEN ' ON DELETE SET NULL'
      WHEN 'd' THEN ' ON DELETE SET DEFAULT'
      ELSE ''
    END;

    v_upd := CASE r.confupdtype
      WHEN 'a' THEN ''
      WHEN 'r' THEN ' ON UPDATE RESTRICT'
      WHEN 'c' THEN ' ON UPDATE CASCADE'
      WHEN 'n' THEN ' ON UPDATE SET NULL'
      WHEN 'd' THEN ' ON UPDATE SET DEFAULT'
      ELSE ''
    END;

    v_extra := v_del || v_upd;

    IF r.condeferrable THEN
      v_extra := v_extra || CASE WHEN r.condeferred
        THEN ' DEFERRABLE INITIALLY DEFERRED'
        ELSE ' DEFERRABLE INITIALLY IMMEDIATE'
      END;
    END IF;

    IF NOT r.convalidated THEN
      v_extra := v_extra || ' NOT VALID';
    END IF;

    v_sql := format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %I.%I (%s)%s',
      p_schema,
      r.src_table,
      r.conname,
      r.src_cols,
      v_new_ns,
      r.ref_table,
      r.ref_cols,
      v_extra
    );

    BEGIN
      EXECUTE v_sql;
      v_cnt := v_cnt + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'neura_fix_fk: ADD falló %: %', r.conname, SQLERRM;
    END;
  END LOOP;

  RETURN v_cnt;
END;
$$;

COMMENT ON FUNCTION zentra_erp.neura_fix_foreign_keys_retarget_from_public(text) IS
  'Repite FKs que apuntaban a public.* hacia p_schema.* o zentra_erp.* según exista la tabla.';

REVOKE ALL ON FUNCTION zentra_erp.neura_fix_foreign_keys_retarget_from_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.neura_fix_foreign_keys_retarget_from_public(text) TO service_role;

-- zentra_erp primero (origen de clones)
SELECT zentra_erp.neura_fix_foreign_keys_retarget_from_public('zentra_erp') AS fixed_zentra;

-- Cada schema tenant registrado
DO $$
DECLARE
  r record;
  n int;
BEGIN
  FOR r IN
    SELECT DISTINCT btrim(e.data_schema) AS ds
    FROM zentra_erp.empresas e
    WHERE e.data_schema IS NOT NULL
      AND btrim(e.data_schema) <> ''
      AND btrim(e.data_schema) <> 'zentra_erp'
      AND btrim(e.data_schema) ~ '^erp_[a-z0-9_]+$'
  LOOP
    n := zentra_erp.neura_fix_foreign_keys_retarget_from_public(r.ds);
    RAISE NOTICE 'neura_fix_fk: schema % -> % FKs recreadas', r.ds, n;
  END LOOP;
END;
$$;
