/**
 * Heurística: ¿hay objetos típicos de migraciones "tardías" sin estar en schema_migrations?
 * npx tsx scripts/diagnose-zentra-schema-drift.ts
 */
import { config } from "dotenv";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

function getDbUrl(): string {
  const direct = process.env.SUPABASE_DB_URL?.trim();
  if (direct) return direct;
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const m = base?.match(/https:\/\/([^.]+)\.supabase\.co/i);
  if (!password || !m?.[1]) {
    throw new Error(
      "Falta SUPABASE_DB_URL o (SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL) en .env.local"
    );
  }
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${m[1]}.supabase.co:5432/postgres`;
}

const checks: [string, string][] = [
  ["tabla factura_electronica", "SELECT to_regclass('zentra_erp.factura_electronica') IS NOT NULL"],
  ["tabla empresa_sifen_config", "SELECT to_regclass('zentra_erp.empresa_sifen_config') IS NOT NULL"],
  [
    "función con provision en zentra_erp",
    `SELECT EXISTS (
       SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE n.nspname = 'zentra_erp' AND p.proname ILIKE '%provision%'
     )`,
  ],
  ["columna empresas.data_schema", "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='zentra_erp' AND table_name='empresas' AND column_name='data_schema')"],
  ["tabla chat_flow_sessions", "SELECT to_regclass('zentra_erp.chat_flow_sessions') IS NOT NULL"],
];

async function main() {
  const client = new pg.Client({
    connectionString: getDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const last = await client.query(
    `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3`
  );
  console.log("Últimas migraciones registradas:", last.rows);

  for (const [label, sql] of checks) {
    const r = await client.query(sql);
    const ok = Object.values(r.rows[0] ?? {})[0];
    console.log(ok ? "✓" : "✗", label, "→", ok);
  }

  await client.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
