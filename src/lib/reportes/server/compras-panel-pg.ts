/**
 * Panel de Compras por rango de fechas (desde/hasta): dos vistas.
 *  1) Compras registradas/confirmadas del período (agrupadas por numero_control).
 *  2) Ordenados no comprados: líneas de OC con saldo pendiente de recibir.
 *
 * Se apoya en el vínculo OC↔Compra ya existente (recepción parcial):
 *   - ordenes_compra.cantidad_recibida (acumulado; el modelo de OC es plano,
 *     una fila por producto → una recepción parcial NUNCA duplica la línea).
 *   - estados: pendiente | recibida_parcial | recibida_total | cancelada.
 *
 * PG directo (mismo patrón que reportes-pg). No toca ventas/caja/SIFEN.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type {
  ComprasPanel,
  CompraPanelFila,
  OrdenPendienteFila,
} from "@/lib/reportes/types";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function getComprasPanel(
  schemaRaw: string,
  empresaId: string,
  rango: { start: string; end: string; desde: string; hasta: string }
): Promise<ComprasPanel> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tCompras = quoteSchemaTable(schema, "compras");
  const tOC = quoteSchemaTable(schema, "ordenes_compra");
  const tProd = quoteSchemaTable(schema, "productos");

  // ── Vista 1: compras confirmadas del período (agrupadas por numero_control).
  const comprasQ = await pool().query(
    `SELECT numero_control,
            min(fecha)             AS fecha,
            max(proveedor_nombre)  AS proveedor_nombre,
            max(numero_factura)    AS numero_factura,
            max(estado)            AS estado,
            max(orden_compra_numero) AS orden_compra_numero,
            count(*)               AS items_count,
            sum(total)             AS total
       FROM ${tCompras}
      WHERE empresa_id = $1::uuid AND fecha >= $2 AND fecha <= $3
        AND anulada_at IS NULL
      GROUP BY numero_control
      ORDER BY min(fecha) DESC`,
    [empresaId, rango.start, rango.end]
  );
  const compras: CompraPanelFila[] = comprasQ.rows.map((r: Record<string, unknown>) => ({
    numero_control: String(r.numero_control),
    fecha: String(r.fecha),
    numero_factura: r.numero_factura != null ? String(r.numero_factura) : null,
    proveedor_nombre: r.proveedor_nombre != null ? String(r.proveedor_nombre) : "—",
    items_count: num(r.items_count),
    total: num(r.total),
    estado: r.estado != null ? String(r.estado) : "registrada",
    orden_compra_numero: r.orden_compra_numero != null ? String(r.orden_compra_numero) : null,
  }));

  // ── Vista 2: ordenados no comprados (líneas de OC con pendiente > 0).
  //   - No canceladas.
  //   - cantidad_recibida < cantidad (recepción parcial → solo el pendiente).
  //   - Filtra por FECHA DE LA ORDEN (o.fecha), como pide el requerimiento.
  const pendQ = await pool().query(
    `SELECT o.id                       AS orden_item_id,
            o.numero_oc                AS numero_oc,
            o.fecha                    AS fecha,
            o.proveedor_nombre         AS proveedor_nombre,
            o.producto_id              AS producto_id,
            o.producto_nombre          AS producto_nombre,
            p.sku                      AS sku,
            o.cantidad                 AS cantidad,
            o.cantidad_recibida        AS cantidad_recibida,
            o.costo_unitario           AS costo_unitario,
            o.estado                   AS estado
       FROM ${tOC} o
       LEFT JOIN ${tProd} p ON p.id = o.producto_id AND p.empresa_id = o.empresa_id
      WHERE o.empresa_id = $1::uuid
        AND o.estado <> 'cancelada'
        AND COALESCE(o.cantidad_recibida, 0) < o.cantidad
        AND o.fecha >= $2 AND o.fecha <= $3
      ORDER BY o.fecha DESC, o.numero_oc ASC, o.producto_nombre ASC`,
    [empresaId, rango.start, rango.end]
  );
  const pendientes: OrdenPendienteFila[] = pendQ.rows.map((r: Record<string, unknown>) => {
    const ordenada = num(r.cantidad);
    const recibida = num(r.cantidad_recibida);
    const pendiente = Math.max(0, ordenada - recibida);
    const costo = num(r.costo_unitario);
    return {
      orden_item_id: String(r.orden_item_id),
      numero_oc: String(r.numero_oc),
      fecha: String(r.fecha),
      proveedor_nombre: r.proveedor_nombre != null ? String(r.proveedor_nombre) : "—",
      producto_id: String(r.producto_id),
      producto_nombre: r.producto_nombre != null ? String(r.producto_nombre) : "—",
      sku: r.sku != null ? String(r.sku) : null,
      cantidad_ordenada: ordenada,
      cantidad_recibida: recibida,
      cantidad_pendiente: pendiente,
      costo_unitario: costo,
      subtotal_pendiente: Math.round(pendiente * costo),
      estado: r.estado != null ? String(r.estado) : "pendiente",
    };
  });

  const montoComprado = compras.reduce((s, c) => s + c.total, 0);
  const montoPendiente = pendientes.reduce((s, p) => s + p.subtotal_pendiente, 0);
  const ordenesPendientes = new Set(pendientes.map((p) => p.numero_oc)).size;

  return {
    desde: rango.desde,
    hasta: rango.hasta,
    compras,
    pendientes,
    totales: {
      total_compras: compras.length,
      monto_comprado: montoComprado,
      ordenes_pendientes: ordenesPendientes,
      monto_pendiente: montoPendiente,
    },
  };
}
