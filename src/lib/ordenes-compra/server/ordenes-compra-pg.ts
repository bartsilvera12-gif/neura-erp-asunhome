/**
 * PG directo para Órdenes de Compra (OC). Mismo patrón que compras-pg:
 * pool singleton + queries parametrizadas + identifier escape.
 *
 * La OC NO impacta stock. Al "recibir" se delega en insertComprasConImpacto
 * (compras-pg) para crear la compra real y recién ahí mover inventario; luego
 * se marca la OC como 'recibida' con el numero_control de la compra.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import {
  insertComprasConImpactoTx,
  type CompraHeaderInput,
  type CompraItemInput,
} from "@/lib/compras/server/compras-pg";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export interface OrdenCompraRow {
  id: string;
  empresa_id: string;
  numero_oc: string;
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: string | number;
  cantidad_recibida: string | number;
  moneda: string;
  tipo_cambio: string | number;
  costo_unitario_original: string | number;
  costo_unitario: string | number;
  iva_tipo: string;
  subtotal: string | number;
  monto_iva: string | number;
  total: string | number;
  precio_venta: string | number;
  margen_venta: string | number | null;
  tipo_pago: string;
  plazo_dias: number | null;
  estado: string;
  observacion: string | null;
  compra_numero_control: string | null;
  recibida_at: string | null;
  cancelada_at: string | null;
  cancelada_motivo: string | null;
  fecha: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  usuario_nombre: string | null;
}

const COLS = `
  id, empresa_id, numero_oc, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
  cantidad, cantidad_recibida, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
  iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
  tipo_pago, plazo_dias, estado, observacion,
  compra_numero_control, recibida_at, cancelada_at, cancelada_motivo,
  fecha, created_at, updated_at, created_by, usuario_nombre
`;

export interface OrdenCompraHeaderInput {
  proveedor_id: string;
  proveedor_nombre: string;
  moneda: string;
  tipo_cambio: number;
  tipo_pago: string;
  plazo_dias: number | null;
  observacion: string | null;
  created_by: string | null;
  usuario_nombre: string | null;
}

export interface OrdenCompraItemInput {
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  costo_unitario_original: number;
  costo_unitario: number;
  iva_tipo: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  precio_venta: number;
  margen_venta: number | null;
}

/** Lista todas las líneas de OC de la empresa (más recientes primero). */
export async function listOrdenesCompra(
  schemaRaw: string,
  empresaId: string
): Promise<OrdenCompraRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "ordenes_compra");
  const { rows } = await pool().query<OrdenCompraRow>(
    `SELECT ${COLS} FROM ${t} WHERE empresa_id = $1::uuid ORDER BY fecha DESC LIMIT 1000`,
    [empresaId]
  );
  return rows;
}

/** Devuelve todas las líneas de una OC por numero_oc. */
export async function getOrdenCompra(
  schemaRaw: string,
  empresaId: string,
  numeroOc: string
): Promise<OrdenCompraRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "ordenes_compra");
  const { rows } = await pool().query<OrdenCompraRow>(
    `SELECT ${COLS} FROM ${t}
      WHERE empresa_id = $1::uuid AND numero_oc = $2
      ORDER BY created_at ASC`,
    [empresaId, numeroOc]
  );
  return rows;
}

