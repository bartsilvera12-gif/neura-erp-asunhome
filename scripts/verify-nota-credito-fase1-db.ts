/**
 * Valida tablas NC fase 1, RLS, índices y constraints en zentra_erp y en schemas tenant.
 *
 * npx tsx scripts/verify-nota-credito-fase1-db.ts
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

async function assertTable(
  client: pg.Client,
  schema: string,
  table: string,
  label: string
): Promise<boolean> {
  const r = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2
     ) AS ok`,
    [schema, table]
  );
  const ok = Boolean(r.rows[0]?.ok);
  console.log(ok ? "✓" : "✗", label);
  return ok;
}

async function countPolicies(client: pg.Client, schema: string, table: string): Promise<number> {
  const r = await client.query(
    `SELECT count(*)::int AS c FROM pg_policies
     WHERE schemaname = $1 AND tablename = $2`,
    [schema, table]
  );
  return r.rows[0]?.c ?? 0;
}

async function hasUniquePartialNc(client: pg.Client, schema: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM pg_indexes
     WHERE schemaname = $1 AND indexname = 'uq_nota_credito_factura_estado_activo'`,
    [schema]
  );
  return r.rows.length > 0;
}

async function main() {
  const client = new pg.Client({
    connectionString: getDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const schemas: string[] = ["zentra_erp"];
  const tenants = await client.query<{ ds: string }>(
    `SELECT DISTINCT btrim(data_schema) AS ds
     FROM zentra_erp.empresas
     WHERE data_schema IS NOT NULL AND btrim(data_schema) <> ''
       AND btrim(data_schema) <> 'zentra_erp'
       AND btrim(data_schema) ~ '^erp_[a-z0-9_]+$'
     ORDER BY 1
     LIMIT 12`
  );
  for (const row of tenants.rows) {
    const exists = await client.query(
      `SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS ok`,
      [row.ds]
    );
    if (exists.rows[0]?.ok) schemas.push(row.ds);
  }

  console.log("\n=== Esquemas a validar ===\n", schemas.join(", "));

  let allOk = true;
  for (const s of schemas) {
    console.log(`\n--- ${s} ---`);
    for (const t of ["nota_credito", "nota_credito_electronica", "nota_credito_evento"]) {
      const ok = await assertTable(client, s, t, `tabla ${s}.${t}`);
      if (!ok) allOk = false;
    }

    const fn = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = 'zentra_erp' AND p.proname = 'neura_install_nota_credito_tables'
       ) AS ok`
    );
    if (s === "zentra_erp") {
      console.log(fn.rows[0]?.ok ? "✓" : "✗", "función zentra_erp.neura_install_nota_credito_tables");
      if (!fn.rows[0]?.ok) allOk = false;
    }

    const polNc = await countPolicies(client, s, "nota_credito");
    const polNe = await countPolicies(client, s, "nota_credito_electronica");
    const polEv = await countPolicies(client, s, "nota_credito_evento");
    const polOk = polNc >= 4 && polNe >= 4 && polEv >= 4;
    console.log(
      polOk ? "✓" : "✗",
      `RLS policies (>=4 c/u): nota_credito=${polNc}, electronica=${polNe}, evento=${polEv}`
    );
    if (!polOk) allOk = false;

    const uq = await hasUniquePartialNc(client, s);
    console.log(uq ? "✓" : "✗", `índice único parcial uq_nota_credito_factura_estado_activo en ${s}`);
    if (!uq) allOk = false;

    const chk = await client.query(
      `SELECT conname FROM pg_constraint c
       JOIN pg_class cl ON c.conrelid = cl.oid
       JOIN pg_namespace n ON cl.relnamespace = n.oid
       WHERE n.nspname = $1 AND cl.relname = 'nota_credito' AND c.contype = 'c'
       ORDER BY conname`,
      [s]
    );
    const names = chk.rows.map((r) => r.conname as string);
    const need = ["nota_credito_estado_erp_check", "nota_credito_moneda_snapshot_check", "nota_credito_motivo_len_check"];
    const have = need.every((n) => names.includes(n));
    console.log(
      have ? "✓" : "✗",
      `CHECKs en ${s}.nota_credito:`,
      have ? need.join(", ") : `esperados ${need.join(", ")}; hallados ${names.join(", ") || "(ninguno)"}`
    );
    if (!have) allOk = false;
  }

  await client.end();
  console.log("\n=== Resultado ===\n", allOk ? "OK" : "FALLÓ");
  if (!allOk) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
