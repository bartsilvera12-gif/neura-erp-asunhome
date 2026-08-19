/**
 * Motor de devoluciones de ventas.
 *
 * Toda confirmacion/anulacion corre en UNA sola transaccion PostgreSQL
 * (pool directo, BEGIN/COMMIT) con SELECT ... FOR UPDATE sobre la venta, sus
 * lineas y los productos afectados, para que dos devoluciones simultaneas no
 * puedan pasarse de la cantidad disponible ni duplicar stock/caja.
 *
 * Idempotencia: `idempotency_key` unica por empresa. Un doble clic o un reintento
 * devuelve la devolucion ya creada sin volver a impactar stock ni caja.
 *
 * NO modifica ni borra la venta original (solo su campo `estado`).
 * NO emite Nota de Credito ni toca SIFEN.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import {
  DevolucionBloqueadaError,
  calcIvaIncluido,
  round2,
  type CrearDevolucionInput,
  type Devolucion,
  type DevolucionCambioRow,
  type DevolucionItemRow,
  type EstadoDevolucion,
  type MetodoReembolso,
  type ResolucionDevolucion,
  type TipoDevolucion,
  type VentaDevolvible,
} from "@/lib/devoluciones/types";

interface PgClientLike {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export interface UsuarioCtx {
  id: string | null;
  nombre: string | null;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string | null {
  return v == null ? null : String(v);
}
/**
 * Normaliza timestamps a ISO. node-postgres devuelve `Date`, y String(Date) da
 * "Thu Jul 16 2026 ... (hora estándar de Paraguay)", que Postgres NO parsea.
 */
function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool de base de datos no disponible.");
  return p;
}

// ── Lectura: venta devolvible ───────────────────────────────────────────────

/**
 * Venta + lineas con lo ya devuelto (solo devoluciones confirmadas cuentan).
 * Devuelve null si la venta no existe en la empresa.
 */
export async function getVentaDevolvible(
  schemaRaw: string,
  empresaId: string,
  ventaId: string
): Promise<VentaDevolvible | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tDI = quoteSchemaTable(schema, "devoluciones_venta_items");
  const tD = quoteSchemaTable(schema, "devoluciones_venta");
  const tFA = quoteSchemaTable(schema, "factura_autoimpresor");
  const tC = quoteSchemaTable(schema, "clientes");

  const vQ = await pool().query(
    `SELECT v.id::text, v.numero_control, v.fecha, v.estado, v.metodo_pago, v.total,
            v.cliente_id::text AS cliente_id,
            COALESCE(NULLIF(TRIM(c.empresa), ''), NULLIF(TRIM(c.nombre_contacto), ''), NULLIF(TRIM(c.nombre), '')) AS cliente_nombre,
            EXISTS (SELECT 1 FROM ${tFA} fa WHERE fa.venta_id = v.id AND fa.empresa_id = v.empresa_id) AS tiene_factura
       FROM ${tV} v
       LEFT JOIN ${tC} c ON c.id = v.cliente_id AND c.empresa_id = v.empresa_id
      WHERE v.id = $1::uuid AND v.empresa_id = $2::uuid
      LIMIT 1`,
    [ventaId, empresaId]
  );
  const v = vQ.rows[0];
  if (!v) return null;

  const lQ = await pool().query(
    `SELECT vi.id::text AS venta_item_id, vi.producto_id::text AS producto_id,
            vi.producto_nombre, vi.sku, vi.tipo_iva, vi.precio_venta, vi.cantidad,
            COALESCE((
              SELECT SUM(di.cantidad_devuelta)
                FROM ${tDI} di
                JOIN ${tD} d ON d.id = di.devolucion_id AND d.estado = 'confirmada'
               WHERE di.venta_item_id = vi.id AND di.empresa_id = vi.empresa_id
            ), 0) AS devuelto
       FROM ${tVI} vi
      WHERE vi.venta_id = $1::uuid AND vi.empresa_id = $2::uuid
      ORDER BY vi.created_at ASC`,
    [ventaId, empresaId]
  );

  return {
    venta_id: String(v.id),
    numero_control: String(v.numero_control ?? ""),
    fecha: iso(v.fecha) ?? "",
    estado: String(v.estado ?? ""),
    metodo_pago: str(v.metodo_pago),
    total: num(v.total),
    cliente_id: str(v.cliente_id),
    cliente_nombre: str(v.cliente_nombre),
    tiene_factura_fiscal: v.tiene_factura === true,
    lineas: lQ.rows.map((r) => {
      const vendida = num(r.cantidad);
      const devuelta = num(r.devuelto);
      return {
        venta_item_id: String(r.venta_item_id),
        producto_id: String(r.producto_id),
        producto_nombre: String(r.producto_nombre ?? ""),
        sku: str(r.sku),
        tipo_iva: String(r.tipo_iva ?? "10%"),
        precio_unitario: num(r.precio_venta),
        cantidad_vendida: vendida,
        cantidad_devuelta: devuelta,
        cantidad_disponible: round2(Math.max(0, vendida - devuelta)),
      };
    }),
  };
}

