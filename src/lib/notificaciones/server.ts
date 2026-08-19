/**
 * Notificaciones (campanita). PG directo, schema ferreteriarepublica.
 *
 * Uso actual: aviso urgente de stock bajo para productos CLASE A (alta rotación).
 * Condición: stock_actual <= stock_minimo + STOCK_ALERTA_OFFSET.
 * Dedupe: índice único parcial (empresa, producto, tipo) WHERE leida=false, más
 * INSERT ... ON CONFLICT DO NOTHING. Si el usuario la lee y el stock sigue bajo,
 * una próxima evaluación puede volver a generarla (criterio seguro).
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { getRotacionAbc } from "@/lib/reportes/server/rotacion-abc-pg";
import { asuncionRangeBoundsUtc } from "@/lib/fechas/asuncion-bounds";

/** Offset sobre el stock mínimo para disparar el aviso de clase A. */
export const STOCK_ALERTA_OFFSET = 10;
const TIPO_STOCK_A = "stock_bajo_a";
const TZ = "America/Asuncion";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export interface NotificacionRow {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string;
  producto_id: string | null;
  url: string | null;
  leida: boolean;
  created_at: string;
}

const COLS = "id, tipo, titulo, mensaje, producto_id, url, leida, created_at";

export async function listNotificaciones(
  schemaRaw: string,
  empresaId: string,
  limit = 30
): Promise<{ notificaciones: NotificacionRow[]; no_leidas: number }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "notificaciones");
  const p = pool();
  const listQ = p.query<NotificacionRow>(
    `SELECT ${COLS} FROM ${t} WHERE empresa_id = $1::uuid ORDER BY leida ASC, created_at DESC LIMIT $2`,
    [empresaId, limit]
  );
  const cntQ = p.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${t} WHERE empresa_id = $1::uuid AND leida = false`,
    [empresaId]
  );
  const [list, cnt] = await Promise.all([listQ, cntQ]);
  return { notificaciones: list.rows, no_leidas: Number(cnt.rows[0]?.n ?? 0) };
}

export async function marcarLeida(schemaRaw: string, empresaId: string, id: string): Promise<void> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "notificaciones");
  await pool().query(
    `UPDATE ${t} SET leida = true, updated_at = now() WHERE empresa_id = $1::uuid AND id = $2::uuid`,
    [empresaId, id]
  );
}

export async function marcarTodasLeidas(schemaRaw: string, empresaId: string): Promise<void> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "notificaciones");
  await pool().query(
    `UPDATE ${t} SET leida = true, updated_at = now() WHERE empresa_id = $1::uuid AND leida = false`,
    [empresaId]
  );
}

// Throttle en memoria del proceso: evita recomputar el ABC en cada poll.
const ultimaEval = new Map<string, number>();
const EVAL_THROTTLE_MS = 60_000;

function ultimos3MesesBounds() {
  const hoy = new Date();
  const inicio = new Date(hoy);
  inicio.setMonth(inicio.getMonth() - 3);
  const hasta = hoy.toLocaleDateString("en-CA", { timeZone: TZ });
  const desde = inicio.toLocaleDateString("en-CA", { timeZone: TZ });
  return asuncionRangeBoundsUtc(desde, hasta);
}

/**
 * Evalúa productos clase A con stock bajo y genera notificaciones (dedupe).
 * Best-effort y throttled: pensada para llamarse desde el GET de la campanita.
 * Nunca lanza (envuelve todo en try/catch a nivel caller).
 */
export async function evaluarStockClaseA(schemaRaw: string, empresaId: string): Promise<number> {
  const now = Date.now();
  const last = ultimaEval.get(empresaId) ?? 0;
  if (now - last < EVAL_THROTTLE_MS) return 0;
  ultimaEval.set(empresaId, now);

  const schema = assertAllowedChatDataSchema(schemaRaw);
  const { start, end } = ultimos3MesesBounds();
  const abc = await getRotacionAbc(schema, empresaId, {
    start, end, desde: "", hasta: "", meses: 3,
  });

  const candidatos = abc.productos.filter(
    (p) => p.rango === "A" && p.stock_actual <= p.stock_minimo + STOCK_ALERTA_OFFSET
  );
  if (candidatos.length === 0) return 0;

  const t = quoteSchemaTable(schema, "notificaciones");
  let creadas = 0;
  for (const p of candidatos) {
    const titulo = "Stock bajo — producto clase A";
    const mensaje = `${p.nombre}: stock actual ${p.stock_actual} (mínimo ${p.stock_minimo}). Conviene reponer.`;
    const url = `/inventario/${p.producto_id}/editar`;
    const r = await pool().query(
      `INSERT INTO ${t} (empresa_id, tipo, titulo, mensaje, producto_id, url)
       VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6)
       ON CONFLICT (empresa_id, producto_id, tipo) WHERE leida = false AND producto_id IS NOT NULL
       DO NOTHING`,
      [empresaId, TIPO_STOCK_A, titulo, mensaje, p.producto_id, url]
    );
    creadas += r.rowCount ?? 0;
  }
  return creadas;
}
