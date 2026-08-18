/**
 * Inserta en supabase_migrations.schema_migrations las versiones locales que
 * faltan en remoto (mismo criterio que `supabase migration list`: prefijo
 * YYYYMMDDHHMMSS + name desde el nombre de archivo).
 *
 * No ejecuta el SQL de las migraciones: solo alinea el historial cuando el
 * DDL ya está aplicado.
 *
 * Uso:
 *   npx tsx scripts/repair-remote-supabase-migration-history.ts
 *   npx tsx scripts/repair-remote-supabase-migration-history.ts --dry-run
 *   npx tsx scripts/repair-remote-supabase-migration-history.ts --only=20260421100000
 */
import { config } from "dotenv";
import { readdirSync } from "fs";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const NC_VERSION = "20260421100000";

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

function parseArgs(): { dryRun: boolean; only: string | null; excludeNc: boolean } {
  const argv = process.argv.slice(2);
  let dryRun = false;
  let only: string | null = null;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    if (a.startsWith("--only=")) only = a.slice("--only=".length).trim();
  }
  const excludeNc = only == null;
  return { dryRun, only, excludeNc };
}

/** version -> migration name (parte tras el prefijo) */
function localMigrationsMap(): Map<string, string> {
  const dir = join(process.cwd(), "supabase", "migrations");
  const re = /^(\d{14})_(.+)\.sql$/;
  const map = new Map<string, string>();
  for (const f of readdirSync(dir)) {
    const m = f.match(re);
    if (!m) continue;
    const v = m[1];
    const n = m[2];
    if (map.has(v)) {
      throw new Error(`Timestamp duplicado en migraciones: ${v}`);
    }
    map.set(v, n);
  }
  return map;
}

async function remoteVersions(client: pg.Client): Promise<Set<string>> {
  const r = await client.query<{ version: string }>(
    `SELECT version FROM supabase_migrations.schema_migrations`
  );
  return new Set(r.rows.map((x) => x.version));
}

async function main() {
  const { dryRun, only, excludeNc } = parseArgs();
  const byVersion = localMigrationsMap();
  const localVersions = [...byVersion.keys()].sort();

  const client = new pg.Client({
    connectionString: getDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const remote = await remoteVersions(client);

  let missing = localVersions.filter((v) => !remote.has(v));
  if (only) {
    if (remote.has(only)) {
      console.log("Nada que reparar para", only, "(ya consta en remoto).");
      await client.end();
      return;
    }
    missing = missing.filter((v) => v === only);
    if (missing.length === 0 && !byVersion.has(only)) {
      throw new Error(`Versión desconocida en repo: ${only}`);
    }
  } else if (excludeNc) {
    missing = missing.filter((v) => v !== NC_VERSION);
  }

  if (missing.length === 0) {
    console.log("Historial remoto ya incluye todas las versiones solicitadas.");
    await client.end();
    return;
  }

  const rows = missing.map((v) => ({ version: v, name: byVersion.get(v)! }));

  console.log(
    dryRun ? "[dry-run] insertaría:" : "Insertando",
    rows.length,
    "filas en supabase_migrations.schema_migrations"
  );
  for (const r of rows) console.log(`  ${r.version} | ${r.name}`);

  if (dryRun) {
    await client.end();
    return;
  }

  for (const r of rows) {
    await client.query(
      `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
       VALUES ($1, $2, ARRAY[]::text[])
       ON CONFLICT (version) DO NOTHING`,
      [r.version, r.name]
    );
  }

  await client.end();
  console.log("OK.");

  if (excludeNc && !only) {
    console.log("\nSiguiente paso: aplicar DDL de nota crédito y registrar 20260421100000 si aún falta:");
    console.log("  npx tsx scripts/apply-nota-credito-fase1-remote.ts");
    console.log("  npx tsx scripts/repair-remote-supabase-migration-history.ts --only=20260421100000");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
