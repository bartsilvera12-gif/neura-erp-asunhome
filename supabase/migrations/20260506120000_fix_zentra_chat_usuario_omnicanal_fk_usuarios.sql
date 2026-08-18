-- =============================================================================
-- chat_usuario_omnicanal.usuario_id debe referenciar el catálogo real del ERP:
-- zentra_erp.usuarios(id). La migración 20260502120000 apuntaba a public.usuarios,
-- donde no están todos los usuarios que sí existen en zentra_erp (FK violation).
-- Tenant erp_* sin tabla usuarios locales mantienen FK a public.usuarios.
-- =============================================================================

ALTER TABLE zentra_erp.chat_usuario_omnicanal
  DROP CONSTRAINT IF EXISTS chat_usuario_omnicanal_usuario_id_fkey;

ALTER TABLE zentra_erp.chat_usuario_omnicanal
  ADD CONSTRAINT chat_usuario_omnicanal_usuario_id_fkey
  FOREIGN KEY (usuario_id)
  REFERENCES zentra_erp.usuarios(id)
  ON DELETE CASCADE;

COMMENT ON CONSTRAINT chat_usuario_omnicanal_usuario_id_fkey ON zentra_erp.chat_usuario_omnicanal IS
  'Agente omnicanal = usuario del ERP en zentra_erp.usuarios (misma fuente que /api/empresas/usuarios).';
