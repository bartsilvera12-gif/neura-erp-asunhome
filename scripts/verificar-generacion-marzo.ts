/**
 * Verificación: generación de tareas marketing marzo 2026
 *
 * - Obtiene planes marketing con plantilla de la DB
 * - Para cada item semanal, calcula fechas esperadas con fechasParaItemSemanal
 * - Compara con tareas en marketing_tasks para cliente DE LA MORA
 * - Reporta discrepancias
 *
 * Ejecutar: npx tsx scripts/verificar-generacion-marzo.ts
 * Requiere: .env.local con NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import { config } from "dotenv";
import { fechasParaItemSemanal } from "../src/lib/marketing/generador";
import type { PlanMarketingItem, PlanMarketingPlantilla } from "../src/lib/planes/types";

config({ path: path.join(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("❌ Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MES_VERIFICAR = "2026-03";
const [ANO, MES] = MES_VERIFICAR.split("-").map(Number);

interface ItemConFechas {
  item: PlanMarketingItem;
  fechasEsperadas: string[];
}

function fechasEsperadasParaPlan(plantilla: PlanMarketingPlantilla | null): ItemConFechas[] {
  if (!plantilla?.items?.length) return [];
  const resultado: ItemConFechas[] = [];
  for (const item of plantilla.items) {
    if (item.periodicidad === "semanal") {
      const fechas = fechasParaItemSemanal(ANO, MES, item);
      resultado.push({ item, fechasEsperadas: fechas });
    }
  }
  return resultado;
}

function slotKey(clienteId: string, fecha: string, tipo: string): string {
  return `${clienteId}|${fecha}|${tipo}`;
}

async function main() {
  console.log("=== Verificación generación Marketing - Marzo 2026 ===\n");

  // 1. Planes marketing con plantilla
  const { data: planes, error: errPlanes } = await supabase
    .from("planes")
    .select("id, nombre, plantilla_operativa")
    .eq("es_plan_marketing", true);

  if (errPlanes) {
    console.error("Error planes:", errPlanes.message);
    process.exit(1);
  }

  const planesConPlantilla = (planes ?? []).filter(
    (p) => (p.plantilla_operativa as { items?: unknown[] })?.items?.length
  );

  if (planesConPlantilla.length === 0) {
    console.log("⚠️ No hay planes marketing con plantilla");
    process.exit(1);
  }

  console.log("1️⃣ PLANES MARKETING CON PLANTILLA");
  for (const plan of planesConPlantilla) {
    const plantilla = plan.plantilla_operativa as PlanMarketingPlantilla;
    const itemsSemanal = fechasEsperadasParaPlan(plantilla);
    console.log(`   - ${plan.nombre} (id: ${plan.id})`);
    for (const { item, fechasEsperadas } of itemsSemanal) {
      const diasNombres = (item.dias_semana ?? []).map((d) => DIAS[d]).join(", ");
      console.log(`     • ${item.tipo_contenido}: dias_semana=[${diasNombres}] → ${fechasEsperadas.length} fechas en marzo`);
      if (fechasEsperadas.length <= 15) {
        console.log(`       Fechas: ${fechasEsperadas.join(", ")}`);
      } else {
        console.log(`       Fechas (primeras 5): ${fechasEsperadas.slice(0, 5).join(", ")} ...`);
        console.log(`       Fechas (últimas 5): ... ${fechasEsperadas.slice(-5).join(", ")}`);
      }
    }
    console.log("");
  }

  // 2. Cliente DE LA MORA
  const { data: clientes, error: errCliente } = await supabase
    .from("clientes")
    .select("id, empresa, nombre_contacto")
    .or("empresa.ilike.%DE LA MORA%,nombre_contacto.ilike.%DE LA MORA%")
    .is("deleted_at", null);

  if (errCliente || !clientes?.length) {
    console.log("⚠️ Cliente DE LA MORA no encontrado. No se puede comparar tareas.");
    console.log("   La lógica de fechasParaItemSemanal se verificó arriba.");
    process.exit(0);
  }

  const cliente = clientes[0];
  console.log("2️⃣ CLIENTE DE LA MORA");
  console.log(`   id: ${cliente.id}, empresa: ${cliente.empresa}\n`);

  // 3. Suscripción activa del cliente
  const { data: suscripciones } = await supabase
    .from("suscripciones")
    .select("id, plan_id")
    .eq("cliente_id", cliente.id)
    .eq("estado", "activa")
    .not("plan_id", "is", null)
    .limit(1);

  const susc = suscripciones?.[0];
  if (!susc?.plan_id) {
    console.log("⚠️ Cliente sin suscripción activa. No se puede comparar tareas.");
    process.exit(0);
  }

  const plan = planesConPlantilla.find((p) => p.id === susc.plan_id);
  if (!plan) {
    console.log("⚠️ Plan de la suscripción no encontrado en la lista de planes marketing.");
    process.exit(0);
  }

  const plantilla = plan.plantilla_operativa as PlanMarketingPlantilla;
  const itemsConFechas = fechasEsperadasParaPlan(plantilla);

  // Construir set esperado: { cliente_id|fecha|tipo }
  const esperados = new Set<string>();
  for (const { item } of itemsConFechas) {
    for (const fecha of fechasParaItemSemanal(ANO, MES, item)) {
      esperados.add(slotKey(cliente.id, fecha, item.tipo_contenido));
    }
  }

  // 4. Tareas en marketing_tasks (marzo 2026, automáticas)
  const { data: tareas, error: errTareas } = await supabase
    .from("marketing_tasks")
    .select("fecha_entrega, tipo_contenido, generada_automaticamente")
    .eq("cliente_id", cliente.id)
    .gte("fecha_entrega", "2026-03-01")
    .lte("fecha_entrega", "2026-03-31")
    .eq("generada_automaticamente", true);

  if (errTareas) {
    console.error("Error tareas:", errTareas.message);
    process.exit(1);
  }

  const enDb = new Set(
    (tareas ?? []).map((t) => slotKey(cliente.id, t.fecha_entrega, t.tipo_contenido))
  );

  // 5. Comparación
  console.log("3️⃣ COMPARACIÓN DE LA MORA - Marzo 2026");
  console.log(`   Esperados (según plantilla): ${esperados.size} slots`);
  console.log(`   En DB (automáticas): ${enDb.size} tareas\n`);

  const faltantes: string[] = [];
  const sobrantes: string[] = [];

  for (const key of esperados) {
    if (!enDb.has(key)) faltantes.push(key);
  }
  for (const key of enDb) {
    if (!esperados.has(key)) sobrantes.push(key);
  }

  if (faltantes.length === 0 && sobrantes.length === 0) {
    console.log("✅ COINCIDE: Las tareas en DB coinciden con lo esperado por la plantilla.");
    process.exit(0);
  }

  console.log("⚠️ DISCREPANCIAS ENCONTRADAS:\n");
  if (faltantes.length > 0) {
    console.log(`   Faltantes en DB (esperados por plantilla): ${faltantes.length}`);
    faltantes.slice(0, 20).forEach((k) => console.log(`     - ${k}`));
    if (faltantes.length > 20) console.log(`     ... y ${faltantes.length - 20} más`);
    console.log("");
  }
  if (sobrantes.length > 0) {
    console.log(`   Sobrantes en DB (no en plantilla actual): ${sobrantes.length}`);
    sobrantes.slice(0, 20).forEach((k) => console.log(`     - ${k}`));
    if (sobrantes.length > 20) console.log(`     ... y ${sobrantes.length - 20} más`);
  }

  process.exit(faltantes.length > 0 || sobrantes.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
