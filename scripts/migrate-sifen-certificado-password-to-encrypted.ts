/**
 * Migra empresa_sifen_config.certificado_password (texto plano) → certificado_password_encrypted.
 *
 * Ejecutar DESPUÉS de aplicar 20260405120000_sifen_cert_password_encrypted.sql
 * y ANTES de 20260405120100_sifen_drop_certificado_password_plain.sql
 *
 * Requiere: .env.local con NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SIFEN_SECRETS_KEY
 *
 *   npx tsx scripts/migrate-sifen-certificado-password-to-encrypted.ts
 */
import * as path from "path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { encryptSecret, requireSifenSecretsKeyBytes } from "../src/lib/sifen/security";

config({ path: path.join(process.cwd(), ".env.local") });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  try {
    requireSifenSecretsKeyBytes();
  } catch (e) {
    console.error("SIFEN_SECRETS_KEY inválida o ausente:", e);
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: rows, error } = await supabase.from("empresa_sifen_config").select("id, empresa_id, certificado_password, certificado_password_encrypted");

  if (error) {
    console.error("Error leyendo empresa_sifen_config:", error.message);
    process.exit(1);
  }

  let migrated = 0;
  for (const row of rows ?? []) {
    const plain = row.certificado_password as string | null | undefined;
    const enc = row.certificado_password_encrypted as string | null | undefined;
    if (plain == null || String(plain).trim() === "") continue;
    if (enc != null && String(enc).trim() !== "") {
      console.log(`Saltando ${row.id}: ya tiene certificado_password_encrypted`);
      continue;
    }
    const ciphertext = encryptSecret(String(plain));
    const { error: upErr } = await supabase
      .from("empresa_sifen_config")
      .update({
        certificado_password_encrypted: ciphertext,
        certificado_password: null,
      })
      .eq("id", row.id);

    if (upErr) {
      console.error(`Fallo actualizando ${row.id}:`, upErr.message);
      process.exit(1);
    }
    migrated += 1;
    console.log(`Migrada empresa_id=${row.empresa_id} (${row.id})`);
  }

  console.log(`Listo. Filas migradas: ${migrated}. Aplique la migración que elimina certificado_password.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
