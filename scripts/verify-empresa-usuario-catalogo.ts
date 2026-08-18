/**
 * Diagnóstico: fila zentra_erp.usuarios + empresa (data_schema) para un email.
 * Uso: npx tsx scripts/verify-empresa-usuario-catalogo.ts [email]
 * Requiere .env.local con NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
 */
import { config } from "dotenv";
import * as path from "path";
import { createErpServiceClient } from "./erp-db";

config({ path: path.join(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const emailArg = (process.argv[2] ?? "bartsilvera12@gmail.com").trim();

async function main() {
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }

  const sr = createErpServiceClient(url, key);

  const { data: rows, error } = await sr
    .from("usuarios")
    .select("id, email, auth_user_id, empresa_id, rol, estado")
    .ilike("email", emailArg);

  if (error) {
    console.error("Error consultando usuarios:", error.message);
    process.exit(1);
  }

  if (!rows?.length) {
    console.log("RESULTADO: No hay fila en zentra_erp.usuarios para email ilike:", emailArg);
    console.log(
      "→ El sidebar vacío es esperable: resolveUsuarioErpFromAuthUser no encuentra usuario."
    );
    process.exit(2);
  }

  for (const u of rows) {
    console.log("Usuario ERP:", JSON.stringify(u, null, 2));
    if (!u.auth_user_id) {
      console.warn(
        "AVISO: auth_user_id es null → el match por JWT id falla; solo funcionará si el email del JWT coincide con ilike en usuarios."
      );
    }
    if (u.empresa_id) {
      const { data: emp, error: e2 } = await sr
        .from("empresas")
        .select("id, nombre, slug, data_schema")
        .eq("id", u.empresa_id)
        .maybeSingle();
      if (e2) console.error("Error empresa:", e2.message);
      else console.log("Empresa:", JSON.stringify(emp, null, 2));
    } else {
      console.warn("AVISO: empresa_id es null");
    }
  }

  const authId = rows[0]?.auth_user_id;
  if (authId) {
    const { data: adm, error: admErr } = await sr.auth.admin.getUserById(authId);
    if (admErr) console.error("auth.admin.getUserById:", admErr.message);
    else
      console.log(
        "Auth user:",
        adm?.user?.id,
        adm?.user?.email,
        "confirmed:",
        adm?.user?.email_confirmed_at != null
      );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
