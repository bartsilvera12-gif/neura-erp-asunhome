/**
 * Auditoría post-fix: flujos WhatsApp activos en catálogo tenant + primer nodo vs runtime.
 * npx tsx scripts/audit-omnichannel-flow-prod.ts
 */
import { config } from "dotenv";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const { Client } = pg;

function getDbUrl(): string {
  const direct = process.env.SUPABASE_DB_URL?.trim();
  if (direct) return direct;
  throw new Error("Falta SUPABASE_DB_URL en .env.local");
}

function quoteIdent(s: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw new Error(`schema inválido: ${s}`);
  return `"${s.replace(/"/g, '""')}"`;
}

async function main() {
  const url = getDbUrl();
  const client = new Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const emp = await client.query<{
    id: string;
    nombre_empresa: string | null;
    data_schema: string | null;
  }>(
    `SELECT id, nombre_empresa, data_schema
     FROM zentra_erp.empresas
     WHERE lower(coalesce(nombre_empresa,'')) LIKE '%papu%'
        OR lower(coalesce(data_schema,'')) LIKE '%papu%'
     ORDER BY nombre_empresa
     LIMIT 10`
  );

  console.log("=== Empresas candidatas (Papu / schema papu) ===\n");
  for (const row of emp.rows) {
    console.log(`• ${row.id} | ${row.nombre_empresa ?? "?"} | data_schema=${row.data_schema ?? "null"}`);
  }

  for (const row of emp.rows) {
    const sch = row.data_schema?.trim();
    if (!sch || sch === "zentra_erp") {
      console.log("\n--- Catálogo zentra_erp para empresa", row.id, "---");
      const flows = await client.query(
        `SELECT flow_code, label, channel, activo, updated_at
         FROM zentra_erp.chat_flows
         WHERE empresa_id = $1
         ORDER BY flow_code`,
        [row.id]
      );
      printFlowsAnalysis(flows.rows as FlowRow[], "zentra_erp");
      await printFirstNodes(client, "zentra_erp", row.id, flows.rows as FlowRow[]);
      continue;
    }

    const qs = quoteIdent(sch);
    console.log(`\n=== Schema tenant ${sch} (empresa ${row.nombre_empresa ?? row.id}) ===`);

    const exists = await client.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.schemata WHERE schema_name = $1
      ) AS ok`,
      [sch]
    );
    if (!(exists.rows[0] as { ok?: boolean }).ok) {
      console.log("Schema no existe en esta base.");
      continue;
    }

    const flows = await client.query(
      `SELECT flow_code, label, channel, activo, updated_at
       FROM ${qs}.chat_flows
       WHERE empresa_id = $1
       ORDER BY flow_code`,
      [row.id]
    );
    printFlowsAnalysis(flows.rows as FlowRow[], sch);
    await printFirstNodes(client, sch, row.id, flows.rows as FlowRow[]);
  }

  await client.end();
}

type FlowRow = {
  flow_code: string;
  label: string | null;
  channel: string | null;
  activo: boolean | null;
  updated_at: string | null;
};

function whatsappEligible(ch: string | null): boolean {
  const t = String(ch ?? "").trim().toLowerCase();
  return !t || t === "whatsapp";
}

function printFlowsAnalysis(rows: FlowRow[], schema: string) {
  const activeWa = rows.filter((r) => r.activo && whatsappEligible(r.channel));
  const codes = [...new Set(activeWa.map((r) => r.flow_code.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  console.log(`Schema ${schema}: total filas catálogo ${rows.length}`);
  console.log(`  Activos WhatsApp (canal null/vacío/whatsapp): ${codes.length}`);
  if (codes.length) {
    console.log(`  Flujo canónico (orden flow_code ASC): ${codes[0]}`);
    console.log(`  Lista: ${codes.join(", ")}`);
  }
  const inactiveOrOther = rows.filter((r) => !r.activo || !whatsappEligible(r.channel));
  if (inactiveOrOther.length) {
    console.log(
      `  Otros/inactivos canal distinto: ${inactiveOrOther.map((r) => `${r.flow_code}(activo=${r.activo},ch=${r.channel ?? "null"})`).join("; ")}`
    );
  }
}

async function printFirstNodes(
  client: pg.Client,
  schema: string,
  empresaId: string,
  flowRows: FlowRow[]
) {
  const qs = schema === "zentra_erp" ? "zentra_erp" : quoteIdent(schema);
  const activeWa = flowRows.filter((r) => r.activo && whatsappEligible(r.channel));
  const codes = [...new Set(activeWa.map((r) => r.flow_code.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  const canonical = codes[0];
  if (!canonical) return;

  const q = `
    SELECT node_code, node_type, sort_order, is_active, message_text IS NOT NULL AS has_msg
    FROM ${qs}.chat_flow_nodes
    WHERE empresa_id = $1 AND flow_code = $2 AND is_active = true
    ORDER BY sort_order ASC NULLS LAST, created_at ASC
    LIMIT 3
  `;
  const nodes = await client.query(q, [empresaId, canonical]);
  console.log(`  Primer nodo(s) activos para flujo canónico «${canonical}» (orden sort_order, created_at):`);
  for (const n of nodes.rows as Record<string, unknown>[]) {
    console.log(
      `    • ${n.node_code} | type=${n.node_type} | sort_order=${n.sort_order} | has_legacy_message=${n.has_msg}`
    );
  }

  const mediaNodes = await client.query(
    `SELECT COUNT(*)::int AS n FROM ${qs}.chat_flow_nodes
     WHERE empresa_id = $1 AND flow_code = $2 AND is_active AND node_type = 'media'`,
    [empresaId, canonical]
  );
  const mc = (mediaNodes.rows[0] as { n?: number })?.n ?? 0;
  if (mc > 0) {
    const blocks = await client.query(
      `SELECT b.block_type, b.media_url IS NOT NULL AS has_url, length(coalesce(b.content_text,'')) AS cap_len
       FROM ${qs}.chat_flow_node_blocks b
       JOIN ${qs}.chat_flow_nodes n ON n.id = b.node_id
       WHERE n.empresa_id = $1 AND n.flow_code = $2 AND n.node_type = 'media' AND n.is_active
       ORDER BY n.sort_order, b.sort_order
       LIMIT 5`,
      [empresaId, canonical]
    );
    console.log(`  Nodos tipo «media» en este flujo: ${mc}; bloques imagen:`);
    for (const b of blocks.rows as Record<string, unknown>[]) {
      console.log(`    • block=${b.block_type} has_url=${b.has_url} caption_len=${b.cap_len}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
