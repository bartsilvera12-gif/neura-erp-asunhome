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
  /** Estado inicial de las filas ('registrada' por defecto, 'provisoria' para factura provisoria). */
  estado?: string;
  /** Si viene, se APPENDEA a ese numero_control (agregar productos a una provisoria) en vez de generar uno nuevo. */
  numero_control_existente?: string | null;
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
  // Para provisorias que se van cargando, se reutiliza el numero_control existente.
  const numero = header.numero_control_existente?.trim()
    ? header.numero_control_existente.trim()
    : await nextNumeroControl(client, schema, empresaId);
  const estadoFila = header.estado === "provisoria" ? "provisoria" : "registrada";

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
         $25, $33, COALESCE($32::timestamptz, now()),
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
        estadoFila,
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

/**
 * EDICIÓN COMPLETA de una compra ya registrada (productos, cantidades, costos).
 * Estrategia segura, en una sola transacción:
 *   1) valida que no tenga pagos registrados en cuentas por pagar
 *   2) revierte el stock de las líneas viejas + borra sus movimientos ENTRADA
 *   3) borra las líneas viejas y reinserta las nuevas con el MISMO numero_control
 *      (reaplicando stock, costo_promedio, precio_venta y proveedor_producto)
 *   4) si tenía cuenta por pagar (definitiva a crédito), la regenera con el nuevo total
 * Mantiene el estado (provisoria sigue provisoria).
 */
