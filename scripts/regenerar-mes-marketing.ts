/**
 * Regenera todas las tareas automáticas del mes para todos los clientes marketing.
 * Ejecutar: npx tsx scripts/regenerar-mes-marketing.ts [YYYY-MM]
 * Sin argumento usa el mes actual.
 * Requiere: .env.local con NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("❌ Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

async function main() {
  const mes = process.argv[2] || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    console.error("❌ Formato mes inválido. Usar YYYY-MM");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // Obtener empresa_id desde un plan de marketing
  const { data: plan } = await supabase
    .from("planes")
    .select("empresa_id")
    .eq("es_plan_marketing", true)
    .not("plantilla_operativa", "is", null)
    .limit(1)
    .single();

  if (!plan?.empresa_id) {
    console.error("❌ No se encontró plan de marketing con plantilla. Verificá que existan planes configurados.");
    process.exit(1);
  }

  const empresaId = plan.empresa_id;
  console.log(`Regenerando mes ${mes} para empresa ${empresaId}...`);

  const { regenerarMesCompleto } = await import("../src/lib/marketing/generador");
  const resultado = await regenerarMesCompleto({
    empresa_id: empresaId,
    mes,
    supabaseClient: supabase,
  });

  console.log(`\n✅ Listo:`);
  console.log(`   Eliminadas: ${resultado.eliminadas}`);
  console.log(`   Generadas: ${resultado.generadas}`);
  console.log(`   Omitidas: ${resultado.omitidas}`);
  if (resultado.errores.length) console.log(`   Errores:`, resultado.errores);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
