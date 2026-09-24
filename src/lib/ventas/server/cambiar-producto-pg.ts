/**
 * Cambiar un producto de una venta ya facturada, ajustando stock, IVA, total y
 * (automáticamente) la caja del día — manteniendo el MISMO número de factura.
 *
 * Cómo queda consistente la CAJA sin insertar movimientos: una venta al contado NO
 * genera fila en caja_movimientos; el "efectivo esperado" del turno se DERIVA sumando
 * `ventas.total` de las ventas del turno. Por eso, al recalcular `ventas.total`, el
 * arqueo se ajusta solo. La diferencia física (cobrar o devolver) la hace el cajero;
 * se devuelve en el resultado para avisarle.
 *
 * Guardrails (para no descuadrar): venta ACTIVA (completada), al CONTADO, pago NO
 * mixto, y su caja del día ABIERTA. Producto (viejo y nuevo) sin receta/series
 * (fuera de alcance por ahora). Corre en UNA transacción (pg pool directo).
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export interface CambiarProductoParams {
  itemId: string;
  nuevoProductoId: string;
  nuevaCantidad: number;
  nuevoPrecioVenta: number;
  nuevoTipoIva: "EXENTA" | "5%" | "10%";
  createdBy?: string | null;
  usuarioNombre?: string | null;
}

export interface CambiarProductoResultado {
  numero_control: string;
  total_anterior: number;
  total_nuevo: number;
  diferencia: number; // >0 cobrar al cliente, <0 devolver
}

export class CambiarProductoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CambiarProductoError";
  }
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

/** IVA incluido en el precio (Paraguay): se extrae desde adentro del total. */
function calcIva(tipoIva: string, totalLinea: number): number {
  if (tipoIva === "10%") return Math.round(totalLinea - totalLinea / 1.1);
  if (tipoIva === "5%") return Math.round(totalLinea - totalLinea / 1.05);
  return 0; // EXENTA
}

