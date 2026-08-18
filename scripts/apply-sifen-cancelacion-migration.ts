/**
 * Aplica supabase/migrations/20260420100000_sifen_cancelacion_factura.sql
 * a cada base definida en archivos de entorno (sin duplicar la misma URL).
 *
 * Lee en orden (solo los que existan):
 *   .env.local, .env.production.local, .env.staging.local, .env.staging, .env.production, .env
 *
 * Por archivo se consideran:
 *   - SUPABASE_DB_URL
 *   - SUPABASE_DB_URL_STAGING, SUPABASE_DB_URL_PRODUCTION, SUPABASE_DB_URL_DEV (opcionales)
 *   - Si no hay URL pero hay SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL, arma URL directa db.<ref>.
 *
 * Uso: npx tsx scripts/apply-sifen-cancelacion-migration.ts
 */
import { config as loadDotenv, parse as parseDotenv } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import pg from "pg";
import { rewriteErpSqlFromPublicToZentra } from "./erp-db";

const { Client } = pg;

const MIGRATION = "20260420100000_sifen_cancelacion_factura.sql";

const EXTRA_URL_KEYS = [
  "SUPABASE_DB_URL_STAGING",
  "SUPABASE_DB_URL_PRODUCTION",
  "SUPABASE_DB_URL_DEV",
  "DATABASE_URL",
  "DIRECT_URL",
] as const;

function buildUrlFromPasswordAndPublic(parsed: Record<string, string>): string | null {
  const password = parsed.SUPABASE_DB_PASSWORD?.trim();
  const base = parsed.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const m = base?.match(/https:\/\/([^.]+)\.supabase\.co/i);
  if (!password || !m?.[1]) return null;
  const ref = m[1];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

function collectUrlsFromParsed(parsed: Record<string, string>): string[] {
  const out: string[] = [];
  const main = parsed.SUPABASE_DB_URL?.trim();
  if (main) out.push(main);
  for (const k of EXTRA_URL_KEYS) {
    const v = parsed[k]?.trim();
    if (v?.startsWith("postgres")) out.push(v);
  }
  const built = buildUrlFromPasswordAndPublic(parsed);
  if (built && !main) out.push(built);
  return out;
}

function loadEnvFilesInOrder(): Record<string, string>[] {
  const names = [
    ".env.local",
    ".env.production.local",
    ".env.staging.local",
    ".env.staging",
    ".env.production",
    ".env",
  ];
  const blocks: Record<string, string>[] = [];
  const cwd = process.cwd();
  for (const name of names) {
    const p = join(cwd, name);
    if (!existsSync(p)) continue;
    blocks.push(parseDotenv(readFileSync(p, "utf-8")));
  }
  if (blocks.length === 0) {
    loadDotenv({ path: join(cwd, ".env.local") });
    const fromProcess: Record<string, string> = {};
    for (const k of ["SUPABASE_DB_URL", "SUPABASE_DB_PASSWORD", "NEXT_PUBLIC_SUPABASE_URL", ...EXTRA_URL_KEYS]) {
      const v = process.env[k];
      if (v != null) fromProcess[k] = v;
    }
    if (Object.keys(fromProcess).length) blocks.push(fromProcess);
  }
  return blocks;
}

async function runOnUrl(url: string, sql: string): Promise<void> {
  const masked = url.replace(/:[^:@/]+@/, ":****@");
  const client = new Client({
    connectionString: url,
    ssl: /supabase\.com|pooler\.supabase/i.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    console.log("Ejecutando migración en:", masked);
    await client.query(sql);
    console.log("  → OK");
  } finally {
    await client.end();
  }
}

async function main() {
  const sqlPath = join(process.cwd(), "supabase", "migrations", MIGRATION);
  const rawSql = readFileSync(sqlPath, "utf-8");
  const sql = rewriteErpSqlFromPublicToZentra(rawSql);

  const blocks = loadEnvFilesInOrder();
  if (blocks.length === 0) {
    throw new Error("No se encontró ningún .env* con variables de base de datos.");
  }

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const parsed of blocks) {
    for (const u of collectUrlsFromParsed(parsed)) {
      if (!u || seen.has(u)) continue;
      seen.add(u);
      urls.push(u);
    }
  }

  if (urls.length === 0) {
    throw new Error(
      "No hay ninguna URL de PostgreSQL (SUPABASE_DB_URL, DIRECT_URL, etc.) en los .env leídos."
    );
  }

  console.log(`Migración: ${MIGRATION}`);
  console.log(`Entornos (URLs únicas): ${urls.length}`);

  for (const url of urls) {
    await runOnUrl(url, sql);
  }

  console.log("Completado en todos los destinos.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
