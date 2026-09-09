/**
 * Anulación de venta ATÓMICA (pool PG directo, BEGIN/COMMIT) con
 * SELECT ... FOR UPDATE sobre la venta, para que dos requests simultáneos
 * (doble-click / retry) NO puedan revertir el stock dos veces.
 *
 * Reemplaza la versión best-effort (PostgREST, sin transacción ni row-lock) que
 * permitía la carrera: stock 6 → dos anulaciones → stock 8. Con el lock, el
 * segundo request ve la venta ya 'anulada' y no reprocesa: siempre termina en 7.
 *
 * Mismo patrón robusto que devoluciones-pg.ts.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { anularDevolucionConClient } from "@/lib/devoluciones/server/devoluciones-pg";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export type AnularVentaCode =
  | "venta_no_encontrada"
  | "venta_ya_anulada"
  | "sin_caja"
  | "caja_cerrada";

/** Error tipado para mapear a HTTP en la ruta (404/409/400). */
export class AnularVentaError extends Error {
  code: AnularVentaCode;
  constructor(code: AnularVentaCode, message: string) {
    super(message);
    this.name = "AnularVentaError";
    this.code = code;
  }
}

export interface AnularVentaResult {
  ventaId: string;
  numeroControl: string | null;
  movimientosRevertidos: number;
}

/**
 * Anula una venta ACTIVA cuya caja esté ABIERTA. Revierte el stock UNA sola vez,
 * marca las SALIDAs de origen 'venta' como anuladas, crea exactamente UNA ENTRADA
 * por reversión (origen 'anulacion_venta', referencia ANUL-<numero_control>),
 * libera series, anula caja_movimientos y la CxC, y marca la venta 'anulada'.
 * Todo en una transacción; ante cualquier error, ROLLBACK.
 */