// ── Helpers de caja ─────────────────────────────────────────────────────────

/**
 * Caja abierta a usar. Prefiere la misma caja de la venta si sigue abierta;
 * si no, la abierta mas reciente. null si no hay ninguna abierta.
 */
async function cajaAbierta(
  client: PgClientLike,
  schema: string,
  empresaId: string,
  ventaCajaId: string | null
): Promise<string | null> {
  const t = quoteSchemaTable(schema, "cajas");
  if (ventaCajaId) {
    const q = await client.query(
      `SELECT id::text FROM ${t} WHERE id = $1::uuid AND empresa_id = $2::uuid AND estado = 'abierta' LIMIT 1`,
      [ventaCajaId, empresaId]
    );
    if (q.rows[0]) return String(q.rows[0].id);
  }
  const q = await client.query(
    `SELECT id::text FROM ${t} WHERE empresa_id = $1::uuid AND estado = 'abierta'
      ORDER BY fecha_apertura DESC LIMIT 1`,
    [empresaId]
  );
  return q.rows[0] ? String(q.rows[0].id) : null;
}

/** Siguiente DEV-000001 de la empresa. Requiere advisory lock tomado antes. */
async function siguienteNumero(client: PgClientLike, schema: string, empresaId: string): Promise<string> {
  const t = quoteSchemaTable(schema, "devoluciones_venta");
  const q = await client.query(
    `SELECT numero_devolucion FROM ${t}
      WHERE empresa_id = $1::uuid AND numero_devolucion ~ '^DEV-[0-9]+$'
      ORDER BY (regexp_replace(numero_devolucion, '\\D', '', 'g'))::bigint DESC
      LIMIT 1`,
    [empresaId]
  );
  let next = 1;
  const last = q.rows[0]?.numero_devolucion;
  if (last) {
    const m = String(last).match(/^DEV-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `DEV-${String(next).padStart(6, "0")}`;
}

// ── Motor: crear devolucion ────────────────────────────────────────────────

/**
 * Confirma una devolucion. Atomico: o se escribe todo (devolucion + items +
 * stock + movimientos de inventario + movimiento de caja + estado de la venta)
 * o no se escribe nada.
 */
export async function crearDevolucion(
  schemaRaw: string,
  empresaId: string,
  usuario: UsuarioCtx,
  input: CrearDevolucionInput
): Promise<Devolucion> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tD = quoteSchemaTable(schema, "devoluciones_venta");
  const tDI = quoteSchemaTable(schema, "devoluciones_venta_items");
  const tDC = quoteSchemaTable(schema, "devoluciones_venta_cambios");
  const tP = quoteSchemaTable(schema, "productos");
  const tMI = quoteSchemaTable(schema, "movimientos_inventario");
  const tCM = quoteSchemaTable(schema, "caja_movimientos");
  const tFA = quoteSchemaTable(schema, "factura_autoimpresor");

  if (!input.items || input.items.length === 0) {
    throw new DevolucionBloqueadaError("sin_items", "Seleccioná al menos un producto a devolver.");
  }

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // ── Idempotencia: si ya se confirmo con esta clave, devolverla tal cual.
    if (input.idempotency_key) {
      const ya = await client.query(
        `SELECT id::text FROM ${tD} WHERE empresa_id = $1::uuid AND idempotency_key = $2 LIMIT 1`,
        [empresaId, input.idempotency_key]
      );
      if (ya.rows[0]) {
        await client.query("COMMIT");
        const dev = await getDevolucion(schema, empresaId, String(ya.rows[0].id));
        if (dev) return dev;
      }
    }

    // ── 1) Venta bloqueada.
    const vQ = await client.query(
      `SELECT id::text, numero_control, fecha, estado, caja_id::text AS caja_id,
              cliente_id::text AS cliente_id
         FROM ${tV} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [input.venta_id, empresaId]
    );
    const venta = vQ.rows[0];
    if (!venta) throw new DevolucionBloqueadaError("venta_no_encontrada", "La venta no existe.");
    if (String(venta.estado) === "anulada") {
      throw new DevolucionBloqueadaError("venta_anulada", "La venta está anulada; no admite devoluciones.");
    }

    // ── 2) Lineas bloqueadas + cantidades ya devueltas.
    const liQ = await client.query(
      `SELECT vi.id::text AS id, vi.producto_id::text AS producto_id, vi.producto_nombre, vi.sku,
              vi.tipo_iva, vi.precio_venta, vi.cantidad,
              COALESCE((
                SELECT SUM(di.cantidad_devuelta) FROM ${tDI} di
                  JOIN ${tD} d ON d.id = di.devolucion_id AND d.estado = 'confirmada'
                 WHERE di.venta_item_id = vi.id AND di.empresa_id = vi.empresa_id
              ), 0) AS devuelto
         FROM ${tVI} vi
        WHERE vi.venta_id = $1::uuid AND vi.empresa_id = $2::uuid
        FOR UPDATE OF vi`,
      [input.venta_id, empresaId]
    );
    const porItem = new Map(liQ.rows.map((r) => [String(r.id), r]));

    // ── 3) Validar cantidades e importar importes DESDE LA VENTA ORIGINAL.
    let totalDevuelto = 0;
    const itemsCalc = input.items.map((it) => {
      const linea = porItem.get(it.venta_item_id);
      if (!linea) {
        throw new DevolucionBloqueadaError("cantidad_excedida", "Una de las líneas no pertenece a esta venta.");
      }
      const vendida = num(linea.cantidad);
      const yaDevuelta = num(linea.devuelto);
      const disponible = round2(vendida - yaDevuelta);
      const cant = num(it.cantidad);
      if (cant <= 0) {
        throw new DevolucionBloqueadaError("cantidad_excedida", "La cantidad a devolver debe ser mayor a cero.");
      }
      if (cant > disponible + 1e-9) {
        throw new DevolucionBloqueadaError(
          "cantidad_excedida",
          `No podés devolver ${cant} de "${String(linea.producto_nombre)}": disponible ${disponible} (vendido ${vendida}, ya devuelto ${yaDevuelta}).`
        );
      }
      const precio = num(linea.precio_venta);
      const tipoIva = String(linea.tipo_iva ?? "10%");
      const total = round2(precio * cant);
      const iva = round2(calcIvaIncluido(tipoIva, total));
      totalDevuelto = round2(totalDevuelto + total);
      // Un producto danado NUNCA reintegra stock.
      const reintegra = it.condicion === "danado" ? false : it.reintegra_stock !== false;
      return {
        venta_item_id: it.venta_item_id,
        producto_id: String(linea.producto_id),
        producto_nombre: String(linea.producto_nombre ?? ""),
        sku: str(linea.sku),
        cantidad_vendida: vendida,
        cantidad_devuelta: cant,
        precio_unitario: precio,
        tipo_iva: tipoIva,
        monto_iva: iva,
        total_devuelto: total,
        condicion: it.condicion,
        reintegra_stock: reintegra,
      };
    });

    // ── 4) Cambios (productos entregados), con precio actual del producto.
    let totalEntregado = 0;
    const cambiosCalc: Array<{
      producto_id: string; producto_nombre: string; sku: string | null;
      cantidad: number; precio_unitario: number; tipo_iva: string;
      monto_iva: number; total: number; controla_stock: boolean;
      costo: number; stock: number;
    }> = [];
    if (input.resolucion === "cambio") {
      for (const cb of input.cambios ?? []) {
        const pQ = await client.query(
          `SELECT id::text, nombre, sku, precio_venta, costo_promedio, stock_actual, controla_stock
             FROM ${tP} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
          [cb.producto_id, empresaId]
        );
        const p = pQ.rows[0];
        if (!p) throw new DevolucionBloqueadaError("stock_insuficiente_cambio", "El producto del cambio no existe.");
        const cant = num(cb.cantidad);
        if (cant <= 0) continue;
        const controla = p.controla_stock !== false;
        const stock = num(p.stock_actual);
        if (controla && stock < cant) {
          throw new DevolucionBloqueadaError(
            "stock_insuficiente_cambio",
            `Sin stock suficiente de "${String(p.nombre)}": hay ${stock}, se requieren ${cant}.`
          );
        }
        const precio = num(p.precio_venta);
        const total = round2(precio * cant);
        const iva = round2(calcIvaIncluido("10%", total));
        totalEntregado = round2(totalEntregado + total);
        cambiosCalc.push({
          producto_id: String(p.id),
          producto_nombre: String(p.nombre ?? ""),
          sku: str(p.sku),
          cantidad: cant,
          precio_unitario: precio,
          tipo_iva: "10%",
          monto_iva: iva,
          total,
          controla_stock: controla,
          costo: num(p.costo_promedio),
          stock,
        });
      }
    }

    // ── 5) Diferencia. >0 el cliente paga; <0 se le devuelve dinero.
    const resolucion: ResolucionDevolucion = input.resolucion;
    const diferencia = resolucion === "cambio" ? round2(totalEntregado - totalDevuelto) : round2(-totalDevuelto);
    const metodo: MetodoReembolso = input.metodo ?? "efectivo";
    const requiereEfectivo = diferencia !== 0 && metodo === "efectivo";

    // ── 6) Caja: obligatoria si hay movimiento en efectivo.
    const cajaId = diferencia !== 0 ? await cajaAbierta(client, schema, empresaId, str(venta.caja_id)) : null;
    if (requiereEfectivo && !cajaId) {
      throw new DevolucionBloqueadaError(
        "sin_caja_abierta",
        "No hay una caja abierta. Abrí una caja antes de realizar esta devolución."
      );
    }

    // ── 7) Tipo total/parcial: total si tras esta devolucion no queda nada.
    let quedaPendiente = false;
    for (const [id, linea] of porItem) {
      const devueltoAhora = itemsCalc.find((x) => x.venta_item_id === id)?.cantidad_devuelta ?? 0;
      const restante = round2(num(linea.cantidad) - num(linea.devuelto) - devueltoAhora);
      if (restante > 1e-9) quedaPendiente = true;
    }
    const tipo: TipoDevolucion = quedaPendiente ? "parcial" : "total";

    // ── 8) Numero correlativo (advisory lock por empresa dentro de la tx).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`devolucion:${empresaId}`]);
    const numero = await siguienteNumero(client, schema, empresaId);

    // ── 9) La venta tiene factura fiscal? (solo para advertir sobre NC).
    const faQ = await client.query(
      `SELECT 1 FROM ${tFA} WHERE venta_id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
      [input.venta_id, empresaId]
    );
    const requiereNC = faQ.rows.length > 0;

    // ── 10) Cabecera.
    const insD = await client.query(
      `INSERT INTO ${tD} (
         empresa_id, numero_devolucion, venta_id, venta_numero_control, venta_fecha,
         cliente_id, tipo, resolucion, estado, motivo,
         total_devuelto, total_entregado, diferencia, metodo_reembolso,
         caja_id, requiere_nota_credito, idempotency_key, created_by, usuario_nombre
       ) VALUES (
         $1::uuid, $2, $3::uuid, $4, $5::timestamptz,
         $6::uuid, $7, $8, 'confirmada', $9,
         $10, $11, $12, $13,
         $14::uuid, $15::boolean, $16, $17::uuid, $18
       ) RETURNING id::text`,
      [
        empresaId, numero, input.venta_id, str(venta.numero_control), iso(venta.fecha),
        str(venta.cliente_id), tipo, resolucion, input.motivo?.trim() || null,
        totalDevuelto, totalEntregado, diferencia, diferencia !== 0 ? metodo : null,
        cajaId, requiereNC, input.idempotency_key || null, usuario.id, usuario.nombre,
      ]
    );
    const devolucionId = String(insD.rows[0].id);

    // ── 11) Items + reintegro de stock + movimiento ENTRADA.
    for (const it of itemsCalc) {
      await client.query(
        `INSERT INTO ${tDI} (
           empresa_id, devolucion_id, venta_item_id, producto_id, producto_nombre, sku,
           cantidad_vendida, cantidad_devuelta, precio_unitario, tipo_iva, monto_iva,
           total_devuelto, condicion, reintegra_stock
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::boolean)`,
        [
          empresaId, devolucionId, it.venta_item_id, it.producto_id, it.producto_nombre, it.sku,
          it.cantidad_vendida, it.cantidad_devuelta, it.precio_unitario, it.tipo_iva, it.monto_iva,
          it.total_devuelto, it.condicion, it.reintegra_stock,
        ]
      );
      if (!it.reintegra_stock) continue; // danado o marcado como no reintegrable
      const pQ = await client.query(
        `SELECT costo_promedio, controla_stock FROM ${tP}
          WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
        [it.producto_id, empresaId]
      );
      const p = pQ.rows[0];
      if (!p || p.controla_stock === false) continue; // sin control de stock: nada que mover
      await client.query(
        `UPDATE ${tP} SET stock_actual = stock_actual + $3, updated_at = now()
          WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        [it.producto_id, empresaId, it.cantidad_devuelta]
      );
      await client.query(
        `INSERT INTO ${tMI} (
           empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad,
           costo_unitario, origen, referencia, venta_id, devolucion_id, created_by, usuario_nombre
         ) VALUES ($1::uuid,$2::uuid,$3,$4,'ENTRADA',$5,$6,'devolucion_venta',$7,$8::uuid,$9::uuid,$10::uuid,$11)`,
        [
          empresaId, it.producto_id, it.producto_nombre, it.sku ?? "", it.cantidad_devuelta,
          num(p.costo_promedio), numero, input.venta_id, devolucionId, usuario.id, usuario.nombre,
        ]
      );
    }

    // ── 12) Cambios: descuento de stock + movimiento SALIDA.
    for (const cb of cambiosCalc) {
      await client.query(
        `INSERT INTO ${tDC} (
           empresa_id, devolucion_id, producto_id, producto_nombre, sku,
           cantidad, precio_unitario, tipo_iva, monto_iva, total
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10)`,
        [empresaId, devolucionId, cb.producto_id, cb.producto_nombre, cb.sku,
         cb.cantidad, cb.precio_unitario, cb.tipo_iva, cb.monto_iva, cb.total]
      );
      if (!cb.controla_stock) continue;
      await client.query(
        `UPDATE ${tP} SET stock_actual = stock_actual - $3, updated_at = now()
          WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        [cb.producto_id, empresaId, cb.cantidad]
      );
      await client.query(
        `INSERT INTO ${tMI} (
           empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad,
           costo_unitario, origen, referencia, venta_id, devolucion_id, created_by, usuario_nombre
         ) VALUES ($1::uuid,$2::uuid,$3,$4,'SALIDA',$5,$6,'devolucion_venta',$7,$8::uuid,$9::uuid,$10::uuid,$11)`,
        [
          empresaId, cb.producto_id, cb.producto_nombre, cb.sku ?? "", cb.cantidad,
          cb.costo, numero, input.venta_id, devolucionId, usuario.id, usuario.nombre,
        ]
      );
    }

    // ── 13) Movimiento de caja por la diferencia.
    //  diferencia < 0 -> egreso (le devolvemos plata al cliente)
    //  diferencia > 0 -> ingreso (el cliente paga la diferencia)
    //  Tarjeta/transferencia se registran con su medio_pago: el resumen de caja
    //  solo suma efectivo, asi que no afectan el efectivo fisico esperado.
    let cajaMovId: string | null = null;
    if (diferencia !== 0 && cajaId) {
      const tipoMov = diferencia > 0 ? "ingreso" : "egreso";
      const concepto =
        diferencia > 0
          ? `Diferencia a cobrar por devolución ${numero}`
          : `Reembolso por devolución ${numero}`;
      const insM = await client.query(
        `INSERT INTO ${tCM} (
           empresa_id, caja_id, tipo, concepto, monto, medio_pago, usuario_id,
           observacion, devolucion_id, venta_id
         ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8,$9::uuid,$10::uuid)
         RETURNING id::text`,
        [
          empresaId, cajaId, tipoMov, concepto, Math.abs(diferencia), metodo, usuario.id,
          `Venta ${String(venta.numero_control ?? "")} · devolución ${numero}`,
          devolucionId, input.venta_id,
        ]
      );
      cajaMovId = String(insM.rows[0].id);
      await client.query(`UPDATE ${tD} SET caja_movimiento_id = $2::uuid WHERE id = $1::uuid`, [devolucionId, cajaMovId]);
    }

    // ── 14) Estado de la venta (la venta NO se borra ni se sobrescribe).
    const nuevoEstado = quedaPendiente ? "parcialmente_devuelta" : "devuelta_total";
    await client.query(
      `UPDATE ${tV} SET estado = $3, updated_at = now() WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [input.venta_id, empresaId, nuevoEstado]
    );

    await client.query("COMMIT");

    const dev = await getDevolucion(schema, empresaId, devolucionId);
    if (!dev) throw new Error("No se pudo leer la devolución recién creada.");
    return dev;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ── Anulacion (movimientos inversos, tambien transaccional) ─────────────────

export async function anularDevolucion(
  schemaRaw: string,
  empresaId: string,
  usuario: UsuarioCtx,
  devolucionId: string,
  motivo: string | null
): Promise<Devolucion> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tD = quoteSchemaTable(schema, "devoluciones_venta");
  const tDI = quoteSchemaTable(schema, "devoluciones_venta_items");
  const tDC = quoteSchemaTable(schema, "devoluciones_venta_cambios");
  const tV = quoteSchemaTable(schema, "ventas");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tP = quoteSchemaTable(schema, "productos");
  const tMI = quoteSchemaTable(schema, "movimientos_inventario");
  const tCM = quoteSchemaTable(schema, "caja_movimientos");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    const dQ = await client.query(
      `SELECT id::text, numero_devolucion, venta_id::text AS venta_id, estado, diferencia,
              metodo_reembolso, caja_id::text AS caja_id
         FROM ${tD} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [devolucionId, empresaId]
    );
    const d = dQ.rows[0];
    if (!d) throw new DevolucionBloqueadaError("devolucion_no_encontrada", "La devolución no existe.");
    if (String(d.estado) === "anulada") {
      throw new DevolucionBloqueadaError("devolucion_ya_anulada", "La devolución ya está anulada.");
    }
    const numero = String(d.numero_devolucion);

    // Revertir stock de los items devueltos que SI habian reintegrado.
    const itQ = await client.query(
      `SELECT producto_id::text AS producto_id, producto_nombre, sku, cantidad_devuelta, reintegra_stock
         FROM ${tDI} WHERE devolucion_id = $1::uuid AND empresa_id = $2::uuid`,
      [devolucionId, empresaId]
    );
    for (const it of itQ.rows) {
      if (it.reintegra_stock !== true) continue;
      const pQ = await client.query(
        `SELECT costo_promedio, controla_stock FROM ${tP} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
        [String(it.producto_id), empresaId]
      );
      const p = pQ.rows[0];
      if (!p || p.controla_stock === false) continue;
      await client.query(
        `UPDATE ${tP} SET stock_actual = stock_actual - $3, updated_at = now() WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        [String(it.producto_id), empresaId, num(it.cantidad_devuelta)]
      );
      await client.query(
        `INSERT INTO ${tMI} (
           empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad,
           costo_unitario, origen, referencia, venta_id, devolucion_id, created_by, usuario_nombre
         ) VALUES ($1::uuid,$2::uuid,$3,$4,'SALIDA',$5,$6,'devolucion_venta',$7,$8::uuid,$9::uuid,$10::uuid,$11)`,
        [
          empresaId, String(it.producto_id), String(it.producto_nombre), str(it.sku) ?? "",
          num(it.cantidad_devuelta), num(p.costo_promedio), `Anulación ${numero}`,
          String(d.venta_id), devolucionId, usuario.id, usuario.nombre,
        ]
      );
    }

    // Devolver al stock los productos que se habian entregado como cambio.
    const cbQ = await client.query(
      `SELECT producto_id::text AS producto_id, producto_nombre, sku, cantidad
         FROM ${tDC} WHERE devolucion_id = $1::uuid AND empresa_id = $2::uuid`,
      [devolucionId, empresaId]
    );
    for (const cb of cbQ.rows) {
      const pQ = await client.query(
        `SELECT costo_promedio, controla_stock FROM ${tP} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
        [String(cb.producto_id), empresaId]
      );
      const p = pQ.rows[0];
      if (!p || p.controla_stock === false) continue;
      await client.query(
        `UPDATE ${tP} SET stock_actual = stock_actual + $3, updated_at = now() WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        [String(cb.producto_id), empresaId, num(cb.cantidad)]
      );
      await client.query(
        `INSERT INTO ${tMI} (
           empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad,
           costo_unitario, origen, referencia, venta_id, devolucion_id, created_by, usuario_nombre
         ) VALUES ($1::uuid,$2::uuid,$3,$4,'ENTRADA',$5,$6,'devolucion_venta',$7,$8::uuid,$9::uuid,$10::uuid,$11)`,
        [
          empresaId, String(cb.producto_id), String(cb.producto_nombre), str(cb.sku) ?? "",
          num(cb.cantidad), num(p.costo_promedio), `Anulación ${numero}`,
          String(d.venta_id), devolucionId, usuario.id, usuario.nombre,
        ]
      );
    }

    // Movimiento de caja inverso.
    const dif = num(d.diferencia);
    let movInvId: string | null = null;
    if (dif !== 0 && d.caja_id) {
      const cajaDestino = await cajaAbierta(client, schema, empresaId, str(d.caja_id));
      if (cajaDestino) {
        const tipoInv = dif > 0 ? "egreso" : "ingreso"; // inverso del original
        const insM = await client.query(
          `INSERT INTO ${tCM} (
             empresa_id, caja_id, tipo, concepto, monto, medio_pago, usuario_id,
             observacion, devolucion_id, venta_id
           ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8,$9::uuid,$10::uuid)
           RETURNING id::text`,
          [
            empresaId, cajaDestino, tipoInv, `Anulación de devolución ${numero}`,
            Math.abs(dif), str(d.metodo_reembolso) ?? "efectivo", usuario.id,
            `Reverso automático de ${numero}`, devolucionId, String(d.venta_id),
          ]
        );
        movInvId = String(insM.rows[0].id);
      }
    }

    // Marcar anulada (NO se borra: queda auditada).
    await client.query(
      `UPDATE ${tD} SET estado = 'anulada', anulada_at = now(), anulada_por = $2::uuid,
              anulada_motivo = $3, anulada_caja_movimiento_id = $4::uuid, updated_at = now()
        WHERE id = $1::uuid`,
      [devolucionId, usuario.id, motivo?.trim() || null, movInvId]
    );

    // Recalcular estado de la venta con las devoluciones que siguen confirmadas.
    const restQ = await client.query(
      `SELECT COALESCE(SUM(vi.cantidad), 0) AS vendida,
              COALESCE((
                SELECT SUM(di.cantidad_devuelta) FROM ${tDI} di
                  JOIN ${tD} dd ON dd.id = di.devolucion_id AND dd.estado = 'confirmada'
                 WHERE di.empresa_id = $2::uuid
                   AND di.venta_item_id IN (SELECT id FROM ${tVI} WHERE venta_id = $1::uuid AND empresa_id = $2::uuid)
              ), 0) AS devuelta
         FROM ${tVI} vi WHERE vi.venta_id = $1::uuid AND vi.empresa_id = $2::uuid`,
      [String(d.venta_id), empresaId]
    );
    const vendida = num(restQ.rows[0]?.vendida);
    const devuelta = num(restQ.rows[0]?.devuelta);
    const estadoVenta = devuelta <= 1e-9 ? "completada" : devuelta >= vendida - 1e-9 ? "devuelta_total" : "parcialmente_devuelta";
    await client.query(
      `UPDATE ${tV} SET estado = $3, updated_at = now() WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [String(d.venta_id), empresaId, estadoVenta]
    );

    await client.query("COMMIT");
    const dev = await getDevolucion(schema, empresaId, devolucionId);
    if (!dev) throw new Error("No se pudo leer la devolución anulada.");
    return dev;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ── Lecturas ───────────────────────────────────────────────────────────────

const D_COLS = `
  d.id::text, d.numero_devolucion, d.venta_id::text AS venta_id, d.venta_numero_control,
  d.venta_fecha, d.cliente_id::text AS cliente_id, d.tipo, d.resolucion, d.estado, d.motivo,
  d.total_devuelto, d.total_entregado, d.diferencia, d.metodo_reembolso,
  d.caja_id::text AS caja_id, d.caja_movimiento_id::text AS caja_movimiento_id,
  d.requiere_nota_credito, d.created_by::text AS created_by, d.usuario_nombre,
  d.created_at, d.anulada_at, d.anulada_motivo
`;

function mapDev(r: Record<string, unknown>, clienteNombre?: string | null): Devolucion {
  return {
    id: String(r.id),
    numero_devolucion: String(r.numero_devolucion),
    venta_id: String(r.venta_id),
    venta_numero_control: str(r.venta_numero_control),
    venta_fecha: iso(r.venta_fecha),
    cliente_id: str(r.cliente_id),
    cliente_nombre: clienteNombre ?? str(r.cliente_nombre),
    tipo: (r.tipo === "total" ? "total" : "parcial") as TipoDevolucion,
    resolucion: (r.resolucion === "cambio" ? "cambio" : "reembolso") as ResolucionDevolucion,
    estado: (r.estado === "anulada" ? "anulada" : "confirmada") as EstadoDevolucion,
    motivo: str(r.motivo),
    total_devuelto: num(r.total_devuelto),
    total_entregado: num(r.total_entregado),
    diferencia: num(r.diferencia),
    metodo_reembolso: (str(r.metodo_reembolso) as MetodoReembolso | null),
    caja_id: str(r.caja_id),
    caja_movimiento_id: str(r.caja_movimiento_id),
    requiere_nota_credito: r.requiere_nota_credito === true,
    created_by: str(r.created_by),
    usuario_nombre: str(r.usuario_nombre),
    created_at: iso(r.created_at) ?? "",
    anulada_at: iso(r.anulada_at),
    anulada_motivo: str(r.anulada_motivo),
  };
}

export async function getDevolucion(
  schemaRaw: string,
  empresaId: string,
  id: string
): Promise<Devolucion | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tD = quoteSchemaTable(schema, "devoluciones_venta");
  const tDI = quoteSchemaTable(schema, "devoluciones_venta_items");
  const tDC = quoteSchemaTable(schema, "devoluciones_venta_cambios");
  const tC = quoteSchemaTable(schema, "clientes");

  const q = await pool().query(
    `SELECT ${D_COLS},
            COALESCE(NULLIF(TRIM(c.empresa), ''), NULLIF(TRIM(c.nombre_contacto), ''), NULLIF(TRIM(c.nombre), '')) AS cliente_nombre
       FROM ${tD} d
       LEFT JOIN ${tC} c ON c.id = d.cliente_id AND c.empresa_id = d.empresa_id
      WHERE d.id = $1::uuid AND d.empresa_id = $2::uuid LIMIT 1`,
    [id, empresaId]
  );
  const r = q.rows[0];
  if (!r) return null;

  const itQ = await pool().query(
    `SELECT id::text, venta_item_id::text AS venta_item_id, producto_id::text AS producto_id,
            producto_nombre, sku, cantidad_vendida, cantidad_devuelta, precio_unitario,
            tipo_iva, monto_iva, total_devuelto, condicion, reintegra_stock
       FROM ${tDI} WHERE devolucion_id = $1::uuid AND empresa_id = $2::uuid ORDER BY created_at ASC`,
    [id, empresaId]
  );
  const cbQ = await pool().query(
    `SELECT id::text, producto_id::text AS producto_id, producto_nombre, sku,
            cantidad, precio_unitario, tipo_iva, monto_iva, total
       FROM ${tDC} WHERE devolucion_id = $1::uuid AND empresa_id = $2::uuid ORDER BY created_at ASC`,
    [id, empresaId]
  );

  const dev = mapDev(r, str(r.cliente_nombre));
  dev.items = itQ.rows.map((x): DevolucionItemRow => ({
    id: String(x.id),
    venta_item_id: String(x.venta_item_id),
    producto_id: String(x.producto_id),
    producto_nombre: String(x.producto_nombre ?? ""),
    sku: str(x.sku),
    cantidad_vendida: num(x.cantidad_vendida),
    cantidad_devuelta: num(x.cantidad_devuelta),
    precio_unitario: num(x.precio_unitario),
    tipo_iva: String(x.tipo_iva ?? ""),
    monto_iva: num(x.monto_iva),
    total_devuelto: num(x.total_devuelto),
    condicion: x.condicion === "danado" ? "danado" : "buen_estado",
    reintegra_stock: x.reintegra_stock === true,
  }));
  dev.cambios = cbQ.rows.map((x): DevolucionCambioRow => ({
    id: String(x.id),
    producto_id: String(x.producto_id),
    producto_nombre: String(x.producto_nombre ?? ""),
    sku: str(x.sku),
    cantidad: num(x.cantidad),
    precio_unitario: num(x.precio_unitario),
    tipo_iva: String(x.tipo_iva ?? ""),
    monto_iva: num(x.monto_iva),
    total: num(x.total),
  }));
  return dev;
}

export async function listarDevoluciones(
  schemaRaw: string,
  empresaId: string,
  opts: { limit?: number } = {}
): Promise<Devolucion[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tD = quoteSchemaTable(schema, "devoluciones_venta");
  const tC = quoteSchemaTable(schema, "clientes");
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const q = await pool().query(
    `SELECT ${D_COLS},
            COALESCE(NULLIF(TRIM(c.empresa), ''), NULLIF(TRIM(c.nombre_contacto), ''), NULLIF(TRIM(c.nombre), '')) AS cliente_nombre
       FROM ${tD} d
       LEFT JOIN ${tC} c ON c.id = d.cliente_id AND c.empresa_id = d.empresa_id
      WHERE d.empresa_id = $1::uuid
      ORDER BY d.created_at DESC
      LIMIT ${limit}`,
    [empresaId]
  );
  return q.rows.map((r) => mapDev(r, str(r.cliente_nombre)));
}
