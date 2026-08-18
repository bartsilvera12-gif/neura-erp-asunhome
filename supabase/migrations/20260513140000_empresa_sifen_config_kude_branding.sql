-- =============================================================================
-- KuDE branding por empresa: 3 columnas opcionales en empresa_sifen_config.
--
-- Scope:
--   Permitir que el renderer KuDE/PDF use logo y color primario propios por
--   empresa, cuando estén configurados. Si están NULL, el renderer cae al
--   comportamiento actual (logo público de Neura + color #0EA5E9).
--
-- Solo agrega columnas opcionales (NULL por default) y CHECKs de formato.
-- NO toca XML rDE, firma, envío SET, CDC, datos fiscales obligatorios,
-- certificado, cancelación, consulta lote, notas de crédito ni otros módulos.
--
-- Schemas afectados (idempotente: solo aplica donde `empresa_sifen_config` existe):
--   - public.empresa_sifen_config (si existe; tabla original del bootstrap)
--   - zentra_erp.empresa_sifen_config (catálogo legacy clonado)
--   - cada erp_*.empresa_sifen_config y er_<hex>.empresa_sifen_config (tenants)
--
-- Columnas agregadas:
--   - kude_logo_path           text NULL  (path dentro del bucket `sifen`)
--   - kude_color_primario      text NULL  (`#RRGGBB` o NULL)
--   - kude_color_primario_fill text NULL  (`#RRGGBB` o NULL; opcional, default
--                                          derivado del primario en runtime)
--
-- Cada bloque va en BEGIN/EXCEPTION para que un schema con un estado raro
-- no derribe la migración para los demás tenants.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname::text AS schema_name
    FROM pg_namespace n
    JOIN pg_class c ON c.relnamespace = n.oid
    WHERE c.relname = 'empresa_sifen_config'
      AND c.relkind = 'r'
      AND (
        n.nspname = 'public'
        OR n.nspname = 'zentra_erp'
        OR n.nspname ~ '^erp_[a-zA-Z0-9_]+$'
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
      )
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.empresa_sifen_config
           ADD COLUMN IF NOT EXISTS kude_logo_path           text,
           ADD COLUMN IF NOT EXISTS kude_color_primario      text,
           ADD COLUMN IF NOT EXISTS kude_color_primario_fill text',
        r.schema_name
      );

      EXECUTE format(
        $cmt$COMMENT ON COLUMN %I.empresa_sifen_config.kude_logo_path IS
          'Ruta del logo PNG dentro del bucket privado "sifen". Solo afecta KuDE/PDF; no toca XML/firma/SET.'$cmt$,
        r.schema_name
      );
      EXECUTE format(
        $cmt$COMMENT ON COLUMN %I.empresa_sifen_config.kude_color_primario IS
          'Color primario KuDE (#RRGGBB) para bordes y acentos del PDF. NULL = default Neura (#0EA5E9).'$cmt$,
        r.schema_name
      );
      EXECUTE format(
        $cmt$COMMENT ON COLUMN %I.empresa_sifen_config.kude_color_primario_fill IS
          'Color de fondo suave KuDE (#RRGGBB). NULL = derivado del primario por el renderer.'$cmt$,
        r.schema_name
      );

      BEGIN
        EXECUTE format(
          'ALTER TABLE %I.empresa_sifen_config
             ADD CONSTRAINT empresa_sifen_config_kude_color_primario_fmt_chk
             CHECK (kude_color_primario IS NULL OR kude_color_primario ~ ''^#[0-9A-Fa-f]{6}$'')',
          r.schema_name
        );
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END;

      BEGIN
        EXECUTE format(
          'ALTER TABLE %I.empresa_sifen_config
             ADD CONSTRAINT empresa_sifen_config_kude_color_primario_fill_fmt_chk
             CHECK (kude_color_primario_fill IS NULL OR kude_color_primario_fill ~ ''^#[0-9A-Fa-f]{6}$'')',
          r.schema_name
        );
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END;

      RAISE NOTICE 'kude_branding ok: %.empresa_sifen_config', r.schema_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'kude_branding fallo en %: %', r.schema_name, SQLERRM;
    END;
  END LOOP;
END;
$$;
