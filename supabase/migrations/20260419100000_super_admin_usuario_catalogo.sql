-- Super admin global: asegurar rol y empresa_id en catálogo zentra_erp.usuarios.
-- Emails históricos: typo neurautomations vs neuratomations (deben alinearse con Supabase Auth).

UPDATE zentra_erp.usuarios
SET email = lower(trim(email))
WHERE email IS NOT NULL AND email <> lower(trim(email));

UPDATE zentra_erp.usuarios
SET
  rol = 'super_admin',
  empresa_id = NULL
WHERE lower(trim(email)) IN ('neuratomations@gmail.com', 'neurautomations@gmail.com');
