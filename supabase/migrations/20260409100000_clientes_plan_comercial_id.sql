-- Referencia al plan elegido en alta de cliente (contado y demás condiciones sin suscripción).
-- Nullable: filas existentes y clientes sin plan no se alteran.
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS plan_comercial_id uuid REFERENCES public.planes(id) ON DELETE SET NULL;
