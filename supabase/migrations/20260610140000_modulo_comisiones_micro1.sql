-- =============================================================================
-- Módulo Comisiones — Micro-paso 1: columna vendedor en clientes + tablas base
-- Multi-schema: replica en todo schema con tabla `clientes` (public, zentra_erp, er_*, erp_*).
-- RLS: public.puede_acceder_empresa(empresa_id)
-- Catálogo: INSERT en zentra_erp.modulos / public.modulos (slug comisiones) SIN habilitar
--           automáticamente en empresa_modulos (activación manual por empresa).
-- Backfill vendedor_asignado → vendedor_usuario_id: NO ejecutado. Opcional futuro:
--   correlación exacta nombre/email único por empresa; riesgo de homonimia → solo manual/ETL.
-- =============================================================================

-- ─── A) clientes.vendedor_usuario_id (FK zentra_erp.usuarios) ─────────────────
DO $$
DECLARE
  r RECORD;
  ix text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'clientes'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = r.sch
        AND table_name = 'clientes'
        AND column_name = 'vendedor_usuario_id'
    ) THEN
      EXECUTE format(
        $a$
        ALTER TABLE %I.clientes
          ADD COLUMN vendedor_usuario_id uuid
          REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL
        $a$,
        r.sch
      );
    END IF;

    ix := 'ix_cli_vend_' || replace(md5(r.sch::text), '-', '_');
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.clientes (empresa_id, vendedor_usuario_id)',
      ix,
      r.sch
    );
  END LOOP;
END $$;

