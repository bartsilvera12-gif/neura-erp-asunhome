/**
 * Diagnóstico: plantilla PLAN EMPRENDEDOR, tareas DE LA MORA marzo 2026
 *
 * Ejecutar: npx tsx scripts/diagnostico-marketing-plantilla.ts
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

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

async function main() {
  console.log("=== Diagnóstico Marketing: PLAN EMPRENDEDOR / DE LA MORA / Marzo 2026 ===\n");

  // 1. Plan PLAN EMPRENDEDOR
  const { data: planes, error: errPlan } = await supabase
    .from("planes")
    .select("id, nombre, codigo_plan, plantilla_operativa, updated_at")
    .ilike("nombre", "%PLAN EMPRENDEDOR%");

  if (errPlan) {
    console.error("Error planes:", errPlan.message);
    return;
  }

  if (!planes?.length) {
    console.log("⚠️ No se encontró plan con nombre 'PLAN EMPRENDEDOR'");
    return;
  }

  const plan = planes[0];
  console.log("1️⃣ PLAN ENCONTRADO");
  console.log("   id:", plan.id);
  console.log("   nombre:", plan.nombre);
  console.log("   updated_at:", plan.updated_at);
  console.log("   plantilla_operativa (raw):", JSON.stringify(plan.plantilla_operativa, null, 2));

  const plantilla = plan.plantilla_operativa as { items?: { tipo_contenido: string; dias_semana?: number[]; cantidad?: number }[] } | null;
  if (plantilla?.items?.length) {
    console.log("\n   Items de plantilla:");
    for (const item of plantilla.items) {
      const dias = item.dias_semana ?? [];
      const diasNombres = dias.map((d) => DIAS[d]).join(", ");
      console.log(`   - ${item.tipo_contenido}: cantidad=${item.cantidad}, dias_semana=[${dias.join(", ")}] (${diasNombres})`);
    }
  }

  // 2. Cliente DE LA MORA
  const { data: clientes, error: errCliente } = await supabase
    .from("clientes")
    .select("id, empresa, nombre_contacto")
    .or("empresa.ilike.%DE LA MORA%,nombre_contacto.ilike.%DE LA MORA%")
    .is("deleted_at", null);

  if (errCliente) {
    console.error("\nError clientes:", errCliente.message);
    return;
  }

  if (!clientes?.length) {
    console.log("\n⚠️ No se encontró cliente 'DE LA MORA'");
    return;
  }

  const cliente = clientes[0];
  console.log("\n2️⃣ CLIENTE ENCONTRADO");
  console.log("   id:", cliente.id);
  console.log("   empresa:", cliente.empresa);
  console.log("   nombre_contacto:", cliente.nombre_contacto);

  // 3. Tareas automáticas del cliente en marzo 2026
  const { data: tareas, error: errTareas } = await supabase
    .from("marketing_tasks")
    .select("id, fecha_entrega, tipo_contenido, generada_automaticamente, plan_id, created_at")
    .eq("cliente_id", cliente.id)
    .gte("fecha_entrega", "2026-03-01")
    .lte("fecha_entrega", "2026-03-31")
    .order("fecha_entrega");

  if (errTareas) {
    console.error("\nError tareas:", errTareas.message);
    return;
  }

  const tareasAuto = (tareas ?? []).filter((t) => t.generada_automaticamente);
  const tareasManual = (tareas ?? []).filter((t) => !t.generada_automaticamente);

  console.log("\n3️⃣ TAREAS MARZO 2026");
  console.log("   Total:", tareas?.length ?? 0);
  console.log("   Automáticas:", tareasAuto.length);
  console.log("   Manuales:", tareasManual.length);

  if (tareasAuto.length) {
    const porDia = new Map<string, string[]>();
    for (const t of tareasAuto) {
      const d = t.fecha_entrega?.slice(8) ?? "?";
      const list = porDia.get(d) ?? [];
      list.push(t.tipo_contenido ?? "");
      porDia.set(d, list);
    }
    const diasConTareas = [...porDia.keys()].sort((a, b) => Number(a) - Number(b));
    console.log("   Días con tareas auto:", diasConTareas.join(", "));
    console.log("   Ejemplo detalle (primeras 5):");
    for (const t of tareasAuto.slice(0, 5)) {
      const diaSem = new Date(t.fecha_entrega + "T12:00:00Z").getUTCDay();
      console.log(`     ${t.fecha_entrega} (${DIAS[diaSem]}) - ${t.tipo_contenido} - created_at: ${t.created_at}`);
    }
  }

  // 4. Comparación: plan updated_at vs tareas created_at
  const planUpdated = plan.updated_at ? new Date(plan.updated_at).getTime() : 0;
  const tareasMinCreated = tareasAuto.length
    ? Math.min(...tareasAuto.map((t) => new Date(t.created_at).getTime()))
    : 0;
  const tareasMaxCreated = tareasAuto.length
    ? Math.max(...tareasAuto.map((t) => new Date(t.created_at).getTime()))
    : 0;

  console.log("\n4️⃣ CRONOLOGÍA");
  console.log("   Plan updated_at:", plan.updated_at);
  console.log("   Tareas auto: primera created_at", tareasAuto.length ? new Date(tareasMinCreated).toISOString() : "N/A");
  console.log("   Tareas auto: última created_at", tareasAuto.length ? new Date(tareasMaxCreated).toISOString() : "N/A");
  const tareasGeneradasAntesDePlanEdit = tareasAuto.length && planUpdated > tareasMaxCreated;
  console.log("   ¿Tareas generadas ANTES de la última edición del plan?", tareasGeneradasAntesDePlanEdit ? "SÍ" : "NO");

  // 5. Comportamiento del sync
  console.log("\n5️⃣ SYNC ACTUAL");
  console.log("   El sync solo AGREGA tareas en slots vacíos. No borra ni regenera existentes.");
  console.log("   Si hay tareas viejas (ej. solo Dom/Lun/Mié), seguirán ahí. Solo se agregarían las que faltan.");

  // 6. Diagnóstico final
  console.log("\n6️⃣ DIAGNÓSTICO");
  const plantillaDias = new Set<number>();
  for (const item of plantilla?.items ?? []) {
    for (const d of item.dias_semana ?? []) plantillaDias.add(d);
  }
  const tareasDias = new Set<number>();
  for (const t of tareasAuto) {
    const dia = new Date((t as { fecha_entrega: string }).fecha_entrega + "T12:00:00Z").getUTCDay();
    tareasDias.add(dia);
  }

  const plantillaTieneJuevesViernes = plantillaDias.has(4) || plantillaDias.has(5);
  const tareasSoloDomLunMie = tareasDias.size > 0 && ![4, 5, 6].some((d) => tareasDias.has(d));

  if (plantillaTieneJuevesViernes && tareasSoloDomLunMie) {
    console.log("   ➡️ CAUSA MÁS PROBABLE: tareas viejas no regeneradas.");
    console.log("   La plantilla tiene jueves/viernes/sábado configurados, pero las tareas existentes");
    console.log("   solo cubren Dom/Lun/Mié (generadas con versión anterior o con bug del slice).");
    console.log("   El sync no regenera: respeta slots ocupados y solo agrega faltantes.");
  } else if (!plantillaTieneJuevesViernes && tareasSoloDomLunMie) {
    console.log("   La plantilla NO tiene jueves/viernes. Si esperabas más días, hay que editar el plan.");
  } else {
    console.log("   Plantilla días:", [...plantillaDias].sort().map((d) => DIAS[d]).join(", "));
    console.log("   Tareas en días:", [...tareasDias].sort().map((d) => DIAS[d]).join(", "));
  }
}

main().catch(console.error);