/** Próximo OC-XXXXXX leyendo el máximo existente. */
async function nextNumeroOc(
  client: import("pg").PoolClient,
  schema: string,
  empresaId: string
): Promise<string> {
  const t = quoteSchemaTable(schema, "ordenes_compra");
  const { rows } = await client.query<{ maxn: number | null }>(
    `SELECT COALESCE(MAX(
       CASE WHEN numero_oc ~ '^OC-[0-9]+$'
            THEN (substring(numero_oc from 4))::int
            ELSE 0 END
     ), 0) AS maxn
     FROM ${t} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  const next = Number(rows[0]?.maxn ?? 0) + 1;
  return `OC-${String(next).padStart(6, "0")}`;
}

export interface OrdenCompraResult {
  numero_oc: string;
  ordenes: OrdenCompraRow[];
}

/** Crea una OC multiproducto (N filas con un único numero_oc). Sin impacto en stock. */
export async function insertOrdenCompra(
  schemaRaw: string,
  empresaId: string,
  header: OrdenCompraHeaderInput,
  items: OrdenCompraItemInput[]
): Promise<OrdenCompraResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("La orden de compra no tiene productos.");
  }
  const t = quoteSchemaTable(schema, "ordenes_compra");
  const client = await pool().connect();
  const inserted: OrdenCompraRow[] = [];
  try {
    await client.query("BEGIN");
    const numero = await nextNumeroOc(client, schema, empresaId);
    for (const it of items) {
      const { rows } = await client.query<OrdenCompraRow>(
        `INSERT INTO ${t} (
           empresa_id, numero_oc, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
           cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
           iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
           tipo_pago, plazo_dias, estado, observacion, fecha, created_by, usuario_nombre
         ) VALUES (
           $1::uuid, $2, $3::uuid, $4, $5::uuid, $6,
           $7::numeric, $8, $9::numeric, $10::numeric, $11::numeric,
           $12, $13::numeric, $14::numeric, $15::numeric, $16::numeric, $17::numeric,
           $18, $19::integer, 'pendiente', $20, now(), $21::uuid, $22
         )
         RETURNING ${COLS}`,
        [
          empresaId, numero, header.proveedor_id, header.proveedor_nombre,
          it.producto_id, it.producto_nombre,
          it.cantidad, header.moneda, header.tipo_cambio,
          it.costo_unitario_original, it.costo_unitario,
          it.iva_tipo, it.subtotal, it.monto_iva, it.total, it.precio_venta, it.margen_venta,
          header.tipo_pago, header.plazo_dias, header.observacion,
          header.created_by, header.usuario_nombre,
        ]
      );
      inserted.push(rows[0]);
    }
    await client.query("COMMIT");
    return { numero_oc: numero, ordenes: inserted };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Elimina físicamente una OC (todas sus líneas). Solo permitido si TODAS las
 * líneas están en 'pendiente' (nada recibido ni cancelado). Para el resto de
 * estados usar anular/cancelar, que preservan trazabilidad.
 */
export async function deleteOrdenCompra(
  schemaRaw: string,
  empresaId: string,
  numeroOc: string
): Promise<number> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "ordenes_compra");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const chk = await client.query<{ estado: string }>(
      `SELECT estado FROM ${t} WHERE empresa_id = $1::uuid AND numero_oc = $2 FOR UPDATE`,
      [empresaId, numeroOc]
    );
    if (chk.rowCount === 0) throw new Error("Orden de compra no encontrada.");
    if (chk.rows.some((r) => r.estado !== "pendiente")) {
      throw new Error("Solo se pueden eliminar OCs en estado 'pendiente'. Anulala si ya fue recibida.");
    }
    const del = await client.query(
      `DELETE FROM ${t} WHERE empresa_id = $1::uuid AND numero_oc = $2`,
      [empresaId, numeroOc]
    );
    await client.query("COMMIT");
    return del.rowCount ?? 0;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Actualiza una OC en 'pendiente' reemplazando header + items. Estrategia
 * simple: DELETE todas las filas + INSERT las nuevas con el MISMO numero_oc.
 */
export async function updateOrdenCompra(
  schemaRaw: string,
  empresaId: string,
  numeroOc: string,
  header: OrdenCompraHeaderInput,
  items: OrdenCompraItemInput[]
): Promise<OrdenCompraResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("La orden de compra no tiene productos.");
  }
  const t = quoteSchemaTable(schema, "ordenes_compra");
  const client = await pool().connect();
  const inserted: OrdenCompraRow[] = [];
  try {
    await client.query("BEGIN");
    const chk = await client.query<{ estado: string; fecha: string }>(
      `SELECT estado, fecha FROM ${t} WHERE empresa_id = $1::uuid AND numero_oc = $2 FOR UPDATE`,
      [empresaId, numeroOc]
    );
    if (chk.rowCount === 0) throw new Error("Orden de compra no encontrada.");
    if (chk.rows.some((r) => r.estado !== "pendiente")) {
      throw new Error("Solo se pueden editar OCs en estado 'pendiente'.");
    }
    const fechaOriginal = chk.rows[0].fecha;
    await client.query(
      `DELETE FROM ${t} WHERE empresa_id = $1::uuid AND numero_oc = $2`,
      [empresaId, numeroOc]
    );
    for (const it of items) {
      const { rows } = await client.query<OrdenCompraRow>(
        `INSERT INTO ${t} (
           empresa_id, numero_oc, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
           cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
           iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
           tipo_pago, plazo_dias, estado, observacion, fecha, created_by, usuario_nombre
         ) VALUES (
           $1::uuid, $2, $3::uuid, $4, $5::uuid, $6,
           $7::numeric, $8, $9::numeric, $10::numeric, $11::numeric,
           $12, $13::numeric, $14::numeric, $15::numeric, $16::numeric, $17::numeric,
           $18, $19::integer, 'pendiente', $20, $21::timestamptz, $22::uuid, $23
         )
         RETURNING ${COLS}`,
        [
          empresaId, numeroOc, header.proveedor_id, header.proveedor_nombre,
          it.producto_id, it.producto_nombre,
          it.cantidad, header.moneda, header.tipo_cambio,
          it.costo_unitario_original, it.costo_unitario,
          it.iva_tipo, it.subtotal, it.monto_iva, it.total, it.precio_venta, it.margen_venta,
          header.tipo_pago, header.plazo_dias, header.observacion,
          fechaOriginal, header.created_by, header.usuario_nombre,
        ]
      );
      inserted.push(rows[0]);
    }
    await client.query("COMMIT");
    return { numero_oc: numeroOc, ordenes: inserted };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cancela una OC (todas sus líneas). Solo mientras esté 'pendiente' (nada
 * recibido todavía) — si ya tiene alguna recepción parcial, no se puede
 * cancelar por acá para no perder la trazabilidad de lo ya comprado/recibido.
 */
export async function cancelarOrdenCompra(
  schemaRaw: string,
  empresaId: string,
  numeroOc: string,
  motivo: string | null
): Promise<number> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "ordenes_compra");
  const { rowCount } = await pool().query(
    `UPDATE ${t}
        SET estado = 'cancelada', cancelada_at = now(),
            cancelada_motivo = $3, updated_at = now()
      WHERE empresa_id = $1::uuid AND numero_oc = $2 AND estado = 'pendiente'`,
    [empresaId, numeroOc, (motivo ?? "").trim().slice(0, 500) || null]
  );
  return rowCount ?? 0;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * IVA incluido (igual criterio que en la creación de la OC/compra): el monto
 * ya contiene el IVA; se desglosa desde adentro. Se usa para recalcular
 * subtotal/monto_iva cuando la cantidad recibida es menor a la pedida.
 */
function desglosarIva(bruto: number, ivaTipo: string): { subtotal: number; monto_iva: number } {
  if (ivaTipo === "exenta") return { subtotal: bruto, monto_iva: 0 };
  const factor = ivaTipo === "5" ? 1.05 : 1.1;
  const subtotal = bruto / factor;
  return { subtotal, monto_iva: bruto - subtotal };
}

/** Se intentó recibir más cantidad que la pendiente sin autorizar el excedente. */
export class ExcedenteRecepcionError extends Error {
  detalle: Array<{ producto_nombre: string; pendiente: number; intentado: number }>;
  constructor(detalle: Array<{ producto_nombre: string; pendiente: number; intentado: number }>) {
    super("Se intentó recibir más cantidad que la pendiente.");
    this.name = "ExcedenteRecepcionError";
    this.detalle = detalle;
  }
}

export interface RecepcionItemInput {
  /** id de la fila de ordenes_compra (línea/producto) que se está recibiendo. */
  ordenItemId: string;
  /** Cantidad recibida EN ESTA recepción (no acumulada). */
  cantidadRecibidaAhora: number;
  observacion?: string | null;
}

export interface ConfirmarRecepcionParams {
  numeroOc: string;
  nroTimbrado: string;
  numeroFactura: string;
  fechaFactura: string | null;
  tipoPago: string;
  plazoDias: number | null;
  observacionCompra: string | null;
  comprobante: {
    url: string | null;
    storage_path: string | null;
    nombre: string | null;
    mime_type: string | null;
  };
  items: RecepcionItemInput[];
  /** Autoriza explícitamente recibir más de lo pendiente (excedente). */
  permitirExcedente: boolean;
  createdBy: string | null;
  usuarioNombre: string | null;
}

export interface ConfirmarRecepcionResult {
  numero_oc: string;
  numero_control: string;
  estado_oc: "recibida_parcial" | "recibida_total";
  movimiento_warning: string | null;
}

/**
 * Confirma la recepción (parcial o total) de una OC: genera la COMPRA real
 * SOLO con los productos y cantidades efectivamente recibidas (impacta stock
 * solo por eso), acumula `cantidad_recibida` por línea, y deja la OC en
 * 'recibida_parcial' o 'recibida_total' según corresponda. Puede llamarse
 * varias veces sobre la misma OC hasta completar la recepción.
 *
 * Todo en una única transacción: lockea las filas de la OC (FOR UPDATE) para
 * que dos recepciones concurrentes de la misma OC nunca duplican stock ni
 * pisan `cantidad_recibida`.
 */
export async function confirmarRecepcionOrdenCompra(
  schemaRaw: string,
  empresaId: string,
  params: ConfirmarRecepcionParams
): Promise<ConfirmarRecepcionResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tOC = quoteSchemaTable(schema, "ordenes_compra");
  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    const { rows: filas } = await client.query<OrdenCompraRow>(
      `SELECT ${COLS} FROM ${tOC} WHERE empresa_id = $1::uuid AND numero_oc = $2 FOR UPDATE`,
      [empresaId, params.numeroOc]
    );
    if (filas.length === 0) throw new Error("Orden de compra no encontrada.");
    if (filas.some((f) => f.estado === "cancelada")) {
      throw new Error("La orden de compra está cancelada.");
    }
    if (filas.every((f) => f.estado === "recibida_total")) {
      throw new Error("La orden de compra ya fue recibida por completo.");
    }
    const cab = filas[0];
    const filaPorId = new Map(filas.map((f) => [f.id, f]));

    // Validar ítems recibidos contra la OC (fuente de verdad).
    const excedentes: Array<{ producto_nombre: string; pendiente: number; intentado: number }> = [];
    for (const it of params.items) {
      if (it.cantidadRecibidaAhora <= 0) continue;
      const fila = filaPorId.get(it.ordenItemId);
      if (!fila) throw new Error("Ítem de la orden de compra inválido.");
      if (it.cantidadRecibidaAhora < 0) throw new Error("La cantidad recibida no puede ser negativa.");
      const pendiente = Math.max(0, num(fila.cantidad) - num(fila.cantidad_recibida));
      if (it.cantidadRecibidaAhora > pendiente) {
        excedentes.push({ producto_nombre: fila.producto_nombre, pendiente, intentado: it.cantidadRecibidaAhora });
      }
    }
    if (excedentes.length > 0 && !params.permitirExcedente) {
      throw new ExcedenteRecepcionError(excedentes);
    }

    const itemsARecibir = params.items.filter((it) => it.cantidadRecibidaAhora > 0);
    if (itemsARecibir.length === 0) {
      throw new Error("Debés confirmar al menos un producto recibido.");
    }

    // Compra real: SOLO los productos/cantidades efectivamente recibidas,
    // recalculando subtotal/IVA/total en base a la cantidad recibida ahora.
    const compraItems: CompraItemInput[] = itemsARecibir.map((it) => {
      const fila = filaPorId.get(it.ordenItemId)!;
      const totalLinea = num(fila.costo_unitario) * it.cantidadRecibidaAhora;
      const { subtotal, monto_iva } = desglosarIva(totalLinea, fila.iva_tipo);
      return {
        producto_id: fila.producto_id,
        producto_nombre: fila.producto_nombre,
        cantidad: it.cantidadRecibidaAhora,
        costo_unitario_original: num(fila.costo_unitario_original),
        costo_unitario: num(fila.costo_unitario),
        iva_tipo: fila.iva_tipo,
        subtotal: Math.round(subtotal),
        monto_iva: Math.round(monto_iva),
        total: Math.round(totalLinea),
        precio_venta: num(fila.precio_venta),
        margen_venta: fila.margen_venta != null ? num(fila.margen_venta) : null,
        orden_compra_item_id: fila.id,
      };
    });

    const header: CompraHeaderInput = {
      proveedor_id: cab.proveedor_id,
      proveedor_nombre: cab.proveedor_nombre,
      moneda: cab.moneda === "USD" ? "USD" : "PYG",
      tipo_cambio: num(cab.tipo_cambio) || 1,
      tipo_pago: params.tipoPago === "credito" ? "credito" : "contado",
      plazo_dias: params.plazoDias,
      nro_timbrado: params.nroTimbrado.trim().toUpperCase(),
      numero_factura: params.numeroFactura.trim(),
      fecha_factura: params.fechaFactura,
      observacion: params.observacionCompra,
      orden_compra_numero: params.numeroOc,
      comprobante_url: params.comprobante.url,
      comprobante_storage_path: params.comprobante.storage_path,
      comprobante_nombre: params.comprobante.nombre,
      comprobante_mime_type: params.comprobante.mime_type,
      created_by: params.createdBy,
      usuario_nombre: params.usuarioNombre,
    };

    const out = await insertComprasConImpactoTx(client, schema, empresaId, header, compraItems);

    // Acumular cantidad_recibida por línea.
    for (const it of itemsARecibir) {
      await client.query(
        `UPDATE ${tOC} SET cantidad_recibida = cantidad_recibida + $2::numeric, updated_at = now()
          WHERE id = $1::uuid`,
        [it.ordenItemId, it.cantidadRecibidaAhora]
      );
    }

    // Recalcular estado global de la OC con los valores ya actualizados.
    const { rows: actualizadas } = await client.query<{ cantidad: string; cantidad_recibida: string }>(
      `SELECT cantidad, cantidad_recibida FROM ${tOC} WHERE empresa_id = $1::uuid AND numero_oc = $2`,
      [empresaId, params.numeroOc]
    );
    const completa = actualizadas.every((f) => num(f.cantidad_recibida) >= num(f.cantidad));
    const estadoFinal: "recibida_parcial" | "recibida_total" = completa ? "recibida_total" : "recibida_parcial";

    await client.query(
      `UPDATE ${tOC}
          SET estado = $3,
              compra_numero_control = $4,
              recibida_at = CASE WHEN $3 = 'recibida_total' THEN now() ELSE recibida_at END,
              updated_at = now()
        WHERE empresa_id = $1::uuid AND numero_oc = $2`,
      [empresaId, params.numeroOc, estadoFinal, out.numero_control]
    );

    await client.query("COMMIT");
    return {
      numero_oc: params.numeroOc,
      numero_control: out.numero_control,
      estado_oc: estadoFinal,
      movimiento_warning: out.movimiento_warning,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}
