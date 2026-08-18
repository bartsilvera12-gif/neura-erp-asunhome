-- =============================================================================
-- Configuracion fiscal general por empresa:
--   - empresa_facturacion_modo: define modo (sin_factura_fiscal | sifen |
--     autoimpresor) + impresion_tipo_default + flags al confirmar venta.
--   - empresa_autoimpresor_config: datos de timbrado para impresion no
--     electronica (factura impresa con timbrado autorizado).
--
-- Convive con empresa_sifen_config existente — NO la toca. Si la empresa
-- elige modo=sifen, la UI redirige al wizard SIFEN ya existente.
--
-- Aditiva, idempotente, multi-schema.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'empresa_sifen_config'  -- existe en cada schema con facturacion
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    RAISE NOTICE '[facturacion_modo + autoimpresor] schema=%', r.sch;

    -- ── 1) empresa_facturacion_modo (singleton por empresa) ────────────
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.empresa_facturacion_modo (
        empresa_id                       uuid PRIMARY KEY
                                          REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        modo                             text NOT NULL DEFAULT 'sin_factura_fiscal'
                                          CHECK (modo IN ('sin_factura_fiscal','sifen','autoimpresor')),
        impresion_tipo_default           text NOT NULL DEFAULT 'pdf_a4'
                                          CHECK (impresion_tipo_default IN ('pdf_a4','pdf_media_hoja','ticket_80mm','ticket_58mm')),
        imprimir_al_confirmar            boolean NOT NULL DEFAULT false,
        preguntar_datos_al_confirmar     boolean NOT NULL DEFAULT false,
        activo                           boolean NOT NULL DEFAULT true,
        created_at                       timestamptz NOT NULL DEFAULT now(),
        updated_at                       timestamptz NOT NULL DEFAULT now()
      )
    $f$, r.sch);

    -- ── 2) empresa_autoimpresor_config (singleton por empresa) ─────────
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.empresa_autoimpresor_config (
        empresa_id                  uuid PRIMARY KEY
                                     REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        activo                      boolean NOT NULL DEFAULT false,
        ruc_emisor                  text,
        razon_social_emisor         text,
        nombre_fantasia             text,
        direccion_matriz            text,
        telefono                    text,
        timbrado_numero             text,
        timbrado_inicio_vigencia    date,
        timbrado_fin_vigencia       date,
        establecimiento_codigo      text,
        punto_expedicion_codigo     text,
        numero_actual               integer,
        numero_inicial              integer,
        numero_final                integer,
        tipo_documento_default      text NOT NULL DEFAULT 'factura'
                                     CHECK (tipo_documento_default IN ('factura','ticket','nota_venta','otro')),
        formato_impresion_default   text NOT NULL DEFAULT 'pdf_a4'
                                     CHECK (formato_impresion_default IN ('pdf_a4','pdf_media_hoja','ticket_80mm','ticket_58mm')),
        leyenda_papel_termico       text,
        observaciones               text,
        created_at                  timestamptz NOT NULL DEFAULT now(),
        updated_at                  timestamptz NOT NULL DEFAULT now()
      )
    $f$, r.sch);
  END LOOP;
END;
$$;
