/**
 * Compara migraciones locales (supabase/migrations/*.sql) con
 * supabase_migrations.schema_migrations en la BD de .env.local.
 *
 * npx tsx scripts/diagnose-migration-history.ts
 */
import { config } from "dotenv";
import { readdirSync } from "fs";
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

async function main() {
  const url = getDbUrl();
  const masked = url.replace(/:[^:@]+@/, ":****@");
  console.log("Conectando a:", masked.split("@")[1] ?? masked);

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const cols = await client.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
     ORDER BY ordinal_position`
  );
  console.log("\nColumnas supabase_migrations.schema_migrations:", cols.rows);

  const remote = await client.query<{ version: string; name: string }>(
    `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version`
  );
  const remoteSet = new Set(remote.rows.map((r) => r.version));
  const remotePairs = new Map(remote.rows.map((r) => [r.version, r.name]));
  console.log("\nTodas las filas remotas (version | name):");
  for (const r of remote.rows) {
    console.log(r.version, "|", r.name);
  }

  const dir = join(process.cwd(), "supabase", "migrations");
  const localFiles = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const localVersionRe = /^(\d{14})_(.+)\.sql$/;
  const localByVersion = new Map<string, string>();
  for (const f of localFiles) {
    const m = f.match(localVersionRe);
    if (!m) continue;
    localByVersion.set(m[1], m[2]);
  }

  const missingInRemote = [...localByVersion.keys()].filter((v) => !remoteSet.has(v)).sort();
  const extraInRemote = [...remoteSet].filter((v) => !localByVersion.has(v)).sort();

  console.log("\n=== Resumen (comparación por prefijo YYYYMMDDHHMMSS) ===");
  console.log("Migraciones locales (únicas por versión):", localByVersion.size, "| Registradas en remoto:", remote.rows.length);
  console.log("\nVersiones en disco pero NO en schema_migrations (primeras 40):");
  console.log(missingInRemote.slice(0, 40).join("\n") || "(ninguna)");
  if (missingInRemote.length > 40) console.log(`... y ${missingInRemote.length - 40} más`);

  console.log("\nVersiones en remoto sin archivo local con ese prefijo:");
  console.log(extraInRemote.join("\n") || "(ninguna)");

  const nc = "20260421100000";
  console.log("\n=== Nota crédito fase1 ===");
  console.log("Registrada en remoto (versión):", remoteSet.has(nc), remotePairs.get(nc) ? `(${remotePairs.get(nc)})` : "");

  const fn = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE n.nspname = 'zentra_erp' AND p.proname = 'neura_install_nota_credito_tables'
     ) AS ok`
  );
  console.log("Función zentra_erp.neura_install_nota_credito_tables existe:", fn.rows[0]?.ok);

  const tbl = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'zentra_erp' AND table_name = 'nota_credito'
     ) AS ok`
  );
  console.log("Tabla zentra_erp.nota_credito existe:", tbl.rows[0]?.ok);

  await client.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
