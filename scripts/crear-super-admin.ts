/**
 * Script para crear el usuario super_admin en Supabase.
 * Ejecutar: npx tsx scripts/crear-super-admin.ts
 */
import { config } from "dotenv";
import * as path from "path";
import { createErpServiceClient } from "./erp-db";

config({ path: path.join(process.cwd(), ".env.local") });

/** Debe coincidir con el correo en Supabase Auth (super admin global del ERP). */
const EMAIL = "neuratomations@gmail.com";
const PASSWORD = "Neura2026";
const NOMBRE = "Admin Sistema";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("❌ Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }

  const supabase = createErpServiceClient(url, key);

  console.log("Creando super_admin:", EMAIL);

  // 1. Verificar si ya existe en usuarios
  const { data: existente } = await supabase
    .from("usuarios")
    .select("id, rol")
    .eq("email", EMAIL)
    .single();

  // 2. Crear o actualizar en Supabase Auth
  const { data: authData, error: errAuth } = await supabase.auth.admin.createUser({
    email: EMAIL.toLowerCase(),
    password: PASSWORD,
    email_confirm: true,
  });

  let authUserId: string | undefined;
  if (errAuth) {
    if (errAuth.message?.includes("already been registered")) {
      console.log("⚠️ Usuario ya existe en Auth. Actualizando contraseña...");
      const { data: users } = await supabase.auth.admin.listUsers();
      const authUser = users?.users?.find((u) => u.email === EMAIL.toLowerCase());
      if (authUser) {
        authUserId = authUser.id;
        const { error: errUpdate } = await supabase.auth.admin.updateUserById(authUser.id, {
          password: PASSWORD,
        });
        if (errUpdate) {
          console.error("❌ Error actualizando contraseña:", errUpdate.message);
          process.exit(1);
        }
        console.log("✅ Contraseña actualizada.");
      }
    } else {
      console.error("❌ Error Auth:", errAuth.message);
      process.exit(1);
    }
  } else {
    console.log("✅ Usuario creado en Supabase Auth.");
    authUserId = authData?.user?.id;
  }

  if (existente) {
    const updateData: Record<string, unknown> = { rol: "super_admin", nombre: NOMBRE, empresa_id: null };
    if (authUserId) updateData.auth_user_id = authUserId;

    const { error: errUpdate } = await supabase
      .from("usuarios")
      .update(updateData)
      .eq("email", EMAIL.toLowerCase());

    if (errUpdate) {
      console.error("❌ Error actualizando usuarios:", errUpdate.message);
      process.exit(1);
    }
    console.log("✅ Usuario actualizado en tabla usuarios (rol: super_admin).");
  } else {
    const { error: errInsert } = await supabase.from("usuarios").insert([
      {
        email: EMAIL.toLowerCase(),
        nombre: NOMBRE,
        rol: "super_admin",
        empresa_id: null,
        auth_user_id: authUserId ?? null,
      },
    ]);

    if (errInsert) {
      console.error("❌ Error insertando en usuarios:", errInsert.message);
      process.exit(1);
    }
    console.log("✅ Usuario insertado en tabla usuarios.");
  }

  console.log("\n🎉 Listo. Podés iniciar sesión con:");
  console.log("   Email:", EMAIL);
  console.log("   Contraseña:", PASSWORD);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
