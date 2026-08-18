-- =============================================================================
-- Grupos de botones rápidos WhatsApp (un solo nodo lógico, varias burbujas).
-- Nullable = comportamiento legacy idéntico.
-- =============================================================================

ALTER TABLE public.chat_flow_options
  ADD COLUMN IF NOT EXISTS group_title text,
  ADD COLUMN IF NOT EXISTS group_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.chat_flow_options.group_title IS
  'Título del grupo (cuerpo del mensaje interactivo). Vacío = modo legacy sin agrupación.';
COMMENT ON COLUMN public.chat_flow_options.group_order IS
  'Orden del grupo respecto a otros del mismo nodo.';

DO $$
DECLARE
  sch text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'zentra_erp' AND table_name = 'chat_flow_options'
  ) THEN
    EXECUTE 'ALTER TABLE zentra_erp.chat_flow_options ADD COLUMN IF NOT EXISTS group_title text';
    EXECUTE 'ALTER TABLE zentra_erp.chat_flow_options ADD COLUMN IF NOT EXISTS group_order integer NOT NULL DEFAULT 0';
    EXECUTE 'COMMENT ON COLUMN zentra_erp.chat_flow_options.group_title IS ''Título del grupo (cuerpo del mensaje interactivo). Vacío = modo legacy sin agrupación.''';
    EXECUTE 'COMMENT ON COLUMN zentra_erp.chat_flow_options.group_order IS ''Orden del grupo respecto a otros del mismo nodo.''';
  END IF;

  FOR sch IN
    SELECT n.nspname
    FROM pg_namespace n
    JOIN pg_class c ON c.relnamespace = n.oid
    WHERE c.relkind = 'r'
      AND c.relname = 'chat_flow_options'
      AND (
        n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname ~ '^erp_[a-zA-Z0-9_]+$'
      )
  LOOP
    EXECUTE format('ALTER TABLE %I.chat_flow_options ADD COLUMN IF NOT EXISTS group_title text', sch);
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_options ADD COLUMN IF NOT EXISTS group_order integer NOT NULL DEFAULT 0',
      sch
    );
    EXECUTE format(
      'COMMENT ON COLUMN %I.chat_flow_options.group_title IS %L',
      sch,
      'Título del grupo (cuerpo del mensaje interactivo). Vacío = modo legacy sin agrupación.'
    );
    EXECUTE format(
      'COMMENT ON COLUMN %I.chat_flow_options.group_order IS %L',
      sch,
      'Orden del grupo respecto a otros del mismo nodo.'
    );
  END LOOP;
END $$;
