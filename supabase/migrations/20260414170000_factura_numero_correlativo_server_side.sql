-- =============================================================================
-- Numeración de facturas server-side, correlativa por empresa y schema tenant.
-- Evita reinicios por localStorage/config del navegador.
-- =============================================================================

CREATE OR REPLACE FUNCTION zentra_erp.neura_upgrade_factura_correlativo(p_schema text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  s text := btrim(p_schema);
BEGIN
  IF s IS NULL OR s = '' THEN
    RAISE EXCEPTION 'neura_upgrade_factura_correlativo: schema vacío';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
    RAISE NOTICE 'neura_upgrade_factura_correlativo: schema % no existe (omitido)', s;
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I.factura_correlativos (
      empresa_id uuid PRIMARY KEY,
      prefijo text NOT NULL DEFAULT ''FAC-'',
      ultimo_numero bigint NOT NULL DEFAULT 0 CHECK (ultimo_numero >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    )',
    s
  );

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION %I.next_numero_factura_empresa(
      p_empresa_id uuid,
      p_prefijo_default text DEFAULT ''FAC-''
    )
    RETURNS text
    LANGUAGE plpgsql
    AS $f$
    DECLARE
      v_prefijo text;
      v_num bigint;
      v_ancho int := 6;
    BEGIN
      IF p_empresa_id IS NULL THEN
        RAISE EXCEPTION ''next_numero_factura_empresa: empresa_id es obligatorio'';
      END IF;

      -- Inicializa contador si no existe (toma max numérico real de facturas de la empresa).
      IF NOT EXISTS (
        SELECT 1 FROM %1$I.factura_correlativos c WHERE c.empresa_id = p_empresa_id
      ) THEN
        SELECT
          COALESCE(
            (
              SELECT NULLIF(regexp_replace(f.numero_factura, ''([0-9]+)$'', ''''), '''')
              FROM %1$I.facturas f
              WHERE f.empresa_id = p_empresa_id
                AND f.numero_factura ~ ''[0-9]+$''
              ORDER BY COALESCE(f.created_at, f.updated_at) DESC NULLS LAST, f.id DESC
              LIMIT 1
            ),
            NULLIF(btrim(p_prefijo_default), ''''),
            ''FAC-''
          ),
          COALESCE(
            (
              SELECT max((regexp_match(f.numero_factura, ''([0-9]+)$''))[1]::bigint)
              FROM %1$I.facturas f
              WHERE f.empresa_id = p_empresa_id
                AND f.numero_factura ~ ''[0-9]+$''
            ),
            0
          )
        INTO v_prefijo, v_num;

        INSERT INTO %1$I.factura_correlativos(empresa_id, prefijo, ultimo_numero)
        VALUES (p_empresa_id, v_prefijo, v_num)
        ON CONFLICT (empresa_id) DO NOTHING;
      END IF;

      UPDATE %1$I.factura_correlativos c
      SET
        prefijo = COALESCE(NULLIF(btrim(p_prefijo_default), ''''), c.prefijo, ''FAC-''),
        ultimo_numero = c.ultimo_numero + 1,
        updated_at = now()
      WHERE c.empresa_id = p_empresa_id
      RETURNING c.prefijo, c.ultimo_numero
      INTO v_prefijo, v_num;

      IF v_num IS NULL THEN
        RAISE EXCEPTION ''No se pudo reservar correlativo de factura'';
      END IF;

      RETURN COALESCE(v_prefijo, ''FAC-'') || lpad(v_num::text, v_ancho, ''0'');
    END;
    $f$',
    s
  );

  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.next_numero_factura_empresa(uuid, text) TO service_role', s);
END;
$$;

COMMENT ON FUNCTION zentra_erp.neura_upgrade_factura_correlativo(text) IS
  'Instala tabla/función next_numero_factura_empresa por schema tenant para numeración correlativa.';

REVOKE ALL ON FUNCTION zentra_erp.neura_upgrade_factura_correlativo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zentra_erp.neura_upgrade_factura_correlativo(text) TO service_role;

SELECT zentra_erp.neura_upgrade_factura_correlativo('zentra_erp');

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT btrim(e.data_schema) AS ds
    FROM zentra_erp.empresas e
    WHERE e.data_schema IS NOT NULL
      AND btrim(e.data_schema) <> ''
      AND btrim(e.data_schema) <> 'zentra_erp'
      AND btrim(e.data_schema) ~ '^erp_[a-z0-9_]+$'
  LOOP
    PERFORM zentra_erp.neura_upgrade_factura_correlativo(r.ds);
    RAISE NOTICE 'factura correlativo: actualizado %', r.ds;
  END LOOP;
END;
$$;
