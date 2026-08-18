-- =============================================================================
-- Comparar omnicanal (chat_*) entre plantilla zentra_erp y el schema del tenant.
-- Uso: en Supabase SQL Editor, reemplazar :tenant por el valor de
--       zentra_erp.empresas.data_schema (ej. er_a1b2c3... o erp_midominio).
-- =============================================================================

-- 1) Ver qué schema usa cada empresa (copiar el data_schema de Papu / Neura).
SELECT id, nombre, data_schema
FROM zentra_erp.empresas
ORDER BY nombre;

-- 2) Tablas chat_* en plantilla (referencia correcta).
SELECT table_name AS en_zentra_erp
FROM information_schema.tables
WHERE table_schema = 'zentra_erp'
  AND table_name LIKE 'chat_%'
ORDER BY 1;

-- 3) Mismo listado en el TENANT (sustituir el literal del schema).
-- SELECT table_name AS en_tenant_papu
-- FROM information_schema.tables
-- WHERE table_schema = 'er_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'  -- <-- tu data_schema
--   AND table_name LIKE 'chat_%'
-- ORDER BY 1;

-- 4) Si falta chat_flow_node_blocks u otras en el tenant:
--    - Tenant nuevo vacío: ejecutar como service_role la función de provisión
--      zentra_erp.neura_clone_omnicanal_schema('er_<uuid_sin_guiones>') solo crea
--      schema nuevo; si el schema ya existía sin todas las tablas, hay que
--      alinear con migraciones o CREATE TABLE ... (LIKE zentra_erp.tabla ...).
--    - Ver migraciones bajo supabase/migrations que tocan chat_* y zentra_erp.
