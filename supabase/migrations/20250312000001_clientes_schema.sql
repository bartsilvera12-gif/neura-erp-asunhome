-- =============================================================================
-- Extensión del esquema de clientes para soportar el tipo Cliente completo
-- =============================================================================

-- Añadir columnas que puedan faltar (IF NOT EXISTS en Postgres 9.6+)
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS tipo_cliente text DEFAULT 'empresa';
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS empresa text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS ruc text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS documento text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS telefono_secundario text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS email_secundario text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS ciudad text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS pais text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS sitio_web text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS instagram text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS linkedin text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS categoria_cliente text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS industria text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS valor_cliente numeric;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS condicion_pago text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS moneda_preferida text DEFAULT 'GS';
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS vendedor_asignado text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS origen text DEFAULT 'MANUAL';
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS prospecto_id integer;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS estado text DEFAULT 'activo';
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS notas jsonb DEFAULT '[]';
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- nombre_contacto: si la tabla solo tiene "nombre", lo usamos para contacto
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS nombre_contacto text;
