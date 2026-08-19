/**
 * Anular una OC con reversión completa:
 *
 *  1. Encuentra todas las compras (recepciones) vinculadas a la OC por numero_oc.
 *  2. Por cada compra no anulada:
 *     - Devuelve stock: resta la cantidad al productos.stock_actual.
 *     - Marca la compra con anulada_at / motivo.
 *     - Inserta un movimiento SALIDA (origen=ajuste_manual, referencia
 *       ANUL-<numero_compra>) para que aparezca visible en Inventario >
 *       Movimientos como contra-movimiento del ENTRADA original.
 *     - Marca los movimientos_inventario ENTRADA de esa compra con
 *       anulado_at (si la tabla tiene la columna; best-effort).
 *  3. Marca la OC con estado='cancelada' + cancelada_at + motivo, sin
 *     importar si ya estaba pendiente/parcial/total.
 *
 * NOTA: no se recalcula CPP (costo promedio ponderado); revertir CPP
 * requiere recorrer toda la historia de compras del producto. Queda como
 * costo del último movimiento hasta que ingrese otra compra.
 *
 * Todo en una sola transacción.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export interface AnularOcResult {
  ok: true;
  numero_oc: string;
  estado_anterior: string;
  compras_revertidas: number;
  unidades_devueltas: number;
}

export async function anularOrdenCompraConReversion(
  schemaRaw: string,
  empresaId: string,
  numeroOc: string,
  motivo: string | null,
  usuarioId: string | null
): Promise<AnularOcResult | { ok: false; error: string; status: number }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tOC = quoteSchemaTable(schema, "ordenes_compra");
  const tC = quoteSchemaTable(schema, "compras");
  const tP = quoteSchemaTable(schema, "productos");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");

  const motivoNorm = (motivo ?? "").trim().slice(0, 500) || null;
  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // 1) Verificar que la OC exista y no esté ya cancelada
    const { rows: ocRows } = await client.query<{ estado: string }>(
      `SELECT estado FROM ${tOC}
        WHERE empresa_id = $1::uuid AND numero_oc = $2
        LIMIT 1`,
      [empresaId, numeroOc]
    );
    if (ocRows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Orden de compra no encontrada.", status: 404 };
    }
    const estadoAnterior = ocRows[0].estado;
    if (estadoAnterior === "cancelada") {
      await client.query("ROLLBACK");
      return { ok: false, error: "La orden ya está cancelada.", status: 409 };
    }

    // 2) Traer las compras vinculadas todavía activas
    const { rows: compras } = await client.query<{
      id: string;
      numero_control: string;
      producto_id: string;
      producto_nombre: string;
      cantidad: string;
      costo_unitario: string;
    }>(
      `SELECT id, numero_control, producto_id, producto_nombre,
              cantidad::text, costo_unitario::text
         FROM ${tC}
        WHERE empresa_id = $1::uuid
          AND orden_compra_numero = $2
          AND anulada_at IS NULL`,
      [empresaId, numeroOc]
    );

    let unidadesDevueltas = 0;
    for (const c of compras) {
      const cantidad = Number(c.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) continue;

      // 2a) Devolver stock (no bajar de 0 por si hubo consumos posteriores)
      await client.query(
        `UPDATE ${tP}
            SET stock_actual = GREATEST(0, stock_actual - $1::numeric),
                updated_at = now()
          WHERE id = $2::uuid AND empresa_id = $3::uuid`,
        [cantidad, c.producto_id, empresaId]
      );

      // 2b) Marcar la compra como anulada
      await client.query(
        `UPDATE ${tC}
            SET anulada_at = now(),
                anulada_por = $1,
                anulada_motivo = $2
          WHERE id = $3::uuid AND empresa_id = $4::uuid`,
        [usuarioId, motivoNorm, c.id, empresaId]
      );

      // 2c) Marcar los movimientos ENTRADA de esa compra como anulados
      //     (best-effort: si la columna no existe, ignora el error).
      try {
        await client.query(
          `UPDATE ${tM}
              SET anulado_at = now(),
                  anulado_por = $1
            WHERE empresa_id = $2::uuid
              AND referencia = $3
              AND tipo = 'ENTRADA'
              AND anulado_at IS NULL`,
          [usuarioId, empresaId, c.numero_control]
        );
      } catch {
        /* la columna puede no existir; el contra-movimiento igual queda */
      }

      // 2d) Insertar contra-movimiento SALIDA visible en Movimientos
      await client.query(
        `INSERT INTO ${tM} (
           empresa_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia, fecha,
           created_by, usuario_nombre
         )
         SELECT $1::uuid, $2::uuid, $3, COALESCE(p.sku, ''),
                'SALIDA', $4::numeric, $5::numeric, 'ajuste_manual', $6, now(),
                $7::uuid, NULL
         FROM ${tP} p WHERE p.id = $2::uuid`,
        [
          empresaId,
          c.producto_id,
          c.producto_nombre,
          cantidad,
          Number(c.costo_unitario) || 0,
          `ANUL-${c.numero_control}`,
          usuarioId,
        ]
      );

      unidadesDevueltas += cantidad;
    }

    // 3) Marcar la OC como cancelada
    await client.query(
      `UPDATE ${tOC}
          SET estado = 'cancelada',
              cancelada_at = now(),
              cancelada_por = $1,
              cancelada_motivo = $2,
              updated_at = now()
        WHERE empresa_id = $3::uuid AND numero_oc = $4`,
      [usuarioId, motivoNorm, empresaId, numeroOc]
    );

    await client.query("COMMIT");
    return {
      ok: true,
      numero_oc: numeroOc,
      estado_anterior: estadoAnterior,
      compras_revertidas: compras.length,
      unidades_devueltas: unidadesDevueltas,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}
