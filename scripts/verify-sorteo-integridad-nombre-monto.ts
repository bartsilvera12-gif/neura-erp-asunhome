/**
 * Verifica integridad sorteo: parseo nombre vs nombre_completo obsoleto, monto promo,
 * y RPC sorteos_ensure_order_from_chat con monto_compra (DB real .env.local).
 *
 * npx tsx scripts/verify-sorteo-integridad-nombre-monto.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import {
  parseSorteoParticipantFromFlowData,
  parseSorteoPricingFromFlowData,
} from "../src/lib/sorteos/sorteo-order-from-chat";

config({ path: ".env.local" });

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FALLO:", msg);
    process.exit(1);
  }
}

async function main() {
  console.log("--- 1) Parse participante: nombre+apellido gana sobre nombre_completo viejo ---");
  const part = parseSorteoParticipantFromFlowData({
    cantidad: "3",
    sorteo_cantidad_opcion: "3",
    nombre_completo: "Ruben Gonzalez",
    nombre: "Carlos",
    apellido: "Pedrizo",
    cedula: "4777888",
  });
  assert(part != null, "participante no null");
  assert(
    part!.nombre_completo === "Carlos Pedrizo",
    `nombre debe ser Carlos Pedrizo, obtuvo: ${part!.nombre_completo}`
  );
  assert(part!.cedula === "4777888", `cédula 4777888, obtuvo: ${part!.cedula}`);
  assert(part!.cantidad_boletos === 3, `cantidad 3, obtuvo: ${part!.cantidad_boletos}`);
  console.log("OK parse participante (anti-mezcla nombre_completo).");

  console.log("--- 2) Parse pricing: 3×50k promo vs monto lista 60k ---");
  const pr = parseSorteoPricingFromFlowData({
    cantidad: "3",
    precio_fuente: "promo",
    sorteo_monto_opcion: "50000",
    monto: "60000",
  });
  assert(pr.montoCompra === 50000, `montoCompra 50000, obtuvo: ${pr.montoCompra}`);
  console.log("OK parse pricing (sorteo_monto_opcion).");

  console.log("--- 3) RPC: cantidad 3 + monto_compra 50000 → monto_total 50000 (no 3×precio lista) ---");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: sorteo, error: sErr } = await sb
    .from("sorteos")
    .select("id, empresa_id, precio_por_boleto, estado")
    .eq("estado", "activo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sErr || !sorteo) {
    console.error("No hay sorteo activo:", sErr?.message);
    process.exit(1);
  }

  const listaEsperada = Number(sorteo.precio_por_boleto) * 3;
  console.log(
    `   Sorteo precio_por_boleto=${sorteo.precio_por_boleto} → lista 3 boletos sería ${listaEsperada} (debe ignorarse si hay promo)`
  );

  const { data: conv } = await sb
    .from("chat_conversations")
    .select("id")
    .eq("empresa_id", sorteo.empresa_id as string)
    .limit(1)
    .maybeSingle();

  const convId = (conv?.id as string) ?? "00000000-0000-4000-8000-000000000001";
  const testKey = `rpc_integridad_promo_${Date.now()}`;

  const { data: rpcData, error: rpcErr } = await sb.rpc("sorteos_ensure_order_from_chat", {
    p: {
      empresa_id: sorteo.empresa_id,
      sorteo_id: sorteo.id,
      chat_conversation_id: convId,
      flow_code: "rpc_integridad_verify",
      idempotency_key: testKey,
      whatsapp_numero: "595981999888",
      nombre_completo: "Integridad Promo RPC",
      cedula: "9999999",
      ciudad: "Asunción",
      cantidad_boletos: 3,
      monto_compra: 50000,
      promo_nombre: "3 por 50k verificación",
      comprobante_url: "https://example.com/verify-promo.pdf",
      validado_por: "verify-sorteo-integridad",
    },
  });

  if (rpcErr) {
    console.error("RPC error:", rpcErr.message);
    process.exit(2);
  }

  const row = rpcData as {
    ok?: boolean;
    message?: string;
    entrada?: { monto_total?: number; cantidad_boletos?: number; precio_fuente?: string };
  } | null;

  assert(row?.ok === true, `RPC ok, message: ${row?.message}`);
  const mt = row?.entrada?.monto_total;
  assert(
    mt === 50000,
    `entrada.monto_total debe ser 50000, obtuvo: ${mt} (lista hubiera sido ${listaEsperada})`
  );
  console.log("OK RPC monto_total=50000 con cantidad 3.");
  console.log("\nResumen: nombre (split > nombre_completo), monto promo en parse y en RPC verificados.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