export async function anularVentaPg(
  schemaRaw: string,
  empresaId: string,
  ventaId: string,
  usuario: { id: string | null; nombre: string | null },
  motivo: string | null
): Promise<AnularVentaResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tMI = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const tCajas = quoteSchemaTable(schema, "cajas");
  const tCM = quoteSchemaTable(schema, "caja_movimientos");
  const tCxc = quoteSchemaTable(schema, "cuentas_por_cobrar");
  const tSeries = quoteSchemaTable(schema, "producto_series");
  const tD = quoteSchemaTable(schema, "devoluciones_venta");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // ── 1) Bloquear la venta (serialización): nadie más la anula en paralelo.
    const vQ = await client.query<{
      numero_control: string | null;
      estado: string;
      caja_id: string | null;
    }>(
      `SELECT numero_control, estado, caja_id::text AS caja_id
         FROM ${tV} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [ventaId, empresaId]
    );
    const venta = vQ.rows[0];
    if (!venta) {
      await client.query("ROLLBACK");
      throw new AnularVentaError("venta_no_encontrada", "Venta no encontrada.");
    }
    // Idempotencia: si ya está anulada, no reprocesar stock.
    if (String(venta.estado) === "anulada") {
      await client.query("ROLLBACK");
      throw new AnularVentaError("venta_ya_anulada", "La venta ya está anulada.");
    }

    // ── 2) Regla "solo caja actual": la caja de la venta debe estar abierta.
    if (!venta.caja_id) {
      await client.query("ROLLBACK");
      throw new AnularVentaError("sin_caja", "No se puede anular: la venta no tiene caja asociada.");
    }
    const cQ = await client.query<{ estado: string }>(
      `SELECT estado FROM ${tCajas} WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [venta.caja_id, empresaId]
    );
    if (!cQ.rows[0] || String(cQ.rows[0].estado) !== "abierta") {
      await client.query("ROLLBACK");
      throw new AnularVentaError("caja_cerrada", "No se puede anular: la caja de esta venta ya está cerrada.");
    }

    // ── 2b) Anular las devoluciones confirmadas de esta venta DENTRO de la MISMA
    // transacción (atomicidad total: todo commitea o todo rollbackea junto). Usa
    // el MISMO client. Idempotente: una devolución ya anulada es no-op.
    const devsQ = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM ${tD}
        WHERE empresa_id = $1::uuid AND venta_id = $2::uuid AND estado = 'confirmada'`,
      [empresaId, ventaId]
    );
    for (const dv of devsQ.rows) {
      await anularDevolucionConClient(client, schemaRaw, empresaId, usuario, String(dv.id), "Anulación de venta");
    }

    // ── 3) SALIDAs de origen 'venta' aún vigentes (las de devolución ya las
    // revirtió anularDevolucionConClient arriba; filtrar por origen evita doble
    // reversión).
    const movQ = await client.query<{
      id: string;
      producto_id: string;
      producto_nombre: string | null;
      producto_sku: string | null;
      cantidad: string;
      costo_unitario: string | null;
    }>(
      `SELECT id::text AS id, producto_id::text AS producto_id, producto_nombre, producto_sku,
              cantidad::text AS cantidad, costo_unitario::text AS costo_unitario
         FROM ${tMI}
        WHERE empresa_id = $1::uuid AND venta_id = $2::uuid
          AND tipo = 'SALIDA' AND COALESCE(origen,'venta') = 'venta'
          AND anulado_at IS NULL`,
      [empresaId, ventaId]
    );

    const referencia = `ANUL-${venta.numero_control ?? ""}`;
    let revertidos = 0;
    for (const m of movQ.rows) {
      const cantidad = Number(m.cantidad) || 0;
      // 3a) Sumar stock UNA sola vez (incremento atómico: sin read-modify-write).
      await client.query(
        `UPDATE ${tP} SET stock_actual = stock_actual + $1::numeric, updated_at = now()
          WHERE id = $2::uuid AND empresa_id = $3::uuid`,
        [cantidad, m.producto_id, empresaId]
      );
      // 3b) Marcar la SALIDA original como anulada (auditoría; no se borra).
      await client.query(
        `UPDATE ${tMI} SET anulado_at = now(), anulado_por = $1::uuid
          WHERE id = $2::uuid AND empresa_id = $3::uuid`,
        [usuario.id, m.id, empresaId]
      );
      // 3c) Crear EXACTAMENTE UNA ENTRADA de reversión, con origen propio.
      await client.query(
        `INSERT INTO ${tMI} (empresa_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia, fecha, venta_id, created_by, usuario_nombre)
         VALUES ($1::uuid,$2::uuid,$3,$4,'ENTRADA',$5::numeric,$6::numeric,'anulacion_venta',$7,now(),$8::uuid,$9::uuid,$10)`,
        [empresaId, m.producto_id, m.producto_nombre, m.producto_sku, cantidad,
         Number(m.costo_unitario) || 0, referencia, ventaId, usuario.id, usuario.nombre]
      );
      revertidos += 1;
    }

    // ── 4) Liberar números de serie de la venta (vuelven a en_stock).
    await client.query(
      `UPDATE ${tSeries}
          SET estado = 'en_stock', venta_id = NULL, venta_item_id = NULL,
              cliente_id = NULL, fecha_venta = NULL
        WHERE empresa_id = $1::uuid AND venta_id = $2::uuid AND estado = 'vendido'`,
      [empresaId, ventaId]
    );

    // ── 5) Anular movimientos de caja vinculados a la venta.
    await client.query(
      `UPDATE ${tCM} SET anulado_at = now(), anulado_por = $1::uuid
        WHERE empresa_id = $2::uuid AND venta_id = $3::uuid AND anulado_at IS NULL`,
      [usuario.id, empresaId, ventaId]
    );

    // ── 6) Si era a crédito, anular la cuenta por cobrar (no falla si no hay).
    await client.query(
      `UPDATE ${tCxc} SET estado = 'anulado', saldo = 0
        WHERE empresa_id = $1::uuid AND venta_id = $2::uuid AND estado <> 'anulado'`,
      [empresaId, ventaId]
    );

    // ── 7) Marcar la venta como ANULADA.
    await client.query(
      `UPDATE ${tV}
          SET estado = 'anulada', anulada_at = now(), anulada_por = $1::uuid, anulada_motivo = $2
        WHERE id = $3::uuid AND empresa_id = $4::uuid`,
      [usuario.id, motivo, ventaId, empresaId]
    );

    await client.query("COMMIT");
    return { ventaId, numeroControl: venta.numero_control, movimientosRevertidos: revertidos };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}
