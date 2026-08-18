/**
 * Valida que el catálogo `modulos` (schema zentra_erp vía service role) incluya
 * `notas_credito` tras la misma lógica que GET /api/admin/modulos.
 *
 * Uso (PowerShell, desde la raíz del repo):
 *   npx tsx scripts/verify-admin-catalog-notas-credito.ts
 *
 * Requiere `.env.local` con NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
 */
import * as path from "path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleClientOptions } from "../src/lib/supabase/schema";
import { ensureNotasCreditoModuloInCatalog } from "../src/lib/modulos/ensure-notas-credito-modulo-catalog";

config({ path: path.join(process.cwd(), ".env.local") });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, key, { ...supabaseServiceRoleClientOptions });

  const ensured = await ensureNotasCreditoModuloInCatalog(supabase);
  if (!ensured.ok) {
    console.error("ensureNotasCreditoModuloInCatalog:", ensured.message);
    process.exit(1);
  }

  const { data: rows, error } = await supabase.from("modulos").select("id, nombre, slug").eq("slug", "notas_credito");
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!rows?.length) {
    console.error("No se encontró slug notas_credito tras ensure.");
    process.exit(1);
  }

  console.log("OK: catálogo modulos incluye Notas de crédito:", rows[0]);
  process.exit(0);
}

void main();
