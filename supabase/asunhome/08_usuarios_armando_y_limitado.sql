-- 08_usuarios_armando_y_limitado.sql
-- Vincula dos usuarios de Auth (ya creados en Supabase) a asunhome.usuarios.
--   · armando@admin.com     (auth 29e8e7b3-75ec-47ca-88a3-51dacce1c461) → rol IDÉNTICO al admin
--   · usuario@asunhome.com  (auth 68a76eb9-7d97-4733-8ca8-76331918942b) → rol 'usuario' + módulos limitados
--
-- empresa_id ASUNHOME: a5817a20-9fef-47c4-b44a-62aa5783d473
-- Idempotente: se puede correr varias veces (upsert por auth_user_id/email).

DO $$
DECLARE
  v_empresa uuid := 'a5817a20-9fef-47c4-b44a-62aa5783d473';
  v_rol_admin text;
  v_id_armando uuid;
  v_id_usuario uuid;
BEGIN
  -- Rol exacto del admin existente (para que Armando sea "idéntico al admin").
  SELECT rol INTO v_rol_admin
  FROM asunhome.usuarios
  WHERE email = 'admin@asunhome.com'
  LIMIT 1;
  IF v_rol_admin IS NULL THEN
    v_rol_admin := 'super_admin';  -- fallback si no se encontró el admin
  END IF;

  -- ── ARMANDO (admin) ──────────────────────────────────────────────────────
  SELECT id INTO v_id_armando
  FROM asunhome.usuarios
  WHERE auth_user_id = '29e8e7b3-75ec-47ca-88a3-51dacce1c461'
     OR email = 'armando@admin.com'
  LIMIT 1;

  IF v_id_armando IS NULL THEN
    INSERT INTO asunhome.usuarios (empresa_id, email, nombre, rol, auth_user_id, estado)
    VALUES (v_empresa, 'armando@admin.com', 'Armando', v_rol_admin,
            '29e8e7b3-75ec-47ca-88a3-51dacce1c461', 'activo')
    RETURNING id INTO v_id_armando;
  ELSE
    UPDATE asunhome.usuarios
    SET empresa_id = v_empresa, email = 'armando@admin.com', nombre = 'Armando',
        rol = v_rol_admin, auth_user_id = '29e8e7b3-75ec-47ca-88a3-51dacce1c461',
        estado = 'activo'
    WHERE id = v_id_armando;
  END IF;

  -- Admin ve todos los módulos por lógica de rol: no necesita filas en usuario_modulos.
  DELETE FROM asunhome.usuario_modulos WHERE usuario_id = v_id_armando;

  -- ── USUARIO LIMITADO ─────────────────────────────────────────────────────
  SELECT id INTO v_id_usuario
  FROM asunhome.usuarios
  WHERE auth_user_id = '68a76eb9-7d97-4733-8ca8-76331918942b'
     OR email = 'usuario@asunhome.com'
  LIMIT 1;

  IF v_id_usuario IS NULL THEN
    INSERT INTO asunhome.usuarios (empresa_id, email, nombre, rol, auth_user_id, estado)
    VALUES (v_empresa, 'usuario@asunhome.com', 'usuario', 'usuario',
            '68a76eb9-7d97-4733-8ca8-76331918942b', 'activo')
    RETURNING id INTO v_id_usuario;
  ELSE
    UPDATE asunhome.usuarios
    SET empresa_id = v_empresa, email = 'usuario@asunhome.com', nombre = 'usuario',
        rol = 'usuario', auth_user_id = '68a76eb9-7d97-4733-8ca8-76331918942b',
        estado = 'activo'
    WHERE id = v_id_usuario;
  END IF;

  -- Módulos del usuario limitado: SOLO compras (incluye Proveedores),
  -- inventario (Productos + Stock) y ventas. Sin comisiones, sin reportes.
  -- (Se intersecta con empresa_modulos activos; si un slug no está activo, no se asigna.)
  DELETE FROM asunhome.usuario_modulos WHERE usuario_id = v_id_usuario;
  INSERT INTO asunhome.usuario_modulos (usuario_id, modulo_id)
  SELECT v_id_usuario, em.modulo_id
  FROM asunhome.empresa_modulos em
  JOIN asunhome.modulos m ON m.id = em.modulo_id
  WHERE em.empresa_id = v_empresa
    AND em.activo = true
    AND m.slug IN ('compras', 'inventario', 'ventas');
END $$;

-- Verificación:
SELECT u.nombre, u.email, u.rol,
       COALESCE(
         (SELECT string_agg(m.slug, ', ' ORDER BY m.slug)
            FROM asunhome.usuario_modulos um
            JOIN asunhome.modulos m ON m.id = um.modulo_id
           WHERE um.usuario_id = u.id),
         '(todos por ser admin)'
       ) AS modulos
FROM asunhome.usuarios u
WHERE u.email IN ('armando@admin.com', 'usuario@asunhome.com', 'admin@asunhome.com')
ORDER BY u.email;
