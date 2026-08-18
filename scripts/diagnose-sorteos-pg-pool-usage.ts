/**
 * Estrés del pool al estilo listados Sorteos (entradas / cupones paginados).
 * npx tsx scripts/diagnose-sorteos-pg-pool-usage.ts
 *
 * Variables opcionales:
 *   CHAT_DIAGNOSE_EMPRESA_ID=uuid
 *   CHAT_DIAGNOSE_SCHEMA=erp_...
 */
import path from "path";
import dotenv from "dotenv";
import { assertAllowedChatDataSchema } from "../src/lib/supabase/chat-data-schema";
import {
  getChatPostgresConnectionString,
  getChatPostgresPool,
  getPgPoolConfigMax,
  isPgPoolExhaustionMessage,
  logPgPoolStats,
  quoteSchemaTable,
} from "../src/lib/supabase/chat-pg-pool";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config();

const EMPRESA = process.env.CHAT_DIAGNOSE_EMPRESA_ID?.trim() || "5ad0bdda-f94f-446c-9032-1fedf34e8479";
const SCHEMA_RAW =
  process.env.CHAT_DIAGNOSE_SCHEMA?.trim() || "erp_el_papu_store_5ad0bdda";

async function runOneSlice(pool: NonNullable<ReturnType<typeof getChatPostgresPool>>, schema: string) {
  const sch = assertAllowedChatDataSchema(schema);
  const tEnt = quoteSchemaTable(sch, "sorteo_entradas");
  const tCup = quoteSchemaTable(sch, "sorteo_cupones");

  const whereSe = "se.empresa_id = $1::uuid";
  const existsCupon = `EXISTS (
    SELECT 1 FROM ${tCup} c
    WHERE c.entrada_id = se.id AND c.empresa_id = se.empresa_id
  )`;

  await pool.query(`SELECT COUNT(*)::bigint AS c FROM ${tEnt} se WHERE ${whereSe}`, [EMPRESA]);

  await pool.query(
    `
    SELECT se.* FROM ${tEnt} se
    WHERE ${whereSe}
    ORDER BY se.created_at DESC NULLS LAST
    LIMIT 50 OFFSET 0
  `,
    [EMPRESA]
  );

  await pool.query(
    `
    SELECT COUNT(*)::bigint AS c
    FROM ${tEnt} se
    WHERE ${whereSe} AND ${existsCupon}
  `,
    [EMPRESA]
  );

  await pool.query(
    `
    SELECT se.* FROM ${tEnt} se
    WHERE ${whereSe} AND ${existsCupon}
    ORDER BY se.created_at DESC NULLS LAST
    LIMIT 50 OFFSET 0
  `,
    [EMPRESA]
  );
}

async function main() {
  if (!getChatPostgresConnectionString()) {
    console.error("Sin URL de base en entorno.");
    process.exit(1);
  }
  const schema = assertAllowedChatDataSchema(SCHEMA_RAW);
  const pool = getChatPostgresPool();
  if (!pool) {
    console.error("Pool null");
    process.exit(1);
  }

  const max = getPgPoolConfigMax();
  console.log("empresa_id", EMPRESA);
  console.log("schema", schema);
  console.log("PG_POOL_MAX", max);

  const concurrent = Math.max(12, max * 6);
  let exhausted = 0;

  const tasks = Array.from({ length: concurrent }, () =>
    runOneSlice(pool, SCHEMA_RAW).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (isPgPoolExhaustionMessage(msg)) exhausted++;
      return { msg: msg.slice(0, 200) };
    })
  );

  await Promise.all(tasks);

  logPgPoolStats("diagnose-sorteos-pg-pool-usage", pool, {
    concurrent,
    exhausted_markers: exhausted,
  });

  if (exhausted > 0) {
    console.error("Detectado EMAXCONNSESSION en al menos una ruta.");
    process.exit(2);
  }

  console.log("OK: pool estable tras burst tipo Sorteos (entradas + cupón EXISTS).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
