/**
 * Prueba el cambio de email de un usuario.
 * Uso: npx tsx scripts/test-cambio-email.ts <usuario_id> <nuevo_email>
 * Ej: npx tsx scripts/test-cambio-email.ts "uuid-del-usuario" "nuevo@email.com"
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const usuarioId = process.argv[2];
  const nuevoEmail = process.argv[3]?.trim().toLowerCase();

  if (!usuarioId || !nuevoEmail) {
    console.log("Uso: npx tsx scripts/test-cambio-email.ts <usuario_id> <nuevo_email>");
    process.exit(1);
  }

  const { data: usuario, error: errGet } = await supabase
    .from("usuarios")
    .select("id, email, auth_user_id")
    .eq("id", usuarioId)
    .single();

  if (errGet || !usuario) {
    console.error("Usuario no encontrado:", usuarioId, errGet?.message);
    process.exit(1);
  }

  console.log("Usuario actual:", usuario.email, "| auth_user_id:", usuario.auth_user_id || "(vacío)");

  const authUserId = usuario.auth_user_id ?? null;
  if (!authUserId) {
    console.error("El usuario no tiene auth_user_id. Ejecutá: npx tsx scripts/run-migrations-usuarios.ts");
    process.exit(1);
  }

  // 1. Actualizar en auth.users
  const { error: errAuth } = await supabase.auth.admin.updateUserById(authUserId, {
    email: nuevoEmail,
    email_confirm: true,
  });
  if (errAuth) {
    console.error("Error al actualizar email en auth:", errAuth.message);
    process.exit(1);
  }
  console.log("✓ Auth.users actualizado");

  // 2. Actualizar en public.usuarios
  const { error: errUsuarios } = await supabase
    .from("usuarios")
    .update({ email: nuevoEmail })
    .eq("id", usuarioId);
  if (errUsuarios) {
    console.error("Error al actualizar email en public.usuarios:", errUsuarios.message);
    process.exit(1);
  }
  console.log("✓ public.usuarios actualizado");

  // 3. Verificar
  const { data: authUser } = await supabase.auth.admin.getUserById(authUserId);
  const { data: usuarioFinal } = await supabase.from("usuarios").select("email").eq("id", usuarioId).single();

  const okAuth = authUser?.user?.email === nuevoEmail;
  const okPublic = usuarioFinal?.email === nuevoEmail;

  console.log("\nVerificación:");
  console.log("  auth.users.email:", authUser?.user?.email, okAuth ? "✓" : "✗");
  console.log("  public.usuarios.email:", usuarioFinal?.email, okPublic ? "✓" : "✗");

  if (okAuth && okPublic) {
    console.log("\n✓ Test OK. El email persistió correctamente en Supabase.");
  } else {
    console.error("\n✗ Falló la persistencia. Revisar Supabase.");
    process.exit(1);
  }
}

main();
