-- Poblar auth_user_id en usuarios existentes vinculando por email con auth.users
UPDATE public.usuarios u
SET auth_user_id = au.id
FROM auth.users au
WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(au.email))
  AND u.auth_user_id IS NULL;
