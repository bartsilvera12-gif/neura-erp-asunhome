/** Lista usuarios con auth_user_id para poder probar cambio de email */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data, error } = await supabase.from("usuarios").select("id, email, nombre, auth_user_id").order("created_at", { ascending: false }).limit(10);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log("Usuarios (para test usar: npx tsx scripts/test-cambio-email.ts <id> <nuevo_email>):\n");
  for (const u of data ?? []) {
    const ok = u.auth_user_id ? "✓" : "✗ sin auth_user_id";
    console.log(`  ${u.id}  ${u.email}  ${u.nombre ?? "-"}  ${ok}`);
  }
}

main();
