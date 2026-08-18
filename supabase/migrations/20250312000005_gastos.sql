-- =============================================================================
-- Gastos operativos - Neura ERP
-- Tabla para registro de gastos por empresa
-- =============================================================================

CREATE TABLE public.gastos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  categoria   text,
  descripcion text,
  monto       numeric(12,2) NOT NULL,
  tipo        text NOT NULL DEFAULT 'variable' CHECK (tipo IN ('fijo', 'variable')),
  recurrente  boolean NOT NULL DEFAULT false,
  frecuencia  text,
  fecha       date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gastos_empresa_fecha_idx ON public.gastos (empresa_id, fecha);

ALTER TABLE public.gastos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gastos_select" ON public.gastos FOR SELECT
  USING (public.puede_acceder_empresa(empresa_id));

CREATE POLICY "gastos_insert" ON public.gastos FOR INSERT
  WITH CHECK (public.puede_acceder_empresa(empresa_id));

CREATE POLICY "gastos_update" ON public.gastos FOR UPDATE
  USING (public.puede_acceder_empresa(empresa_id))
  WITH CHECK (public.puede_acceder_empresa(empresa_id));

CREATE POLICY "gastos_delete" ON public.gastos FOR DELETE
  USING (public.puede_acceder_empresa(empresa_id));