export async function cambiarProductoVenta(
  schemaRaw: string,
  empresaId: string,
  ventaId: string,
  p: CambiarProductoParams
): Promise<CambiarProductoResultado> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");

  if (!(p.nuevaCantidad > 0)) throw new CambiarProductoError("La cantidad debe ser mayor a 0.");
  if (!(p.nuevoPrecioVenta >= 0)) throw new CambiarProductoError("El precio no es válido.");

  const tVentas = quoteSchemaTable(schema, "ventas");
  const tItems = quoteSchemaTable(schema, "ventas_items");
  const tProd = quoteSchemaTable(schema, "productos");
  const tMov = quoteSchemaTable(schema, "movimientos_inventario");
  const tCajas = quoteSchemaTable(schema, "cajas");
  const tPagos = quoteSchemaTable(schema, "ventas_pagos_detalle");
  const tFa = quoteSchemaTable(schema, "factura_autoimpresor");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Venta con lock + guardrails.
    const vQ = await client.query(
      `SELECT id, numero_control, estado, tipo_venta, metodo_pago, caja_id,
              COALESCE(retencion_iva_monto,0) AS ret, total
         FROM ${tVentas} WHERE id=$1::uuid AND empresa_id=$2::uuid FOR UPDATE`,
      [ventaId, empresaId]
    );
    const v = vQ.rows[0] as Record<string, unknown> | undefined;
    if (!v) throw new CambiarProductoError("Venta no encontrada.");
    if (String(v.estado) !== "completada") throw new CambiarProductoError("Solo se puede cambiar el producto en ventas activas (no anuladas ni devueltas).");
    if (String(v.tipo_venta).toUpperCase() === "CREDITO") throw new CambiarProductoError("Por ahora solo ventas al contado.");
    if (String(v.metodo_pago) === "mixto") throw new CambiarProductoError("Por ahora no se puede en ventas con pago mixto.");

    // 2) Caja del día abierta.
    if (!v.caja_id) throw new CambiarProductoError("La venta no está asociada a una caja; no se puede ajustar.");
    const cQ = await client.query(`SELECT estado FROM ${tCajas} WHERE id=$1::uuid AND empresa_id=$2::uuid`, [v.caja_id, empresaId]);
    if (!cQ.rows[0] || String((cQ.rows[0] as Record<string, unknown>).estado) !== "abierta") {
      throw new CambiarProductoError("La caja de esta venta ya está cerrada. No se puede cambiar el producto sin descuadrar un arqueo cerrado.");
    }

    // 3) Ítem a cambiar (viejo).
    const itQ = await client.query(
      `SELECT id, producto_id, cantidad, cantidad_total_base FROM ${tItems}
        WHERE id=$1::uuid AND venta_id=$2::uuid AND empresa_id=$3::uuid FOR UPDATE`,
      [p.itemId, ventaId, empresaId]
    );
    const it = itQ.rows[0] as Record<string, unknown> | undefined;
    if (!it) throw new CambiarProductoError("No se encontró el producto a cambiar en la venta.");
    const viejoProductoId = String(it.producto_id);
    // Base a reintegrar: la que se descontó al vender (cantidad_total_base), o la
    // cantidad simple si no hubo presentación.
    const viejoBase = num(it.cantidad_total_base) || num(it.cantidad);

    // 4) Producto viejo (para reintegrar stock) y nuevo.
    const viejoQ = await client.query(`SELECT nombre, sku, controla_stock, costo_promedio FROM ${tProd} WHERE id=$1::uuid AND empresa_id=$2::uuid`, [viejoProductoId, empresaId]);
    const viejo = viejoQ.rows[0] as Record<string, unknown> | undefined;
    const nuevoQ = await client.query(
      `SELECT nombre, sku, controla_stock, costo_promedio, precio_venta, modo_receta, maneja_series
         FROM ${tProd} WHERE id=$1::uuid AND empresa_id=$2::uuid`,
      [p.nuevoProductoId, empresaId]
    );
    const nuevo = nuevoQ.rows[0] as Record<string, unknown> | undefined;
    if (!nuevo) throw new CambiarProductoError("El producto nuevo no existe.");
    if (String(nuevo.modo_receta ?? "") === "preparado_al_vender") throw new CambiarProductoError("El producto nuevo usa receta; no se puede cambiar por acá todavía.");
    if (nuevo.maneja_series === true) throw new CambiarProductoError("El producto nuevo maneja series; no se puede cambiar por acá todavía.");

    const numeroControl = String(v.numero_control);
    const ref = `EDIT-${numeroControl}`;
    const obs = `Cambio de producto en ${numeroControl}`;
    const nuevoBase = p.nuevaCantidad; // sin presentaciones (producto simple)

    // 5) STOCK: reintegrar el viejo, descontar el nuevo (movimientos de ajuste).
    if (viejo && viejo.controla_stock !== false && viejoBase > 0) {
      await client.query(`UPDATE ${tProd} SET stock_actual = stock_actual + $2::numeric, updated_at=now() WHERE id=$1::uuid`, [viejoProductoId, viejoBase]);
      await client.query(
        `INSERT INTO ${tMov} (empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad, costo_unitario, origen, referencia, fecha, venta_id, created_by, usuario_nombre, observaciones)
         VALUES ($1::uuid,$2::uuid,$3,$4,'ENTRADA',$5::numeric,$6::numeric,'ajuste_manual',$7,now(),$8::uuid,$9,$10,$11)`,
        [empresaId, viejoProductoId, String(viejo.nombre ?? ""), String(viejo.sku ?? ""), viejoBase, num(viejo.costo_promedio), ref, ventaId, p.createdBy ?? null, p.usuarioNombre ?? null, obs]
      );
    }
    if (nuevo.controla_stock !== false && nuevoBase > 0) {
      await client.query(`UPDATE ${tProd} SET stock_actual = GREATEST(0, stock_actual - $2::numeric), updated_at=now() WHERE id=$1::uuid`, [p.nuevoProductoId, nuevoBase]);
      await client.query(
        `INSERT INTO ${tMov} (empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad, costo_unitario, origen, referencia, fecha, venta_id, created_by, usuario_nombre, observaciones)
         VALUES ($1::uuid,$2::uuid,$3,$4,'SALIDA',$5::numeric,$6::numeric,'ajuste_manual',$7,now(),$8::uuid,$9,$10,$11)`,
        [empresaId, p.nuevoProductoId, String(nuevo.nombre ?? ""), String(nuevo.sku ?? ""), nuevoBase, num(nuevo.costo_promedio), ref, ventaId, p.createdBy ?? null, p.usuarioNombre ?? null, obs]
      );
    }

    // 6) Actualizar la línea (nuevo producto, precio, IVA).
    const totalLinea = Math.round(p.nuevaCantidad * p.nuevoPrecioVenta);
    const montoIva = calcIva(p.nuevoTipoIva, totalLinea);
    const subtotalLinea = totalLinea - montoIva;
    await client.query(
      `UPDATE ${tItems} SET producto_id=$2::uuid, producto_nombre=$3, sku=$4, cantidad=$5::numeric,
              precio_venta=$6::numeric, precio_venta_original=$6::numeric, tipo_iva=$7, tipo_precio='minorista',
              subtotal=$8::numeric, monto_iva=$9::numeric, total_linea=$10::numeric,
              cantidad_total_base=$5::numeric, costo_unitario=$11::numeric,
              presentacion_id=NULL, presentacion_nombre=NULL, presentacion_cantidad_base=NULL, updated_at=now()
        WHERE id=$1::uuid`,
      [p.itemId, p.nuevoProductoId, String(nuevo.nombre ?? ""), String(nuevo.sku ?? ""), p.nuevaCantidad,
       p.nuevoPrecioVenta, p.nuevoTipoIva, subtotalLinea, montoIva, totalLinea, num(nuevo.costo_promedio)]
    );

    // 7) Recalcular totales de la venta (suma de líneas) - retención.
    const sumQ = await client.query(
      `SELECT COALESCE(SUM(subtotal),0) sub, COALESCE(SUM(monto_iva),0) iva, COALESCE(SUM(total_linea),0) tot
         FROM ${tItems} WHERE venta_id=$1::uuid AND empresa_id=$2::uuid`,
      [ventaId, empresaId]
    );
    const sums = sumQ.rows[0] as Record<string, unknown>;
    const ret = num(v.ret);
    const totalAnterior = num(v.total);
    const totalNuevo = Math.round(num(sums.tot)) - ret;
    await client.query(
      `UPDATE ${tVentas} SET subtotal=$2::numeric, monto_iva=$3::numeric, total=$4::numeric, updated_at=now() WHERE id=$1::uuid`,
      [ventaId, Math.round(num(sums.sub)), Math.round(num(sums.iva)), totalNuevo]
    );

    // 8) Factura autoimpresor: recalcular liquidación de IVA (mismo número).
    const liqQ = await client.query(
      `SELECT tipo_iva, total_linea, monto_iva FROM ${tItems} WHERE venta_id=$1::uuid AND empresa_id=$2::uuid`,
      [ventaId, empresaId]
    );
    let g10 = 0, i10 = 0, g5 = 0, i5 = 0, ex = 0;
    for (const r of liqQ.rows as Array<Record<string, unknown>>) {
      const tl = num(r.total_linea), mi = num(r.monto_iva), ti = String(r.tipo_iva);
      if (ti === "10%") { g10 += tl - mi; i10 += mi; }
      else if (ti === "5%") { g5 += tl - mi; i5 += mi; }
      else ex += tl;
    }
    await client.query(
      `UPDATE ${tFa} SET gravado_10=$2::numeric, iva_10=$3::numeric, gravado_5=$4::numeric, iva_5=$5::numeric,
              exentas=$6::numeric, total=$7::numeric WHERE venta_id=$1::uuid AND empresa_id=$8::uuid`,
      [ventaId, Math.round(g10), Math.round(i10), Math.round(g5), Math.round(i5), Math.round(ex), totalNuevo, empresaId]
    );

    // 9) Detalle de pago (no mixto → una sola fila): ajustar el monto al nuevo total.
    await client.query(
      `UPDATE ${tPagos} SET monto=$2::numeric, updated_at=now() WHERE venta_id=$1::uuid AND empresa_id=$3::uuid`,
      [ventaId, totalNuevo, empresaId]
    );

    await client.query("COMMIT");
    return {
      numero_control: numeroControl,
      total_anterior: totalAnterior,
      total_nuevo: totalNuevo,
      diferencia: totalNuevo - totalAnterior,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
