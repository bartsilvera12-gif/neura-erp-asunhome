/**
 * Verifica que RLS, funciones y políticas estén correctamente configuradas.
 * Ejecutar después de la migración: npm run db:verificar-rls
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import pg from "pg";

const { Client } = pg;
const PROJECT_REF = "ycyibjxplsgguuxbqtps";

function getDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (url) return url;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new Error("Falta SUPABASE_DB_PASSWORD o SUPABASE_DB_URL en .env.local");
  }
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
}

async function main() {
  const client = new Client({ connectionString: getDbUrl() });
  await client.connect();

  const checks: { name: string; ok: boolean; detail?: string }[] = [];

  // 1. Funciones
  const { rows: funcs } = await client.query(`
    SELECT proname FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND proname IN ('empresa_id_actual', 'es_super_admin', 'puede_acceder_empresa')
  `);
  const expectedFuncs = ["empresa_id_actual", "es_super_admin", "puede_acceder_empresa"];
  const foundFuncs = funcs.map((r) => r.proname);
  checks.push({
    name: "Funciones public.empresa_id_actual, es_super_admin, puede_acceder_empresa",
    ok: expectedFuncs.every((f) => foundFuncs.includes(f)),
    detail: foundFuncs.length ? `Encontradas: ${foundFuncs.join(", ")}` : "No encontradas",
  });

  // 2. RLS activado
  const { rows: rls } = await client.query(`
    SELECT relname, relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND relname IN ('empresas', 'usuarios', 'empresa_modulos', 'modulos', 'clientes')
      AND relkind = 'r'
  `);
  const tablesWithRls = rls.filter((r) => r.relrowsecurity).map((r) => r.relname);
  const expectedTables = ["empresas", "usuarios", "empresa_modulos", "modulos", "clientes"];
  const missingRls = expectedTables.filter((t) => !tablesWithRls.includes(t));
  checks.push({
    name: "RLS activado en empresas, usuarios, empresa_modulos, modulos, clientes",
    ok: missingRls.length === 0,
    detail: missingRls.length ? `Sin RLS: ${missingRls.join(", ")}` : `OK: ${tablesWithRls.join(", ")}`,
  });

  // 3. Políticas
  const { rows: policies } = await client.query(`
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename IN ('empresas', 'usuarios', 'empresa_modulos', 'modulos', 'clientes')
  `);
  const expectedPolicies = 20; // 4 empresas + 4 usuarios + 4 empresa_modulos + 4 modulos + 4 clientes
  checks.push({
    name: "Políticas creadas (SELECT, INSERT, UPDATE, DELETE)",
    ok: policies.length >= expectedPolicies,
    detail: `${policies.length} políticas encontradas`,
  });

  // Resultado
  console.log("\n=== Verificación RLS Multiempresa ===\n");
  for (const c of checks) {
    console.log(`${c.ok ? "✓" : "✗"} ${c.name}`);
    if (c.detail) console.log(`  ${c.detail}`);
  }
  const allOk = checks.every((c) => c.ok);
  console.log(allOk ? "\n✓ Todo correcto.\n" : "\n✗ Revisar errores.\n");
  await client.end();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
