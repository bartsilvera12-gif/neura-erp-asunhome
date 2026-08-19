/**
 * PG directo para Compras. Mismo patron que productos-pg / proveedores-pg:
 * pool singleton + queries parametrizadas + identifier escape.
 *
 * insertCompra realiza la operacion en transaccion:
 *   1) inserta compra con numero_control generado por secuencia local
 *   2) inserta movimiento ENTRADA (origen=compra) con audit
 *   3) actualiza producto.precio_venta + costo_promedio + stock_actual
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

/**
 * Upsert best-effort de la relación producto↔proveedor en `proveedor_productos`.
 * - Actualiza `costo_habitual` con el último costo_unitario de la compra.
 * - Marca `es_principal=true` SOLO si el producto aún no tiene un proveedor
 *   principal (respeta el índice parcial único un_principal).
 * - NUNCA toca `marca` (se preserva el valor existente; null si es nueva fila).
 * Se ejecuta dentro de un SAVEPOINT: si falla, no aborta la compra.
 */
async function upsertProveedorProducto(
  client: import("pg").PoolClient,
  tPP: string,
  empresaId: string,
  productoId: string,
  proveedorId: string,
  costoHabitual: number
): Promise<void> {
  if (!proveedorId) return; // sin proveedor no hay relación que mantener
  try {
    await client.query("SAVEPOINT sp_pp");
    await client.query(
      `INSERT INTO ${tPP} (empresa_id, producto_id, proveedor_id, costo_habitual, es_principal, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric,
               NOT EXISTS (SELECT 1 FROM ${tPP} pp
                            WHERE pp.empresa_id = $1::uuid AND pp.producto_id = $2::uuid AND pp.es_principal),
               now())
       ON CONFLICT (empresa_id, producto_id, proveedor_id)
       DO UPDATE SET costo_habitual = EXCLUDED.costo_habitual, updated_at = now()`,
      [empresaId, productoId, proveedorId, costoHabitual]
    );
    await client.query("RELEASE SAVEPOINT sp_pp");
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT sp_pp").catch(() => null);
    console.error("[compras-pg] upsert proveedor_productos fallo (best-effort)", {
      empresaId, productoId, proveedorId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export interface CompraRow {
  id: string;
  empresa_id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: string | number;
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
  nro_timbrado: string;
  numero_factura: string | null;
  fecha_factura: string | null;
  observacion: string | null;
  orden_compra_numero: string | null;
  orden_compra_item_id: string | null;
  numero_control: string;
  estado: string;
  fecha: string;
  comprobante_url: string | null;
  comprobante_storage_path: string | null;
  comprobante_nombre: string | null;
  comprobante_mime_type: string | null;
  anulada_at: string | null;
  anulada_por: string | null;
  anulada_motivo: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  usuario_nombre: string | null;
}

const COLS = `
  id, empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
  cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
  iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
  tipo_pago, plazo_dias, nro_timbrado, numero_factura, fecha_factura, observacion,
  orden_compra_numero, orden_compra_item_id,
  numero_control, estado, fecha,
  comprobante_url, comprobante_storage_path, comprobante_nombre, comprobante_mime_type,
  anulada_at, anulada_por, anulada_motivo,
  created_at, updated_at, created_by, usuario_nombre
`;

export interface InsertCompraInput {
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  moneda: string;
  tipo_cambio: number;
  costo_unitario_original: number;
  costo_unitario: number;
  iva_tipo: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  precio_venta: number;
  margen_venta: number | null;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  created_by: string | null;
  usuario_nombre: string | null;
}

export async function listCompras(
  schemaRaw: string,
  empresaId: string
): Promise<CompraRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "compras");
  const { rows } = await pool().query<CompraRow>(
    `SELECT ${COLS} FROM ${t} WHERE empresa_id = $1::uuid ORDER BY fecha DESC LIMIT 500`,
    [empresaId]
  );
  return rows;
}

/** Genera proximo COMP-XXXXXX leyendo el maximo existente. */
async function nextNumeroControl(
  client: import("pg").PoolClient,
  schema: string,
  empresaId: string
): Promise<string> {
  const t = quoteSchemaTable(schema, "compras");
  const { rows } = await client.query<{ maxn: number | null }>(
    `SELECT COALESCE(MAX(
       CASE WHEN numero_control ~ '^COMP-[0-9]+$'
            THEN (substring(numero_control from 6))::int
            ELSE 0 END
     ), 0) AS maxn
     FROM ${t} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  const next = Number(rows[0]?.maxn ?? 0) + 1;
  return `COMP-${String(next).padStart(6, "0")}`;
}

export interface CompraResult {
  compra: CompraRow;
  movimiento_id: string | null;
  movimiento_warning: string | null;
}

/** Cabecera compartida por todas las líneas de una compra multiproducto. */
export interface CompraHeaderInput {
  proveedor_id: string;
  proveedor_nombre: string;
  moneda: string;
  tipo_cambio: number;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  numero_factura: string | null;
  /** Fecha de la factura del proveedor (YYYY-MM-DD). Distinta de `fecha` (registro). */
  fecha_factura?: string | null;
  observacion?: string | null;
  orden_compra_numero: string | null;
  comprobante_url: string | null;
  comprobante_storage_path: string | null;
  comprobante_nombre: string | null;
  comprobante_mime_type: string | null;
  created_by: string | null;
  usuario_nombre: string | null;
  /** Si true y hay caja abierta, se genera egreso en caja_movimientos. Aplica solo a contado + PYG. */
  descuenta_caja?: boolean;
  /** Fecha de la compra (YYYY-MM-DD). Si null/undefined, usa now(). Permite backdate. */
  fecha?: string | null;
}

/** Una línea (producto) de la compra. */
export interface CompraItemInput {
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
  /** Línea exacta de ordenes_compra que esta fila recibe (recepción de OC). */
  orden_compra_item_id?: string | null;
}

export interface ComprasMultiResult {
  numero_control: string;
  compras: CompraRow[];
  movimiento_warning: string | null;
}

/**
 * Núcleo de "insertar compra multiproducto" reutilizable DENTRO de una
 * transacción ya abierta por el caller (ej. confirmarRecepcionOrdenCompra, que
 * necesita lockear filas de ordenes_compra + insertar la compra + actualizar
 * la OC como una sola operación atómica). NO abre ni cierra transacción.
 */
export async function insertComprasConImpactoTx(
  client: import("pg").PoolClient,
  schema: string,
  empresaId: string,
  header: CompraHeaderInput,
  items: CompraItemInput[]
): Promise<ComprasMultiResult> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("La compra no tiene productos.");
  }
  const tC = quoteSchemaTable(schema, "compras");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const tPP = quoteSchemaTable(schema, "proveedor_productos");

  const insertedRows: CompraRow[] = [];
  const warnings: string[] = [];
  const numero = await nextNumeroControl(client, schema, empresaId);

  for (const it of items) {
    const { rows: compraRows } = await client.query<CompraRow>(
      `INSERT INTO ${tC} (
         empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
         cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
         iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
         tipo_pago, plazo_dias, nro_timbrado, numero_factura, fecha_factura, observacion,
         orden_compra_numero, orden_compra_item_id,
         numero_control, estado, fecha,
         comprobante_url, comprobante_storage_path, comprobante_nombre, comprobante_mime_type,
         created_by, usuario_nombre
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4::uuid, $5,
         $6::numeric, $7, $8::numeric, $9::numeric, $10::numeric,
         $11, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
         $17, $18::integer, $19, $20, $21::date, $22,
         $23, $24::uuid,
         $25, 'registrada', COALESCE($32::timestamptz, now()),
         $26, $27, $28, $29,
         $30::uuid, $31
       )
       RETURNING ${COLS}`,
      [
        empresaId, header.proveedor_id, header.proveedor_nombre,
        it.producto_id, it.producto_nombre,
        it.cantidad, header.moneda, header.tipo_cambio,
        it.costo_unitario_original, it.costo_unitario,
        it.iva_tipo, it.subtotal, it.monto_iva, it.total, it.precio_venta, it.margen_venta,
        header.tipo_pago, header.plazo_dias, header.nro_timbrado,
        header.numero_factura, header.fecha_factura ?? null, header.observacion ?? null,
        header.orden_compra_numero, it.orden_compra_item_id ?? null,
        numero,
        header.comprobante_url, header.comprobante_storage_path,
        header.comprobante_nombre, header.comprobante_mime_type,
        header.created_by, header.usuario_nombre,
        header.fecha ?? null,
      ]
    );
    insertedRows.push(compraRows[0]);

    // Movimiento ENTRADA por línea (best-effort).
    try {
      await client.query(
        `INSERT INTO ${tM} (
           empresa_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia, fecha,
           created_by, usuario_nombre
         )
         SELECT $1::uuid, $2::uuid, $3, COALESCE(p.sku, ''),
                'ENTRADA', $4::numeric, $5::numeric, 'compra', $6, now(),
                $7::uuid, $8
         FROM ${tP} p WHERE p.id = $2::uuid`,
        [empresaId, it.producto_id, it.producto_nombre, it.cantidad,
         it.costo_unitario, numero, header.created_by, header.usuario_nombre]
      );
    } catch (movErr) {
      const msg = movErr instanceof Error ? movErr.message : String(movErr);
      console.error("[compras-pg] movimiento ENTRADA fallo (multi)", {
        schema, empresaId, numero, producto: it.producto_id, message: msg,
      });
      warnings.push(it.producto_nombre);
    }

    // Actualizar producto: stock + costo_promedio siempre.
    // precio_venta SOLO se actualiza si la compra trae un precio > 0 (productos
    // vendibles). Para materia prima / insumos sin precio (0 o vacío) mantenemos
    // el precio actual: nunca lo pisamos con 0 ni con un valor inventado.
    await client.query(
      `UPDATE ${tP}
          SET stock_actual = stock_actual + $1::numeric,
              costo_promedio = $2::numeric,
              precio_venta = CASE WHEN $3::numeric > 0 THEN $3::numeric ELSE precio_venta END,
              updated_at = now()
        WHERE id = $4::uuid AND empresa_id = $5::uuid`,
      [it.cantidad, it.costo_unitario, it.precio_venta, it.producto_id, empresaId]
    );

    // Mantener relación producto↔proveedor (costo_habitual). No pisa marca.
    await upsertProveedorProducto(
      client, tPP, empresaId, it.producto_id, header.proveedor_id, it.costo_unitario
    );
  }

  // Egreso en caja si la compra se paga en efectivo desde la caja abierta.
  // Aplica solo a contado + PYG. Si el usuario pidio descontar pero no hay
  // caja abierta, la transaccion falla para no dejar la compra desincronizada.
  if (header.descuenta_caja && header.tipo_pago === "contado" && header.moneda === "PYG") {
    const tCajas = quoteSchemaTable(schema, "cajas");
    const tCm = quoteSchemaTable(schema, "caja_movimientos");
    const totalCompra = insertedRows.reduce((s, r) => s + (Number(r.total) || 0), 0);
    const cajaR = await client.query<{ id: string }>(
      `SELECT id FROM ${tCajas}
        WHERE empresa_id = $1::uuid AND estado = 'abierta'
        ORDER BY fecha_apertura DESC LIMIT 1`,
      [empresaId]
    );
    if (cajaR.rowCount === 0) {
      throw new Error("No hay caja abierta para descontar esta compra. Abrí una caja o desactivá 'Descontar de caja'.");
    }
    const cajaId = cajaR.rows[0].id;
    const concepto = `Compra ${numero}: ${header.proveedor_nombre}`.slice(0, 200);
    await client.query(
      `INSERT INTO ${tCm} (empresa_id, caja_id, tipo, concepto, monto, medio_pago, usuario_id, usuario_email)
       VALUES ($1::uuid, $2::uuid, 'egreso', $3, $4::numeric, 'efectivo', $5::uuid, $6)`,
      [empresaId, cajaId, concepto, totalCompra, header.created_by, header.usuario_nombre]
    );
  }

  return {
    numero_control: numero,
    compras: insertedRows,
    movimiento_warning: warnings.length
      ? `La compra se guardó pero no se registró el movimiento de entrada para: ${warnings.join(", ")}.`
      : null,
  };
}

/**
 * Compra MULTIPRODUCTO (modelo plano): N filas en `compras` que comparten un
 * único `numero_control`. Una sola transacción; por cada ítem inserta la fila,
 * el movimiento ENTRADA y actualiza stock + costo_promedio + precio_venta del
 * producto. Requiere que `numero_control` NO sea único (índice no-único).
 *
 * La compra simple es el caso N=1; el endpoint envuelve el body viejo en items=[…].
 */
export async function insertComprasConImpacto(
  schemaRaw: string,
  empresaId: string,
  header: CompraHeaderInput,
  items: CompraItemInput[]
): Promise<ComprasMultiResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out = await insertComprasConImpactoTx(client, schema, empresaId, header, items);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

export async function insertCompraConImpacto(
  schemaRaw: string,
  empresaId: string,
  d: InsertCompraInput
): Promise<CompraResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");
  const tPP = quoteSchemaTable(schema, "proveedor_productos");

  const client = await pool().connect();
  let movimientoId: string | null = null;
  let movimientoWarning: string | null = null;
  try {
    await client.query("BEGIN");

    const numero = await nextNumeroControl(client, schema, empresaId);

    const { rows: compraRows } = await client.query<CompraRow>(
      `INSERT INTO ${tC} (
         empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
         cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
         iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
         tipo_pago, plazo_dias, nro_timbrado, numero_control, estado, fecha,
         created_by, usuario_nombre
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4::uuid, $5,
         $6::numeric, $7, $8::numeric, $9::numeric, $10::numeric,
         $11, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
         $17, $18::integer, $19, $20, 'registrada', now(),
         $21::uuid, $22
       )
       RETURNING ${COLS}`,
      [
        empresaId,
        d.proveedor_id,
        d.proveedor_nombre,
        d.producto_id,
        d.producto_nombre,
        d.cantidad,
        d.moneda,
        d.tipo_cambio,
        d.costo_unitario_original,
        d.costo_unitario,
        d.iva_tipo,
        d.subtotal,
        d.monto_iva,
        d.total,
        d.precio_venta,
        d.margen_venta,
        d.tipo_pago,
        d.plazo_dias,
        d.nro_timbrado,
        numero,
        d.created_by,
        d.usuario_nombre,
      ]
    );
    const compra = compraRows[0];

    // Movimiento ENTRADA (origen=compra). Best-effort: si falla, la compra
    // queda registrada pero anunciamos warning.
    try {
      const { rows: movRows } = await client.query<{ id: string }>(
        `INSERT INTO ${tM} (
           empresa_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia, fecha,
           created_by, usuario_nombre
         )
         SELECT $1::uuid, $2::uuid, $3, COALESCE(p.sku, ''),
                'ENTRADA', $4::numeric, $5::numeric, 'compra', $6, now(),
                $7::uuid, $8
         FROM ${tP} p WHERE p.id = $2::uuid
         RETURNING id`,
        [
          empresaId,
          d.producto_id,
          d.producto_nombre,
          d.cantidad,
          d.costo_unitario,
          numero,
          d.created_by,
          d.usuario_nombre,
        ]
      );
      movimientoId = movRows[0]?.id ?? null;
    } catch (movErr) {
      const msg = movErr instanceof Error ? movErr.message : String(movErr);
      console.error("[compras-pg] movimiento ENTRADA fallo", {
        schema, empresaId, numero, message: msg,
        code: (movErr as { code?: string })?.code,
        detail: (movErr as { detail?: string })?.detail,
      });
      movimientoWarning =
        "La compra se guardó pero no se pudo registrar el movimiento de entrada en inventario.";
    }

    // Actualizar producto: stock + costo_promedio siempre; precio_venta solo si > 0
    // (no pisamos el precio de insumos / materia prima con 0).
    await client.query(
      `UPDATE ${tP}
          SET stock_actual = stock_actual + $1::numeric,
              costo_promedio = $2::numeric,
              precio_venta = CASE WHEN $3::numeric > 0 THEN $3::numeric ELSE precio_venta END,
              updated_at = now()
        WHERE id = $4::uuid AND empresa_id = $5::uuid`,
      [d.cantidad, d.costo_unitario, d.precio_venta, d.producto_id, empresaId]
    );

    // Mantener relación producto↔proveedor (costo_habitual). No pisa marca.
    await upsertProveedorProducto(
      client, tPP, empresaId, d.producto_id, d.proveedor_id, d.costo_unitario
    );

    await client.query("COMMIT");
    return { compra, movimiento_id: movimientoId, movimiento_warning: movimientoWarning };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}
