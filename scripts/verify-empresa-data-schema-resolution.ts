/**
 * 1) Unit: resolveEmpresaDataSchema(null|""|erp_*) → zentra_erp o tenant.
 * 2) DB (opcional): empresas con data_schema null deben seguir existiendo en zentra_erp (legado).
 *
 * npx tsx scripts/verify-empresa-data-schema-resolution.ts
 */
import assert from "node:assert";
import { config } from "dotenv";
import path from "node:path";
import pg from "pg";
import { resolveEmpresaDataSchema, SUPABASE_APP_SCHEMA } from "../src/lib/supabase/schema";

config({ path: path.resolve(process.cwd(), ".env.local") });

const url =
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  process.env.SUPABASE_DB_URL?.trim();

function unitTests() {
  assert.strictEqual(resolveEmpresaDataSchema(null), SUPABASE_APP_SCHEMA);
  assert.strictEqual(resolveEmpresaDataSchema(undefined), SUPABASE_APP_SCHEMA);
  assert.strictEqual(resolveEmpresaDataSchema(""), SUPABASE_APP_SCHEMA);
  assert.strictEqual(resolveEmpresaDataSchema("   "), SUPABASE_APP_SCHEMA);
  assert.strictEqual(resolveEmpresaDataSchema("erp_demo_abc"), "erp_demo_abc");
  assert.strictEqual(resolveEmpresaDataSchema("  erp_x  "), "erp_x");
  console.log("OK: resolveEmpresaDataSchema unit tests");
}

async function dbLegacySample() {
  if (!url) {
    console.log("Sin DIRECT_URL: omito chequeo SQL legado");
    return;
  }
  const c = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await c.connect();
  try {
    const r = await c.query<{ n: string; cnt: string }>(
      `select e.nombre_empresa::text as n, count(c.id)::text as cnt
       from zentra_erp.empresas e
       left join zentra_erp.clientes c on c.empresa_id = e.id
       where e.data_schema is null
       group by e.id, e.nombre_empresa
       order by e.nombre_empresa
       limit 5`
    );
    console.log("Empresas legacy (data_schema IS NULL) + filas clientes en zentra_erp (muestra):");
    if (r.rows.length === 0) {
      console.log("  (ninguna con data_schema null en muestra)");
    } else {
      for (const row of r.rows) {
        console.log(`  ${row.n}: clientes en zentra_erp = ${row.cnt}`);
      }
    }
  } finally {
    await c.end();
  }
}

async function main() {
  unitTests();
  await dbLegacySample();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
