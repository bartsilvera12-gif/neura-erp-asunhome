-- Administradores de empresa (admin / administrador) obtienen módulos vía empresa_modulos solamente.
-- Las filas en usuario_modulos son redundantes y pueden confundir listados; se eliminan.

DELETE FROM public.usuario_modulos um
USING public.usuarios u
WHERE um.usuario_id = u.id
  AND LOWER(TRIM(COALESCE(u.rol, ''))) IN ('admin', 'administrador');

COMMENT ON TABLE public.usuario_modulos IS
  'Módulos por usuario para roles distintos de admin/administrador de empresa (supervisor, usuario, etc.).';
