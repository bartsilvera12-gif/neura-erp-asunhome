-- =============================================================================
-- Tenants er_* / erp_*: chat_comprobante_validaciones.channel_id debe referenciar
-- chat_channels en el MISMO schema que la fila de validación.
--
-- Si la FK sigue apuntando a public.chat_channels o zentra_erp.chat_channels,
-- el canal Meta/WhatsApp (solo copiado en el tenant) viola la FK al insertar.
--
-- Idempotente: si ya apunta al tenant local, replace no cambia la definición.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  newdef text;
  def0 text;
BEGIN
  FOR r IN
    SELECT
      tn.nspname::text AS schema_name,
      c.conname::text AS conname,
      c.oid AS coid
    FROM pg_constraint c
    JOIN pg_class cf ON cf.oid = c.conrelid
    JOIN pg_namespace tn ON tn.oid = cf.relnamespace
    JOIN pg_class rt ON rt.oid = c.confrelid
    JOIN pg_namespace rn ON rn.oid = rt.relnamespace
    WHERE c.contype = 'f'
      AND cf.relname = 'chat_comprobante_validaciones'
      AND rt.relname = 'chat_channels'
      AND rn.nspname IN ('public', 'zentra_erp')
      AND (
        tn.nspname ~ '^er_[0-9a-f]{32}$'
        OR tn.nspname ~ '^erp_[a-zA-Z0-9_]+$'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_class c2
        JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
        WHERE n2.nspname = tn.nspname
          AND c2.relname = 'chat_channels'
          AND c2.relkind = 'r'
      )
  LOOP
    def0 := pg_get_constraintdef(r.coid, true);
    newdef := def0;
    newdef := replace(newdef, 'REFERENCES "public".', 'REFERENCES ' || quote_ident(r.schema_name) || '.');
    newdef := replace(newdef, 'REFERENCES public.', 'REFERENCES ' || quote_ident(r.schema_name) || '.');
    newdef := replace(newdef, 'REFERENCES "zentra_erp".', 'REFERENCES ' || quote_ident(r.schema_name) || '.');
    newdef := replace(newdef, 'REFERENCES zentra_erp.', 'REFERENCES ' || quote_ident(r.schema_name) || '.');
    IF newdef = def0 THEN
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.chat_comprobante_validaciones DROP CONSTRAINT %I',
        r.schema_name,
        r.conname
      );
      EXECUTE format(
        'ALTER TABLE %I.chat_comprobante_validaciones ADD CONSTRAINT %I %s',
        r.schema_name,
        r.conname,
        newdef
      );
      RAISE NOTICE 'FK repuntada: %.% → chat_channels en tenant', r.schema_name, r.conname;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'FK omitida %.%: %', r.schema_name, r.conname, SQLERRM;
    END;
  END LOOP;
END;
$$;