-- ─── B) Tablas comision_* por schema ─────────────────────────────────────────
DO $$
DECLARE
  r       RECORD;
  sch     text;
  fq      regclass;
  hash    text;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'clientes'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    sch := r.sch;
    fq := to_regclass(format('%I.comision_politicas', sch));
    IF fq IS NOT NULL THEN
      CONTINUE;
    END IF;

    hash := replace(md5(sch::text), '-', '_');

    EXECUTE format($sql$
      CREATE TABLE %I.comision_politicas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        nombre text NOT NULL,
        activo boolean NOT NULL DEFAULT true,
        base_calculo text NOT NULL
          CHECK (base_calculo IN ('pago_registrado', 'factura_emitida', 'factura_pagada')),
        timezone text NOT NULL DEFAULT 'America/Asuncion',
        modo_periodo text NOT NULL DEFAULT 'mensual_penultimo_dia_habil',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        updated_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        CONSTRAINT uq_comision_politicas_empresa UNIQUE (empresa_id),
        CONSTRAINT chk_comision_politicas_nombre CHECK (length(trim(nombre)) > 0)
      )
    $sql$, sch);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.comision_politicas (empresa_id, activo)',
      'ix_cp_act_' || hash,
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.comision_politicas ENABLE ROW LEVEL SECURITY$pol$, sch);
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_politicas_select ON %I.comision_politicas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_politicas_select ON %I.comision_politicas FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_politicas_insert ON %I.comision_politicas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_politicas_insert ON %I.comision_politicas FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_politicas_update ON %I.comision_politicas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_politicas_update ON %I.comision_politicas FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_politicas_delete ON %I.comision_politicas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_politicas_delete ON %I.comision_politicas FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($tr$DROP TRIGGER IF EXISTS tr_comision_politicas_updated ON %I.comision_politicas$tr$, sch);
    EXECUTE format(
      $tr$CREATE TRIGGER tr_comision_politicas_updated BEFORE UPDATE ON %I.comision_politicas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$tr$,
      sch
    );

    EXECUTE format($sql$
      CREATE TABLE %I.comision_politica_versiones (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        politica_id uuid NOT NULL REFERENCES %I.comision_politicas(id) ON DELETE CASCADE,
        version_no integer NOT NULL,
        nombre text NOT NULL,
        activo boolean NOT NULL,
        base_calculo text NOT NULL,
        timezone text NOT NULL,
        modo_periodo text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        CONSTRAINT uq_comision_politica_version UNIQUE (politica_id, version_no)
      )
    $sql$, sch, sch);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.comision_politica_versiones (empresa_id, politica_id)',
      'ix_cpv_' || hash,
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.comision_politica_versiones ENABLE ROW LEVEL SECURITY$pol$, sch);
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_politica_versiones_select ON %I.comision_politica_versiones$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_politica_versiones_select ON %I.comision_politica_versiones FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_politica_versiones_insert ON %I.comision_politica_versiones$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_politica_versiones_insert ON %I.comision_politica_versiones FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_politica_versiones_update ON %I.comision_politica_versiones$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_politica_versiones_update ON %I.comision_politica_versiones FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_politica_versiones_delete ON %I.comision_politica_versiones$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_politica_versiones_delete ON %I.comision_politica_versiones FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );

    EXECUTE format($sql$
      CREATE TABLE %I.comision_escalas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        politica_id uuid NOT NULL REFERENCES %I.comision_politicas(id) ON DELETE CASCADE,
        orden integer NOT NULL DEFAULT 0,
        desde_monto numeric(18, 2) NOT NULL,
        hasta_monto numeric(18, 2),
        porcentaje_comision numeric(9, 4) NOT NULL,
        premio_fijo numeric(18, 2),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    $sql$, sch, sch);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.comision_escalas (empresa_id, politica_id, orden)',
      'ix_ce_' || hash,
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.comision_escalas ENABLE ROW LEVEL SECURITY$pol$, sch);
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_escalas_select ON %I.comision_escalas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_escalas_select ON %I.comision_escalas FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_escalas_insert ON %I.comision_escalas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_escalas_insert ON %I.comision_escalas FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_escalas_update ON %I.comision_escalas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_escalas_update ON %I.comision_escalas FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_escalas_delete ON %I.comision_escalas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_escalas_delete ON %I.comision_escalas FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($tr$DROP TRIGGER IF EXISTS tr_comision_escalas_updated ON %I.comision_escalas$tr$, sch);
    EXECUTE format(
      $tr$CREATE TRIGGER tr_comision_escalas_updated BEFORE UPDATE ON %I.comision_escalas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$tr$,
      sch
    );

    EXECUTE format($sql$
      CREATE TABLE %I.comision_periodos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        politica_id uuid NOT NULL REFERENCES %I.comision_politicas(id) ON DELETE RESTRICT,
        estado text NOT NULL DEFAULT 'borrador'
          CHECK (estado IN ('borrador', 'cerrado', 'congelado', 'aprobado', 'pagado')),
        fecha_inicio timestamptz NOT NULL,
        fecha_fin timestamptz NOT NULL,
        label text,
        congelado_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    $sql$, sch, sch);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.comision_periodos (empresa_id, fecha_inicio, fecha_fin)',
      'ix_cper_' || hash,
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.comision_periodos ENABLE ROW LEVEL SECURITY$pol$, sch);
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_periodos_select ON %I.comision_periodos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_periodos_select ON %I.comision_periodos FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_periodos_insert ON %I.comision_periodos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_periodos_insert ON %I.comision_periodos FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_periodos_update ON %I.comision_periodos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_periodos_update ON %I.comision_periodos FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_periodos_delete ON %I.comision_periodos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_periodos_delete ON %I.comision_periodos FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($tr$DROP TRIGGER IF EXISTS tr_comision_periodos_updated ON %I.comision_periodos$tr$, sch);
    EXECUTE format(
      $tr$CREATE TRIGGER tr_comision_periodos_updated BEFORE UPDATE ON %I.comision_periodos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$tr$,
      sch
    );

    EXECUTE format($sql$
      CREATE TABLE %I.comision_lineas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        periodo_id uuid NOT NULL REFERENCES %I.comision_periodos(id) ON DELETE CASCADE,
        usuario_vendedor_id uuid NOT NULL REFERENCES zentra_erp.usuarios(id) ON DELETE RESTRICT,
        fuente_tipo text,
        fuente_id uuid,
        monto_base numeric(18, 2) NOT NULL DEFAULT 0,
        monto_comision numeric(18, 2) NOT NULL DEFAULT 0,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    $sql$, sch, sch);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.comision_lineas (empresa_id, periodo_id, usuario_vendedor_id)',
      'ix_clin_' || hash,
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.comision_lineas ENABLE ROW LEVEL SECURITY$pol$, sch);
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_lineas_select ON %I.comision_lineas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_lineas_select ON %I.comision_lineas FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_lineas_insert ON %I.comision_lineas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_lineas_insert ON %I.comision_lineas FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_lineas_update ON %I.comision_lineas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_lineas_update ON %I.comision_lineas FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_lineas_delete ON %I.comision_lineas$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_lineas_delete ON %I.comision_lineas FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );

    EXECUTE format($sql$
      CREATE TABLE %I.comision_ajustes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        periodo_id uuid REFERENCES %I.comision_periodos(id) ON DELETE SET NULL,
        linea_id uuid REFERENCES %I.comision_lineas(id) ON DELETE SET NULL,
        monto numeric(18, 2) NOT NULL,
        motivo text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid REFERENCES zentra_erp.usuarios(id) ON DELETE SET NULL,
        CONSTRAINT chk_comision_ajustes_motivo CHECK (length(trim(motivo)) > 0)
      )
    $sql$, sch, sch, sch);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.comision_ajustes (empresa_id, periodo_id)',
      'ix_caj_' || hash,
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.comision_ajustes ENABLE ROW LEVEL SECURITY$pol$, sch);
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_ajustes_select ON %I.comision_ajustes$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_ajustes_select ON %I.comision_ajustes FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_ajustes_insert ON %I.comision_ajustes$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_ajustes_insert ON %I.comision_ajustes FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_ajustes_update ON %I.comision_ajustes$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_ajustes_update ON %I.comision_ajustes FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_ajustes_delete ON %I.comision_ajustes$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_ajustes_delete ON %I.comision_ajustes FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );

    EXECUTE format($sql$
      CREATE TABLE %I.comision_equipos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        nombre text NOT NULL,
        supervisor_usuario_id uuid NOT NULL REFERENCES zentra_erp.usuarios(id) ON DELETE CASCADE,
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_comision_equipos_nombre CHECK (length(trim(nombre)) > 0)
      )
    $sql$, sch);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.comision_equipos (empresa_id, activo)',
      'ix_ceq_' || hash,
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.comision_equipos ENABLE ROW LEVEL SECURITY$pol$, sch);
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_equipos_select ON %I.comision_equipos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_equipos_select ON %I.comision_equipos FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_equipos_insert ON %I.comision_equipos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_equipos_insert ON %I.comision_equipos FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_equipos_update ON %I.comision_equipos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_equipos_update ON %I.comision_equipos FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_equipos_delete ON %I.comision_equipos$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_equipos_delete ON %I.comision_equipos FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($tr$DROP TRIGGER IF EXISTS tr_comision_equipos_updated ON %I.comision_equipos$tr$, sch);
    EXECUTE format(
      $tr$CREATE TRIGGER tr_comision_equipos_updated BEFORE UPDATE ON %I.comision_equipos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()$tr$,
      sch
    );

    EXECUTE format($sql$
      CREATE TABLE %I.comision_equipo_miembros (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES zentra_erp.empresas(id) ON DELETE CASCADE,
        equipo_id uuid NOT NULL REFERENCES %I.comision_equipos(id) ON DELETE CASCADE,
        usuario_id uuid NOT NULL REFERENCES zentra_erp.usuarios(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_comision_equipo_miembro UNIQUE (equipo_id, usuario_id)
      )
    $sql$, sch, sch);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.comision_equipo_miembros (empresa_id, equipo_id)',
      'ix_ceqm_' || hash,
      sch
    );

    EXECUTE format($pol$ALTER TABLE %I.comision_equipo_miembros ENABLE ROW LEVEL SECURITY$pol$, sch);
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_equipo_miembros_select ON %I.comision_equipo_miembros$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_equipo_miembros_select ON %I.comision_equipo_miembros FOR SELECT USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_equipo_miembros_insert ON %I.comision_equipo_miembros$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_equipo_miembros_insert ON %I.comision_equipo_miembros FOR INSERT WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_equipo_miembros_update ON %I.comision_equipo_miembros$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_equipo_miembros_update ON %I.comision_equipo_miembros FOR UPDATE USING (public.puede_acceder_empresa(empresa_id)) WITH CHECK (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
    EXECUTE format($pol$DROP POLICY IF EXISTS comision_equipo_miembros_delete ON %I.comision_equipo_miembros$pol$, sch);
    EXECUTE format(
      $pol$CREATE POLICY comision_equipo_miembros_delete ON %I.comision_equipo_miembros FOR DELETE USING (public.puede_acceder_empresa(empresa_id))$pol$,
      sch
    );
  END LOOP;
END $$;

-- ─── C) Catálogo módulos (sin empresa_modulos automático) ───────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'zentra_erp' AND table_name = 'modulos'
  ) THEN
    INSERT INTO zentra_erp.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Comisiones', 'comisiones'
    WHERE NOT EXISTS (SELECT 1 FROM zentra_erp.modulos WHERE slug = 'comisiones');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'modulos'
  ) THEN
    INSERT INTO public.modulos (id, nombre, slug)
    SELECT gen_random_uuid(), 'Comisiones', 'comisiones'
    WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE slug = 'comisiones');
  END IF;
END $$;
