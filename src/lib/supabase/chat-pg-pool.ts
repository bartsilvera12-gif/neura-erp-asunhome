import pg from "pg";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

/** Una sola instancia por runtime Node (Vercel isolate); sobrevive hot-reload vía globalThis. */
const GLOBAL_KEY = "__neura_CHAT_PG_POOL_SINGLETON__" as const;
const DATE_PARSER_FLAG_KEY = "__neura_CHAT_PG_DATE_PARSER_RAW__" as const;

/**
 * `node-pg` por defecto parsea OID 1082 (`date`) a `Date` JS, lo que rompe los validadores
 * de la app que esperan strings `YYYY-MM-DD` (por ejemplo `timbrado_fecha_inicio_vigencia`
 * en `empresa_sifen_config`: `String(new Date("2026-04-01"))` → `"Wed Apr 01 …"`,
 * que falla el regex y dispara
 * `Configuración SIFEN: timbrado_fecha_inicio_vigencia debe ser YYYY-MM-DD`).
 *
 * Forzamos el parser a "identidad" (devolver el texto crudo `YYYY-MM-DD` tal como viene
 * del wire de Postgres). Solo afecta a queries que pasan por este pool node-pg
 * (chat shim / sifen / facturas / clientes con `data_schema = erp_*`).
 * PostgREST/Supabase JS no se ven afectados (allá `date` ya viene como string).
 * No tocamos `timestamp`/`timestamptz` (OID 1114 / 1184): siguen mapeando a `Date`.
 */
function ensurePgDateParserRaw(): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[DATE_PARSER_FLAG_KEY]) return;
  pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
  g[DATE_PARSER_FLAG_KEY] = true;
}

function readGlobalPool(): pg.Pool | undefined {
  const g = globalThis as unknown as Record<string, pg.Pool | undefined>;
  return g[GLOBAL_KEY];
}

function writeGlobalPool(pool: pg.Pool | undefined): void {
  const g = globalThis as unknown as Record<string, pg.Pool | undefined>;
  g[GLOBAL_KEY] = pool;
}

/** Max conexiones por proceso Node hacia el pooler (Supabase session pool suele ser ~15 total). */
export function getPgPoolConfigMax(): number {
  const raw = process.env.PG_POOL_MAX?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 10) return n;
  }
  return 3;
}

export function isPgPoolExhaustionMessage(message: string): boolean {
  return (
    /EMAXCONNSESSION/i.test(message) ||
    /max clients reached/i.test(message) ||
    /too many connections/i.test(message)
  );
}

/** Stats seguros (sin secretos). Llamar ante EMAXCONNSESSION o diagnóstico. */
export function logPgPoolStats(
  tag: string,
  pool: pg.Pool | null,
  extra?: Record<string, unknown>
): void {
  if (!pool) return;
  const opts = (pool as unknown as { options?: { max?: number } }).options;
  console.warn("[pg-pool][stats]", {
    tag,
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    max: opts?.max,
    ...extra,
  });
}

export function getChatPostgresConnectionString(): string | null {
  const u =
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DIRECT_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (u && u.length > 0) return u;
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const m = base?.match(/https:\/\/([^.]+)\.supabase\.co/i);
  if (!password || !m?.[1]) return null;
  const ref = m[1];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

/**
 * Pool Postgres directo (pooler). Una instancia global por runtime — no instanciar Pool por request.
 * Preferir en Vercel: URL del transaction pooler (puerto 6543, modo transaction) si preparación de sesión lo permite.
 */
export function getChatPostgresPool(): pg.Pool | null {
  const url = getChatPostgresConnectionString();
  if (!url) return null;

  /** Asegura que `date` se devuelva como string `YYYY-MM-DD` antes de crear el pool. */
  ensurePgDateParserRaw();

  let pool = readGlobalPool();
  if (!pool) {
    const max = getPgPoolConfigMax();
    pool = new pg.Pool({
      connectionString: url,
      max,
      idleTimeoutMillis: 20_000,
      // Fail-fast: si el pooler/DB directo no responde, fallar en 4s en vez de
      // colgar 12s y recién ahí devolver 500. Reduce el daño cuando la conexión
      // PG directa está caída/lenta en prod (ver Pedidos/prioridades y Sorteos).
      // Mitigación — la causa raíz es de infra (conectividad al pooler).
      connectionTimeoutMillis: 4_000,
      allowExitOnIdle: true,
      ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    });
    pool.on("error", (err) => {
      console.error("[pg-pool][idle-client-error]", err instanceof Error ? err.message : String(err));
    });
    writeGlobalPool(pool);
  }
  return pool;
}

export function quoteSchemaTable(schema: string, table: string): string {
  const s = assertAllowedChatDataSchema(schema);
  const t = table.replace(/[^\w]/g, "");
  if (!t) throw new Error("tabla inválida");
  return `"${s.replace(/"/g, '""')}"."${t.replace(/"/g, '""')}"`;
}
