-- =============================================================================
-- imports_audit: log de importaciones Excel en cada schema operativo.
-- Aditivo, idempotente, multi-schema.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'productos'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.imports_audit (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id      uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        entidad         text NOT NULL,
        filename        text,
        total_rows      integer NOT NULL DEFAULT 0,
        inserted_count  integer NOT NULL DEFAULT 0,
        updated_count   integer NOT NULL DEFAULT 0,
        skipped_count   integer NOT NULL DEFAULT 0,
        error_count     integer NOT NULL DEFAULT 0,
        warning_count   integer NOT NULL DEFAULT 0,
        errors_json     jsonb,
        warnings_json   jsonb,
        created_by      text,
        usuario_nombre  text,
        created_at      timestamptz NOT NULL DEFAULT now()
      )
    $f$, r.sch);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_imports_audit_empresa_fecha ON %I.imports_audit (empresa_id, created_at DESC)',
      r.sch
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_imports_audit_entidad ON %I.imports_audit (entidad)',
      r.sch
    );
  END LOOP;
END;
$$;
