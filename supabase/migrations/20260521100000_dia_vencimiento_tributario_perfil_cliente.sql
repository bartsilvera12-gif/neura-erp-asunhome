-- Día fijo (1-31) para vencimiento tributario mensual (reemplaza fecha_vencimiento date).
-- Debe aplicarse después de 20260520120000_cliente_perfil_tributario.sql
-- Migra: EXTRACT(DAY FROM fecha_vencimiento) cuando existía fecha.

DO $$
DECLARE
  r RECORD;
  col_fecha   boolean;
  col_dia     boolean;
  constraint_name text := 'cliente_perfil_tributario_dia_vencimiento_range';
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'cliente_perfil_tributario'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = r.sch AND table_name = 'cliente_perfil_tributario' AND column_name = 'fecha_vencimiento'
    ) INTO col_fecha;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = r.sch AND table_name = 'cliente_perfil_tributario' AND column_name = 'dia_vencimiento_tributario'
    ) INTO col_dia;

    -- Ya migrado: solo asegurar CHECK
    IF col_dia AND NOT col_fecha THEN
      EXECUTE format(
        'ALTER TABLE %I.cliente_perfil_tributario DROP CONSTRAINT IF EXISTS %I',
        r.sch,
        constraint_name
      );
      EXECUTE format(
        $c$
        ALTER TABLE %I.cliente_perfil_tributario
        ADD CONSTRAINT %I
        CHECK (dia_vencimiento_tributario IS NULL OR (dia_vencimiento_tributario >= 1 AND dia_vencimiento_tributario <= 31))
        $c$,
        r.sch,
        constraint_name
      );
      CONTINUE;
    END IF;

    -- Migrar desde fecha
    IF col_fecha THEN
      IF NOT col_dia THEN
        EXECUTE format(
          'ALTER TABLE %I.cliente_perfil_tributario ADD COLUMN dia_vencimiento_tributario smallint',
          r.sch
        );
      END IF;
      EXECUTE format(
        'UPDATE %I.cliente_perfil_tributario
         SET dia_vencimiento_tributario = (EXTRACT(DAY FROM fecha_vencimiento::timestamp))::smallint
         WHERE fecha_vencimiento IS NOT NULL
           AND dia_vencimiento_tributario IS NULL',
        r.sch
      );
      EXECUTE format('ALTER TABLE %I.cliente_perfil_tributario DROP COLUMN fecha_vencimiento', r.sch);
    ELSIF NOT col_dia THEN
      EXECUTE format(
        'ALTER TABLE %I.cliente_perfil_tributario ADD COLUMN dia_vencimiento_tributario smallint',
        r.sch
      );
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.cliente_perfil_tributario DROP CONSTRAINT IF EXISTS %I',
      r.sch,
      constraint_name
    );
    EXECUTE format(
      $c$
      ALTER TABLE %I.cliente_perfil_tributario
      ADD CONSTRAINT %I
      CHECK (dia_vencimiento_tributario IS NULL OR (dia_vencimiento_tributario >= 1 AND dia_vencimiento_tributario <= 31))
      $c$,
      r.sch,
      constraint_name
    );
  END LOOP;
END
$$;
