/**
 * Inspección DB orden Nº 8 (empresa El Papu Store). Sin imports server-only (compatible tsx).
 * Ejecutar: npx tsx scripts/verify-sorteo-ticket-orden8.ts
 */
import path from "path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  resolveEmpresaDataSchema,
  SUPABASE_APP_SCHEMA,
} from "../src/lib/supabase/schema";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const EMPRESA_ID = "5ad0bdda-f94f-446c-9032-1fedf34e8479";
const SCHEMA_EXPECTED = "erp_el_papu_store_5ad0bdda";

/** PostgREST con schema tenant (Supabase JS valida el nombre del schema en cliente). */
async function restSelect<T>(
  baseUrl: string,
  serviceKey: string,
  schema: string,
  table: string,
  query: string
): Promise<T[]> {
  const u = `${baseUrl.replace(/\/$/, "")}/rest/v1/${table}?${query}`;
  const res = await fetch(u, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
      "Accept-Profile": schema,
      "Content-Profile": schema,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 406 && t.includes("PGRST106")) {
      throw new Error(
        "El schema tenant no está en 'Exposed schemas' de Supabase API; no se puede consultar desde este script. Usá el SQL editor o exponé el schema."
      );
    }
    throw new Error(`REST ${table} ${res.status}: ${t.slice(0, 400)}`);
  }
  return (await res.json()) as T[];
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }

  const catalog = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: SUPABASE_APP_SCHEMA },
  });
  const { data: empRow, error: empErr } = await catalog
    .from("empresas")
    .select("data_schema")
    .eq("id", EMPRESA_ID)
    .maybeSingle();
  if (empErr) {
    console.error("empresas:", empErr.message);
    process.exit(1);
  }
  const schema = resolveEmpresaDataSchema((empRow as { data_schema?: string | null } | null)?.data_schema);
  console.log("data_schema:", schema, "| esperado:", SCHEMA_EXPECTED);

  const entradas = await restSelect<Record<string, unknown>>(
    url,
    key,
    schema,
    "sorteo_entradas",
    `empresa_id=eq.${EMPRESA_ID}&numero_orden=eq.8&select=id,numero_orden,nombre_participante,documento,whatsapp_numero,sorteo_id`
  );

  console.log("sorteo_entradas (orden 8):", JSON.stringify(entradas, null, 2));

  const entradaId = (entradas?.[0] as { id?: string } | undefined)?.id;
  if (!entradaId) {
    console.error("No hay entrada con numero_orden = 8.");
    process.exit(1);
  }

  const cups = await restSelect<Record<string, unknown>>(
    url,
    key,
    schema,
    "sorteo_cupones",
    `entrada_id=eq.${entradaId}&select=id,numero_cupon,entrada_id`
  );
  console.log("sorteo_cupones:", JSON.stringify(cups, null, 2));

  const dels = await restSelect<Record<string, unknown>>(
    url,
    key,
    schema,
    "sorteo_ticket_deliveries",
    `entrada_id=eq.${entradaId}&empresa_id=eq.${EMPRESA_ID}&order=template_revision.desc&limit=5&select=id,entrada_id,conversation_id,flow_session_id,payload_snapshot,numero_orden,cliente_nombre,cliente_documento,telefono,cupones,status,storage_path,template_revision`
  );
  console.log("sorteo_ticket_deliveries:", JSON.stringify(dels, null, 2));

  const cupStrs = (cups as { numero_cupon?: unknown }[]).map((c) =>
    String(c.numero_cupon ?? "").trim()
  );
  const ent = entradas![0] as {
    numero_orden?: number;
    nombre_participante?: string | null;
    documento?: string | null;
    whatsapp_numero?: string | null;
  };

  console.log("\n--- Comprobación explícita (datos DB) ---");
  console.log("orden visible como 8:", Number(ent.numero_orden) === 8);
  console.log("cupón 0020 presente:", cupStrs.some((c) => c.includes("0020")));
  console.log("nombre no vacío:", Boolean(String(ent.nombre_participante ?? "").trim()));
  console.log("documento no vacío:", Boolean(String(ent.documento ?? "").trim()));
  console.log("teléfono no vacío:", Boolean(String(ent.whatsapp_numero ?? "").trim()));

  console.log(
    "\nTras el fix, regenerar desde /sorteos/tickets con POST regenerate y abrir signed-url del nuevo storage_path."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
