/**
 * Snapshot EnsureSorteoOrderCreatedData leyendo tenant por Postgres directo.
 * Ventas manuales crean filas vía PG; PostgREST a veces no expone el schema erp_* → buildOrderResultFromEntradaId falla.
 */
import "server-only";

import { getChatPostgresPool } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type { EnsureSorteoOrderCreatedData } from "@/lib/sorteos/sorteo-order-from-chat";

function quoteIdent(schema: string): string {
  const s = assertAllowedChatDataSchema(schema);
  return `"${s.replace(/"/g, '""')}"`;
}

export async function buildManualSaleOrderResultFromPg(
  schema: string,
  empresaId: string,
  entradaId: string
): Promise<EnsureSorteoOrderCreatedData | null> {
  const pool = getChatPostgresPool();
  if (!pool) return null;

  const qsch = quoteIdent(schema);
  const client = await pool.connect();

  try {
    const entRes = await client.query<{
      sorteo_id: string;
      numero_orden: number;
      cantidad_boletos: number;
      monto_total: string | number | null;
      promo_nombre: string | null;
      precio_fuente: string | null;
    }>(
      `SELECT sorteo_id, numero_orden, cantidad_boletos, monto_total, promo_nombre, precio_fuente
       FROM ${qsch}.sorteo_entradas
       WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [entradaId, empresaId]
    );
    const ent = entRes.rows[0];
    if (!ent) return null;

    const sortRes = await client.query<{ nombre: string | null }>(
      `SELECT nombre FROM ${qsch}.sorteos WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [ent.sorteo_id, empresaId]
    );
    const sorteoNombre = String(sortRes.rows[0]?.nombre ?? "").trim();

    const cupRes = await client.query<{ id: string; numero_cupon: string }>(
      `SELECT id, numero_cupon FROM ${qsch}.sorteo_cupones
       WHERE entrada_id = $1::uuid AND empresa_id = $2::uuid
       ORDER BY numero_cupon`,
      [entradaId, empresaId]
    );

    const promoNombre = String(ent.promo_nombre ?? "").trim();
    const pf = String(ent.precio_fuente ?? "").trim();
    const precioFuente = pf === "promo" ? "promo" : "lista";

    return {
      idempotent: true,
      entradaId,
      numeroOrden: Number(ent.numero_orden),
      cupones: cupRes.rows.map((r) => ({ id: r.id, numero_cupon: r.numero_cupon })),
      sorteoId: ent.sorteo_id,
      sorteoNombre,
      cantidadBoletos: Number(ent.cantidad_boletos),
      montoTotal: Number(ent.monto_total ?? 0),
      promoNombre,
      precioFuente,
    };
  } catch (err) {
    console.warn("[sorteo-manual-order-result-pg]", {
      entradaId: String(entradaId).slice(0, 8),
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    client.release();
  }
}
