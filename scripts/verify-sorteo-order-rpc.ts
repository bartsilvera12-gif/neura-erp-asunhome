/**
 * Verifica RPC sorteos_ensure_order_from_chat contra la DB del .env.local (service role).
 * Ejecutar: npx tsx scripts/verify-sorteo-order-rpc.ts
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { count: beforeE } = await sb
    .from("sorteo_entradas")
    .select("*", { count: "exact", head: true });
  const { count: beforeC } = await sb
    .from("sorteo_cupones")
    .select("*", { count: "exact", head: true });
  console.log("Antes — sorteo_entradas:", beforeE ?? "?", "sorteo_cupones:", beforeC ?? "?");

  const { data: sorteo, error: sErr } = await sb
    .from("sorteos")
    .select("id, empresa_id, estado, max_boletos, total_boletos_vendidos, precio_por_boleto, ultimo_numero_cupon, ultimo_numero_orden")
    .eq("estado", "activo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sErr || !sorteo) {
    console.error("No hay sorteo activo o error:", sErr?.message);
    process.exit(1);
  }

  const empresaId = sorteo.empresa_id as string;
  const sorteoId = sorteo.id as string;

  const { data: conv, error: cErr } = await sb
    .from("chat_conversations")
    .select("id")
    .eq("empresa_id", empresaId)
    .limit(1)
    .maybeSingle();

  const convId = (conv?.id as string) ?? "00000000-0000-4000-8000-000000000001";

  const testKey = `rpc_verify_${Date.now()}`;
  const payload = {
    empresa_id: empresaId,
    sorteo_id: sorteoId,
    chat_conversation_id: convId,
    flow_code: "rpc_verify_flow",
    idempotency_key: testKey,
    whatsapp_numero: "595981000000",
    nombre_completo: "Verificación RPC Neura",
    cedula: "1234567",
    ciudad: "Asunción",
    cantidad_boletos: 1,
    // Opcional (promo): monto_compra, promo_nombre, precio_regular_referencia
    comprobante_url: "https://example.com/comprobante-test.pdf",
    validado_por: "rpc_verify_script",
  };

  const { data: rpcData, error: rpcErr } = await sb.rpc("sorteos_ensure_order_from_chat", { p: payload });

  console.log("RPC error:", rpcErr?.message ?? null);
  console.log("RPC data:", JSON.stringify(rpcData, null, 2));

  const { count: afterE } = await sb
    .from("sorteo_entradas")
    .select("*", { count: "exact", head: true });
  const { count: afterC } = await sb
    .from("sorteo_cupones")
    .select("*", { count: "exact", head: true });
  console.log("Después — sorteo_entradas:", afterE ?? "?", "sorteo_cupones:", afterC ?? "?");

  const row = rpcData as { ok?: boolean; message?: string } | null;
  if (!row?.ok) {
    console.error("FALLO: RPC no devolvió ok:true");
    process.exit(2);
  }
  console.log("OK: RPC creó orden (revisar data.entrada / cupones arriba).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