export async function editarCompraCompleta(
  schemaRaw: string,
  empresaId: string,
  numeroControl: string,
  header: CompraHeaderInput,
  items: CompraItemInput[]
): Promise<ComprasMultiResult> {
  const { calcularCuotas, addDaysYmd } = await import("@/lib/cuentas-por-pagar/server/cxp-pg");
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tP = quoteSchemaTable(schema, "productos");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tCxp = quoteSchemaTable(schema, "cuentas_por_pagar");
  const tCuo = quoteSchemaTable(schema, "compra_cuotas");
  const tPag = quoteSchemaTable(schema, "pagos_proveedores");
  const tProv = quoteSchemaTable(schema, "proveedores");
  const tPP = quoteSchemaTable(schema, "proveedor_productos");

  if (!Array.isArray(items) || items.length === 0) throw new Error("La compra debe tener al menos un producto.");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    const { rows: viejas } = await client.query<{ producto_id: string; producto_nombre: string; cantidad: string; costo_unitario: string; estado: string }>(
      `SELECT producto_id, producto_nombre, cantidad::text, costo_unitario::text, estado FROM ${tC}
        WHERE empresa_id = $1::uuid AND numero_control = $2 AND anulada_at IS NULL
        FOR UPDATE`,
      [empresaId, numeroControl]
    );
    if (viejas.length === 0) throw new Error("Compra no encontrada o anulada.");
    const estadoPrev = viejas[0].estado === "provisoria" ? "provisoria" : "registrada";

    // Guard: si hay cuenta por pagar con pagos registrados, no se edita.
    const { rows: cxpRows } = await client.query<{ id: string }>(
      `SELECT id FROM ${tCxp} WHERE empresa_id = $1::uuid AND compra_numero_control = $2`,
      [empresaId, numeroControl]
    );
    if (cxpRows.length > 0) {
      const { rows: pg } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${tPag} WHERE cuenta_por_pagar_id = $1::uuid`,
        [cxpRows[0].id]
      );
      if ((Number(pg[0]?.n) || 0) > 0) {
        throw new Error("La compra tiene pagos registrados en cuentas por pagar. Anulá los pagos antes de editar.");
      }
    }

    // ── Ajuste por DIFERENCIA (no borra el movimiento original, no re-suma) ────
    // Totales por producto: viejos vs nuevos. Solo se aplica el delta al stock y
    // se registra un movimiento de ajuste por esa diferencia. Así, re-guardar sin
    // cambios = delta 0 = stock intacto; y modificar 2→3 = solo +1.
    const oldByProd = new Map<string, { qty: number; costo: number; nombre: string }>();
    for (const v of viejas) {
      const pid = String(v.producto_id);
      const prev = oldByProd.get(pid);
      const qty = Number(v.cantidad) || 0;
      if (prev) prev.qty += qty;
      else oldByProd.set(pid, { qty, costo: Number(v.costo_unitario) || 0, nombre: v.producto_nombre });
    }
    const newByProd = new Map<string, { qty: number; item: CompraItemInput }>();
    for (const it of items) {
      const pid = String(it.producto_id);
      const prev = newByProd.get(pid);
      if (prev) prev.qty += Number(it.cantidad) || 0;
      else newByProd.set(pid, { qty: Number(it.cantidad) || 0, item: it });
    }

    const allPids = new Set<string>([...oldByProd.keys(), ...newByProd.keys()]);
    for (const pid of allPids) {
      const oldQty = oldByProd.get(pid)?.qty ?? 0;
      const nw = newByProd.get(pid);
      const newQty = nw?.qty ?? 0;
      const delta = newQty - oldQty; // + entra stock, - sale stock
      if (delta !== 0) {
        await client.query(
          `UPDATE ${tP} SET stock_actual = stock_actual + $1::numeric, updated_at = now()
            WHERE id = $2::uuid AND empresa_id = $3::uuid`,
          [delta, pid, empresaId]
        );
        const costoMov = delta > 0 ? (nw?.item.costo_unitario ?? 0) : (oldByProd.get(pid)?.costo ?? 0);
        const nombreMov = nw?.item.producto_nombre ?? oldByProd.get(pid)?.nombre ?? "";
        await client.query(
          `INSERT INTO ${tM} (
             empresa_id, producto_id, producto_nombre, producto_sku,
             tipo, cantidad, costo_unitario, origen, referencia, fecha, created_by, usuario_nombre
           )
           SELECT $1::uuid, $2::uuid, $3, COALESCE(p.sku, ''),
                  $4, $5::numeric, $6::numeric, 'ajuste_manual', $7, now(), $8::uuid, $9
             FROM ${tP} p WHERE p.id = $2::uuid`,
          [empresaId, pid, nombreMov, delta > 0 ? "ENTRADA" : "SALIDA",
           Math.abs(delta), costoMov, `EDIT-${numeroControl}`, header.created_by, header.usuario_nombre]
        );
      }
      // Actualizar costo/precio del producto que sigue en la compra (last cost wins).
      if (nw) {
        await client.query(
          `UPDATE ${tP}
              SET costo_promedio = $1::numeric,
                  precio_venta = CASE WHEN $2::numeric > 0 THEN $2::numeric ELSE precio_venta END,
                  updated_at = now()
            WHERE id = $3::uuid AND empresa_id = $4::uuid`,
          [nw.item.costo_unitario, nw.item.precio_venta, pid, empresaId]
        );
        await upsertProveedorProducto(client, tPP, empresaId, pid, header.proveedor_id, nw.item.costo_unitario);
      }
    }

    // Reemplazar las FILAS de la compra (registro de la factura), SIN tocar stock
    // ni crear otro movimiento (ya lo hizo el ajuste por diferencia de arriba).
    await client.query(`DELETE FROM ${tC} WHERE empresa_id = $1::uuid AND numero_control = $2`, [empresaId, numeroControl]);
    const insertedRows: CompraRow[] = [];
    for (const it of items) {
      const { rows: cr } = await client.query<CompraRow>(
        `INSERT INTO ${tC} (
           empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
           cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
           iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
           tipo_pago, plazo_dias, nro_timbrado, numero_factura, fecha_factura, observacion,
           numero_control, estado, fecha, created_by, usuario_nombre
         ) VALUES (
           $1::uuid, $2::uuid, $3, $4::uuid, $5,
           $6::numeric, $7, $8::numeric, $9::numeric, $10::numeric,
           $11, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
           $17, $18::integer, $19, $20, $21::date, $22,
           $23, $24, COALESCE($25::timestamptz, now()), $26::uuid, $27
         ) RETURNING ${COLS}`,
        [
          empresaId, header.proveedor_id, header.proveedor_nombre, it.producto_id, it.producto_nombre,
          it.cantidad, header.moneda, header.tipo_cambio, it.costo_unitario_original, it.costo_unitario,
          it.iva_tipo, it.subtotal, it.monto_iva, it.total, it.precio_venta, it.margen_venta,
          header.tipo_pago, header.plazo_dias, header.nro_timbrado, header.numero_factura,
          header.fecha_factura ?? null, header.observacion ?? null,
          numeroControl, estadoPrev, header.fecha ?? null, header.created_by, header.usuario_nombre,
        ]
      );
      insertedRows.push(cr[0]);
    }
    const out: ComprasMultiResult = { numero_control: numeroControl, compras: insertedRows, movimiento_warning: null };

    // Regenerar la cuenta por pagar si existía y la compra es definitiva.
    if (cxpRows.length > 0) {
      await client.query(`DELETE FROM ${tCxp} WHERE id = $1::uuid`, [cxpRows[0].id]); // cascade cuotas
      const fechaEmision = header.fecha_factura && /^\d{4}-\d{2}-\d{2}$/.test(header.fecha_factura)
        ? header.fecha_factura : null;
      if (estadoPrev === "registrada" && fechaEmision) {
        const total = out.compras.reduce((s, r) => s + (Number(r.total) || 0), 0);
        const { rows: pr } = await client.query<{ dias_gracia: number | null; plazos_cuotas: number[] | null }>(
          `SELECT dias_gracia, plazos_cuotas FROM ${tProv} WHERE id = $1::uuid AND empresa_id = $2::uuid`,
          [header.proveedor_id, empresaId]
        );
        const diasGracia = Number(pr[0]?.dias_gracia) || 0;
        const plazos = Array.isArray(pr[0]?.plazos_cuotas) ? pr[0].plazos_cuotas.map(Number) : [];
        const cuotas = plazos.length > 0
          ? calcularCuotas(total, fechaEmision, diasGracia, plazos)
          : calcularCuotas(total, fechaEmision, diasGracia, [0]);
        const fechaInicio = addDaysYmd(fechaEmision, diasGracia);
        const { rows: nueva } = await client.query<{ id: string }>(
          `INSERT INTO ${tCxp} (
             empresa_id, proveedor_id, proveedor_nombre, compra_numero_control,
             fecha_emision, dias_gracia, fecha_inicio_pago, moneda, total, saldo, estado
           ) VALUES ($1::uuid,$2::uuid,$3,$4,$5::date,$6::integer,$7::date,$8,$9::numeric,$9::numeric,'pendiente')
           RETURNING id`,
          [empresaId, header.proveedor_id, header.proveedor_nombre, numeroControl,
           fechaEmision, diasGracia, fechaInicio, header.moneda === "USD" ? "USD" : "PYG", Math.round(total)]
        );
        for (const c of cuotas) {
          await client.query(
            `INSERT INTO ${tCuo} (empresa_id, cuenta_por_pagar_id, numero_cuota, dias_plazo, fecha_vencimiento, monto, saldo, estado)
             VALUES ($1::uuid,$2::uuid,$3::integer,$4::integer,$5::date,$6::numeric,$6::numeric,'pendiente')`,
            [empresaId, nueva[0].id, c.numero_cuota, c.dias_plazo, c.fecha_vencimiento, c.monto]
          );
        }
      }
    }

    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

/** Trae la cabecera + líneas de una compra por numero_control (para editar). */
export async function getCompraByNumeroControl(
  schemaRaw: string,
  empresaId: string,
  numeroControl: string
): Promise<{ header: Record<string, unknown>; items: Record<string, unknown>[] } | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const { rows } = await pool().query(
    `SELECT id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
            cantidad::float8 AS cantidad, moneda, tipo_cambio::float8 AS tipo_cambio,
            costo_unitario_original::float8 AS costo_unitario_original,
            costo_unitario::float8 AS costo_unitario, iva_tipo,
            subtotal::float8 AS subtotal, monto_iva::float8 AS monto_iva, total::float8 AS total,
            precio_venta::float8 AS precio_venta, margen_venta::float8 AS margen_venta,
            tipo_pago, plazo_dias, nro_timbrado, numero_factura,
            to_char(fecha_factura,'YYYY-MM-DD') AS fecha_factura,
            to_char(fecha,'YYYY-MM-DD') AS fecha, observacion, estado
       FROM ${tC}
      WHERE empresa_id = $1::uuid AND numero_control = $2 AND anulada_at IS NULL
      ORDER BY id`,
    [empresaId, numeroControl]
  );
  if (rows.length === 0) return null;
  const r0 = rows[0] as Record<string, unknown>;
  const header = {
    numero_control: numeroControl,
    proveedor_id: r0.proveedor_id, proveedor_nombre: r0.proveedor_nombre,
    moneda: r0.moneda, tipo_cambio: r0.tipo_cambio, tipo_pago: r0.tipo_pago, plazo_dias: r0.plazo_dias,
    nro_timbrado: r0.nro_timbrado, numero_factura: r0.numero_factura,
    fecha_factura: r0.fecha_factura, fecha: r0.fecha, observacion: r0.observacion, estado: r0.estado,
  };
  return { header, items: rows as Record<string, unknown>[] };
}
