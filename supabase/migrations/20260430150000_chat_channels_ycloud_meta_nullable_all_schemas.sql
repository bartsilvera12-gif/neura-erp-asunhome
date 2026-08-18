-- =============================================================================
-- chat_channels: mismas reglas omnicanal Etapa 1 que public (20260415193000)
-- en zentra_erp y esquemas tenant. PostgREST / service role usan zentra_erp o
-- data_schema, no public: ahí meta_phone_number_id seguía NOT NULL y rompía
-- INSERT de WhatsApp YCloud (coexistencia) con meta_phone_number_id NULL.
-- Idempotente: ADD IF NOT EXISTS, DROP IF EXISTS, índice único parcial IF NOT EXISTS.
-- =============================================================================

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_channels'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format('ALTER TABLE %I.chat_channels ADD COLUMN IF NOT EXISTS nombre text', sch);
    EXECUTE format(
      'ALTER TABLE %I.chat_channels ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT ''meta''',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_channels ADD COLUMN IF NOT EXISTS provider_channel_id text',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_channels ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true',
      sch
    );
    EXECUTE format('ALTER TABLE %I.chat_channels ADD COLUMN IF NOT EXISTS connection_mode text', sch);
    EXECUTE format('ALTER TABLE %I.chat_channels ADD COLUMN IF NOT EXISTS config_status text', sch);

    EXECUTE format(
      'ALTER TABLE %I.chat_channels DROP CONSTRAINT IF EXISTS chat_channels_meta_phone_number_id_key',
      sch
    );
    EXECUTE format('ALTER TABLE %I.chat_channels ALTER COLUMN meta_phone_number_id DROP NOT NULL', sch);

    EXECUTE format(
      $q$
      CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_meta_phone_number_id_uidx
      ON %I.chat_channels (meta_phone_number_id)
      WHERE meta_phone_number_id IS NOT NULL AND btrim(meta_phone_number_id) <> ''
      $q$,
      sch
    );

    EXECUTE format('ALTER TABLE %I.chat_channels DROP CONSTRAINT IF EXISTS chat_channels_type_check', sch);
    EXECUTE format(
      'ALTER TABLE %I.chat_channels ADD CONSTRAINT chat_channels_type_check CHECK (type IN (''whatsapp'', ''instagram'', ''facebook'', ''email'', ''linkedin''))',
      sch
    );

    EXECUTE format(
      $u$
      UPDATE %I.chat_channels
      SET config_status = COALESCE(NULLIF(btrim(config_status), ''), 'incomplete')
      WHERE config_status IS NULL OR btrim(config_status) = ''
      $u$,
      sch
    );

    EXECUTE format(
      'ALTER TABLE %I.chat_channels ALTER COLUMN config_status SET DEFAULT ''incomplete''',
      sch
    );

    BEGIN
      EXECUTE format('ALTER TABLE %I.chat_channels ALTER COLUMN config_status SET NOT NULL', sch);
    EXCEPTION
      WHEN others THEN
        RAISE NOTICE 'chat_channels %: no se pudo NOT NULL en config_status: %', sch, SQLERRM;
    END;

    EXECUTE format(
      'ALTER TABLE %I.chat_channels DROP CONSTRAINT IF EXISTS chat_channels_config_status_check',
      sch
    );
    EXECUTE format(
      $s$
      UPDATE %I.chat_channels
      SET config_status = 'incomplete'
      WHERE config_status IS NULL
         OR btrim(config_status) = ''
         OR lower(btrim(config_status)) NOT IN ('inactive', 'incomplete', 'active')
      $s$,
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_channels ADD CONSTRAINT chat_channels_config_status_check CHECK (config_status IN (''inactive'', ''incomplete'', ''active''))',
      sch
    );

    EXECUTE format(
      $b$
      UPDATE %1$I.chat_channels c
      SET
        connection_mode = v.conn,
        config_status = v.st
      FROM (
        SELECT
          id,
          CASE
            WHEN type = 'whatsapp' AND lower(COALESCE(NULLIF(btrim(provider), ''), 'meta')) = 'meta' THEN
              COALESCE(NULLIF(btrim(connection_mode), ''), 'official')
            WHEN type = 'whatsapp' AND lower(btrim(provider)) = 'ycloud' THEN
              COALESCE(NULLIF(btrim(connection_mode), ''), 'coexistence')
            ELSE connection_mode
          END AS conn,
          CASE
            WHEN activo IS NOT TRUE THEN 'inactive'
            WHEN type = 'whatsapp' AND lower(COALESCE(NULLIF(btrim(provider), ''), 'meta')) = 'meta'
                 AND meta_phone_number_id IS NOT NULL AND btrim(meta_phone_number_id) <> '' THEN 'active'
            WHEN type = 'whatsapp' AND lower(btrim(provider)) = 'ycloud'
                 AND activo IS TRUE
                 AND (COALESCE(config, '{}'::jsonb)->>'ycloud_api_key') IS NOT NULL
                 AND btrim(COALESCE(config, '{}'::jsonb)->>'ycloud_api_key') <> '' THEN 'active'
            WHEN activo IS TRUE THEN 'incomplete'
            ELSE 'inactive'
          END AS st
        FROM %1$I.chat_channels
      ) v
      WHERE c.id = v.id
      $b$,
      sch
    );
  END LOOP;
END;
$$;
