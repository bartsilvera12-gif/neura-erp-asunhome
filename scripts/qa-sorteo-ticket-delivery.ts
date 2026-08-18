/**
 * QA: 1) SQL directo → ticket_delivery_mode del sorteo
 *     2) POST /api/qa/sorteo-ticket-delivery (servidor Next debe estar arriba con el mismo .env)
 *
 * Variables en .env.local:
 *   SUPABASE_DB_URL — consulta PG bloque 1
 *   QA_SORTEO_TICKET_SECRET — debe coincidir con el servidor
 *   QA_API_BASE_URL — default http://localhost:3000
 *
 * Uso:
 *   npm run qa:sorteo-ticket -- --dry-run
 *   npm run qa:sorteo-ticket
 *
 * Sin servidor local: desplegar main y apuntar QA_API_BASE_URL + QA_SORTEO_TICKET_SECRET en Vercel.
 */
import { config } from "dotenv";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local"), override: true });

const EMPRESA_ID = "5ad0bdda-f94f-446c-9032-1fedf34e8479";
const SCHEMA_EXPECTED = "erp_el_papu_store_5ad0bdda";
const SORTEO_ID = "38a8cb18-6493-4d3b-b91f-e00df87f3d90";
const ENTRADA_ID = "f06195ff-2f17-4598-91d1-a1d79480714e";
const CONVERSATION_ID = "0d9973b1-181f-4939-99cc-3ec1a861b889";
const CHANNEL_ID = "77aa799e-be84-4d18-878a-7c540779c85b";

function qi(ident: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(ident)) throw new Error(`ident inválido: ${ident}`);
  return `"${ident.replace(/"/g, '""')}"`;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");

  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  if (!dbUrl) {
    console.error("Falta SUPABASE_DB_URL en .env.local para el bloque SQL.");
    process.exit(1);
  }

  const base = (process.env.QA_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

  console.log("\n=== 1) Schema catálogo (empresas.data_schema) ===");
  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    max: 2,
  });
  const client = await pool.connect();
  let schema: string;
  try {
    const er = await client.query<{ data_schema: string | null }>(
      `SELECT data_schema FROM ${qi("zentra_erp")}.empresas WHERE id = $1::uuid`,
      [EMPRESA_ID]
    );
    schema = String(er.rows[0]?.data_schema ?? "").trim() || "zentra_erp";
    console.log({ empresaId: EMPRESA_ID, data_schema: schema, expected_like: SCHEMA_EXPECTED });

    console.log("\n=== 2) Sorteo en tenant (SQL directo) ===");
    const sr = await client.query<{
      ticket_delivery_mode: string | null;
      ticket_image_config: unknown;
      nombre: string | null;
    }>(
      `SELECT nombre, ticket_delivery_mode, ticket_image_config
       FROM ${qi(schema)}.sorteos WHERE id = $1::uuid LIMIT 1`,
      [SORTEO_ID]
    );
    console.log(JSON.stringify(sr.rows[0] ?? null, null, 2));
  } finally {
    client.release();
    await pool.end();
  }

  const secret = process.env.QA_SORTEO_TICKET_SECRET?.trim();
  if (!secret) {
    console.error(
      "\n(Opcional bloque 3) Falta QA_SORTEO_TICKET_SECRET — agregalo para llamar /api/qa/sorteo-ticket-delivery."
    );
    process.exit(0);
  }

  console.log("\n=== 3) POST API qa (requiere `npm run dev` o deploy con QA_SORTEO_TICKET_SECRET) ===");
  console.log({ url: `${base}/api/qa/sorteo-ticket-delivery`, dryRun });

  const res = await fetch(`${base}/api/qa/sorteo-ticket-delivery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      empresaId: EMPRESA_ID,
      entradaId: ENTRADA_ID,
      conversationId: CONVERSATION_ID,
      channelId: CHANNEL_ID,
      dryRun,
    }),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    console.error("Respuesta no JSON:", text.slice(0, 500));
    process.exit(1);
  }
  console.log(JSON.stringify(json, null, 2));

  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
