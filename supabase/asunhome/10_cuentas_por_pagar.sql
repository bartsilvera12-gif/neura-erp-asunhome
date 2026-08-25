-- 10_cuentas_por_pagar.sql — Control de pagos a proveedores (cuentas por pagar).
--
-- Modelo (confirmado con el cliente):
--  · Config por PROVEEDOR: días de gracia + plazos de cuotas (ej. 30,60,90,120).
--  · Factura PROVISORIA: se cargan productos durante el mes (estado compras='provisoria',
--    el stock SÍ impacta al cargar). Al llegar la factura real se convierte en definitiva
--    (estado='registrada' + datos de factura) y se genera la cuenta por pagar + cuotas.
--  · Cuotas automáticas según los plazos del proveedor; monto = total / cantidad de cuotas.
--  · Panel de pagos: pendientes, próximas a vencer, vencidas, pagadas. 'vencida' se DERIVA
--    (saldo>0 AND fecha_vencimiento < hoy), no se persiste, para no depender de un cron.
--
-- Idempotente.

-- ── 1) Config por proveedor ───────────────────────────────────────────────────
ALTER TABLE asunhome.proveedores
  ADD COLUMN IF NOT EXISTS dias_gracia   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plazos_cuotas integer[] NOT NULL DEFAULT '{}';

-- ── 2) Estado 'provisoria' en compras ─────────────────────────────────────────
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'asunhome.compras'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%estado%'
  LOOP
    EXECUTE format('ALTER TABLE asunhome.compras DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE asunhome.compras
    ADD CONSTRAINT compras_estado_check
    CHECK (estado IN ('registrada', 'pendiente', 'pagada', 'anulada', 'provisoria'));
END $$;

-- ── 3) Cuentas por pagar (cabecera de deuda por compra) ───────────────────────
CREATE TABLE IF NOT EXISTS asunhome.cuentas_por_pagar (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL,
  proveedor_id          uuid,
  proveedor_nombre      text,
  compra_numero_control text,
  fecha_emision         date,
  dias_gracia           integer NOT NULL DEFAULT 0,
  fecha_inicio_pago     date,
  moneda                text NOT NULL DEFAULT 'PYG',
  total                 numeric(14,2) NOT NULL DEFAULT 0,
  saldo                 numeric(14,2) NOT NULL DEFAULT 0,
  estado                text NOT NULL DEFAULT 'pendiente'
                          CHECK (estado IN ('pendiente', 'parcial', 'pagado', 'anulado')),
  observaciones         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- Una cuenta por compra (agrupada por numero_control).
CREATE UNIQUE INDEX IF NOT EXISTS cxp_uq_empresa_numctrl
  ON asunhome.cuentas_por_pagar (empresa_id, compra_numero_control)
  WHERE compra_numero_control IS NOT NULL;
CREATE INDEX IF NOT EXISTS cxp_idx_estado    ON asunhome.cuentas_por_pagar (empresa_id, estado);
CREATE INDEX IF NOT EXISTS cxp_idx_proveedor ON asunhome.cuentas_por_pagar (empresa_id, proveedor_id);

-- ── 4) Cuotas de cada cuenta por pagar ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asunhome.compra_cuotas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  cuenta_por_pagar_id uuid NOT NULL REFERENCES asunhome.cuentas_por_pagar (id) ON DELETE CASCADE,
  numero_cuota        integer NOT NULL,
  dias_plazo          integer,
  fecha_vencimiento   date NOT NULL,
  monto               numeric(14,2) NOT NULL DEFAULT 0,
  saldo               numeric(14,2) NOT NULL DEFAULT 0,
  estado              text NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente', 'parcial', 'pagada', 'anulada')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cuotas_idx_cxp        ON asunhome.compra_cuotas (cuenta_por_pagar_id);
CREATE INDEX IF NOT EXISTS cuotas_idx_venc       ON asunhome.compra_cuotas (empresa_id, fecha_vencimiento);
CREATE INDEX IF NOT EXISTS cuotas_idx_estado     ON asunhome.compra_cuotas (empresa_id, estado);

-- ── 5) Pagos a proveedores (pagos parciales o totales de cuotas) ──────────────
CREATE TABLE IF NOT EXISTS asunhome.pagos_proveedores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  proveedor_id        uuid,
  cuenta_por_pagar_id uuid REFERENCES asunhome.cuentas_por_pagar (id) ON DELETE CASCADE,
  cuota_id            uuid REFERENCES asunhome.compra_cuotas (id) ON DELETE SET NULL,
  fecha_pago          date NOT NULL DEFAULT current_date,
  monto               numeric(14,2) NOT NULL,
  metodo_pago         text,
  entidad_bancaria_id uuid,
  referencia          text,
  observaciones       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pagosprov_idx_cxp   ON asunhome.pagos_proveedores (cuenta_por_pagar_id);
CREATE INDEX IF NOT EXISTS pagosprov_idx_cuota ON asunhome.pagos_proveedores (cuota_id);

-- ── 6) Grants + RLS (mismo criterio que el resto del schema asunhome) ─────────
GRANT SELECT, INSERT, UPDATE, DELETE ON
  asunhome.cuentas_por_pagar, asunhome.compra_cuotas, asunhome.pagos_proveedores
  TO authenticated;
GRANT ALL ON
  asunhome.cuentas_por_pagar, asunhome.compra_cuotas, asunhome.pagos_proveedores
  TO postgres, service_role;

ALTER TABLE asunhome.cuentas_por_pagar  ENABLE ROW LEVEL SECURITY;
ALTER TABLE asunhome.compra_cuotas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE asunhome.pagos_proveedores  ENABLE ROW LEVEL SECURITY;

-- Policy por empresa si existe la función helper; si no, permisiva para authenticated
-- (el acceso productivo es server-side vía service_role, que igual bypassa RLS).
DO $$
DECLARE
  t text;
  tiene_fn boolean := EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'asunhome' AND p.proname = 'puede_acceder_empresa'
  );
BEGIN
  FOREACH t IN ARRAY ARRAY['cuentas_por_pagar', 'compra_cuotas', 'pagos_proveedores'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON asunhome.%I', t || '_rls', t);
    IF tiene_fn THEN
      EXECUTE format(
        'CREATE POLICY %I ON asunhome.%I FOR ALL TO authenticated USING (asunhome.puede_acceder_empresa(empresa_id)) WITH CHECK (asunhome.puede_acceder_empresa(empresa_id))',
        t || '_rls', t);
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON asunhome.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        t || '_rls', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- Verificación:
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='asunhome' AND table_name='proveedores'
       AND column_name IN ('dias_gracia','plazos_cuotas'))            AS proveedores_cols_ok,   -- espera 2
  to_regclass('asunhome.cuentas_por_pagar') IS NOT NULL               AS tbl_cxp_ok,
  to_regclass('asunhome.compra_cuotas')     IS NOT NULL               AS tbl_cuotas_ok,
  to_regclass('asunhome.pagos_proveedores') IS NOT NULL               AS tbl_pagos_ok,
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid='asunhome.compras'::regclass
            AND pg_get_constraintdef(oid) ILIKE '%provisoria%')       AS compras_provisoria_ok;
