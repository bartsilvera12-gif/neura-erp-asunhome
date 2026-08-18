-- Vincular usuarios con auth.users para actualización fiable de email
-- Permite usar auth_user_id directamente en lugar de buscar por email en listUsers
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_auth_user_id ON public.usuarios(auth_user_id);

COMMENT ON COLUMN public.usuarios.auth_user_id IS 'UUID de auth.users para actualizar email/estado sin buscar por email';
