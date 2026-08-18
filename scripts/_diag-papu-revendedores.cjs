/**
 * Diagnóstico: empresa Papu + tabla sorteo_revendedores en schema tenant.
 */
const path = require("path");
const { config } = require("dotenv");
const pg = require("pg");
config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const EMPRESA_ID = process.argv[2] || "5ad0bdda-f94f-446c-9032-1fedf34e8479";

function quoteIdent(s) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error("schema inválido");
  return '"' + s.replace(/"/g, '""') + '"';
}

async function main() {
  const url = process.env.SUPABASE_DB_URL?.trim() || process.env.DIRECT_URL?.trim();
  if (!url) {
    console.error("Falta SUPABASE_DB_URL o DIRECT_URL");
    process.exit(2);
  }
  const c = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await c.connect();
  try {
    const e = await c.query(
      `SELECT id, nombre_empresa, data_schema FROM zentra_erp.empresas WHERE id = $1::uuid`,
      [EMPRESA_ID]
    );
    console.log("--- empresa ---");
    console.log(e.rows[0] || "NOT FOUND");
    const row = e.rows[0];
    const schema =
      row?.data_schema && String(row.data_schema).trim()
        ? String(row.data_schema).trim()
        : "zentra_erp";
    console.log({ schema_efectivo: schema });

    const qs = quoteIdent(schema);
    const exists = await c.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = 'sorteo_revendedores'
      ) AS table_exists`,
      [schema]
    );
    console.log("sorteo_revendedores exists:", exists.rows[0]?.table_exists);

    if (exists.rows[0]?.table_exists) {
      const cnt = await c.query(
        `SELECT count(*)::int AS n FROM ${qs}.sorteo_revendedores WHERE empresa_id = $1::uuid`,
        [EMPRESA_ID]
      );
      console.log("filas revendedores empresa:", cnt.rows[0]?.n);
    }

    const sorteos = await c.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = 'sorteos'
      ) AS t`,
      [schema]
    );
    console.log("sorteos table exists:", sorteos.rows[0]?.t);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
