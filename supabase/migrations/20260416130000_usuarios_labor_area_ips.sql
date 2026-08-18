-- Datos laborales / área en catálogo ERP (UI alineada con alta de usuario).
ALTER TABLE zentra_erp.usuarios
  ADD COLUMN IF NOT EXISTS fecha_ingreso date,
  ADD COLUMN IF NOT EXISTS tipo_contrato text CHECK (
    tipo_contrato IS NULL OR tipo_contrato IN ('salario', 'comision', 'mixto', 'prestador_servicio')
  ),
  ADD COLUMN IF NOT EXISTS salario_base numeric,
  ADD COLUMN IF NOT EXISTS porcentaje_comision numeric CHECK (
    porcentaje_comision IS NULL OR (porcentaje_comision >= 0 AND porcentaje_comision <= 100)
  ),
  ADD COLUMN IF NOT EXISTS ips boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS area text CHECK (
    area IS NULL OR area IN ('ventas', 'soporte', 'finanzas', 'operaciones', 'administracion')
  );

COMMENT ON COLUMN zentra_erp.usuarios.fecha_ingreso IS 'Fecha de ingreso laboral';
COMMENT ON COLUMN zentra_erp.usuarios.tipo_contrato IS 'Tipo de contrato declarado en RR.HH.';
COMMENT ON COLUMN zentra_erp.usuarios.salario_base IS 'Salario base en guaraníes';
COMMENT ON COLUMN zentra_erp.usuarios.porcentaje_comision IS 'Porcentaje de comisión (0–100)';
COMMENT ON COLUMN zentra_erp.usuarios.ips IS 'Si cotiza IPS';
COMMENT ON COLUMN zentra_erp.usuarios.area IS 'Área funcional del usuario';
