/**
 * Verifica integridad puntero conversación ↔ sesión activa (Supabase remoto).
 * Usa .env.local (SUPABASE_DB_URL o password + URL).
 *
 * npx tsx scripts/verify-flow-session-isolation.ts
 */
import { config } from "dotenv";
import { join } from "path";
import pg from "pg";

config({ path: join(process.cwd(), ".env.local") });

const { Client } = pg;

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
  const ref = m[1];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

async function main() {
  const url = getDbUrl();
  const client = new Client({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  console.log("verify-flow-session-isolation: conectado\n");

  let failed = false;

  const q1 = `
    SELECT count(*)::int AS n
    FROM public.chat_conversations c
    LEFT JOIN public.chat_flow_sessions s ON s.id = c.active_flow_session_id
    WHERE c.active_flow_session_id IS NOT NULL
      AND (
        s.id IS NULL
        OR s.status <> 'active'
        OR btrim(s.flow_code) IS DISTINCT FROM btrim(coalesce(c.flow_code, ''))
      );
  `;
  const r1 = await client.query<{ n: number }>(q1);
  const badPointer = r1.rows[0]?.n ?? 0;
  console.log("1) Conversaciones con active_flow_session_id roto o flujo distinto:", badPointer);
  if (badPointer > 0) failed = true;

  const q2 = `
    SELECT conversation_id::text, count(*)::int AS n
    FROM public.chat_flow_sessions
    WHERE status = 'active'
    GROUP BY conversation_id
    HAVING count(*) > 1;
  `;
  const r2 = await client.query(q2);
  console.log("2) Filas con más de una sesión active por conversación:", r2.rowCount);
  if (r2.rowCount && r2.rowCount > 0) {
    console.log(r2.rows);
    failed = true;
  }

  const q3 = `
    SELECT count(*)::int AS n
    FROM public.chat_conversations c
    WHERE c.flow_code IS NOT NULL AND btrim(c.flow_code) <> ''
      AND c.active_flow_session_id IS NULL;
  `;
  const r3 = await client.query<{ n: number }>(q3);
  const noSession = r3.rows[0]?.n ?? 0;
  console.log("3) Conversaciones con flow_code pero sin active_flow_session_id:", noSession);
  if (noSession > 0) {
    console.log("   (El motor intenta reparar al leer; conviene bootstrap/reinicio.)");
  }

  await client.end();
  if (failed) {
    console.error("\nFALLÓ al menos una verificación crítica (1 o 2).");
    process.exit(1);
  }
  console.log("\nOK: punteros y unicidad de sesión activa.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
