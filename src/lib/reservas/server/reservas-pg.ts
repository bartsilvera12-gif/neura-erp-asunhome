/**
 * Reservas / Mercadería en guarda (PG directo, schema del tenant).
 *
 * · crearReserva: saca la mercadería del stock (SALIDA origen 'reserva') y la deja
 *   identificada como en guarda. estado 'activa'.
 * · registrarPago: anticipo/pago que entra a caja (si hay caja abierta) y baja el saldo.
 * · marcarEntrega: retiro parcial — sube cantidad_entregada (no toca stock, ya salió).
 * · cancelarReserva: devuelve al stock lo NO entregado (ENTRADA 'anulacion_reserva').
 * · Facturar (una factura al final) queda para el paso siguiente (según defina el cliente).
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function ivaIncluido(tipo: string, total: number): number {
  if (tipo === "5%" || tipo === "5") return round2(total - total / 1.05);
  if (tipo === "10%" || tipo === "10") return round2(total - total / 1.1);
  return 0; // EXENTA
}

export interface ReservaItemInput {
  producto_id: string;
  producto_nombre: string;
  sku?: string | null;
  cantidad: number;
  precio_unitario: number;
  tipo_iva?: string | null; // 'EXENTA' | '5%' | '10%'
}
export interface CrearReservaInput {
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  observaciones?: string | null;
  items: ReservaItemInput[];
}

async function nextNumero(client: import("pg").PoolClient, tR: string, empresaId: string): Promise<string> {
  const { rows } = await client.query<{ maxn: number | null }>(
    `SELECT COALESCE(MAX(CASE WHEN numero_control ~ '^RES-[0-9]+$'
       THEN (substring(numero_control from 5))::int ELSE 0 END), 0) AS maxn
       FROM ${tR} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  return `RES-${String((Number(rows[0]?.maxn) || 0) + 1).padStart(6, "0")}`;
}

export async function crearReserva(
  schemaRaw: string,
  empresaId: string,
  input: CrearReservaInput,
  user: { id: string | null; nombre: string | null }
): Promise<{ id: string; numero_control: string }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tR = quoteSchemaTable(schema, "reservas");
  const tRI = quoteSchemaTable(schema, "reserva_items");
  const tP = quoteSchemaTable(schema, "productos");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  if (!input.items?.length) throw new Error("La reserva debe tener al menos un producto.");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const numero = await nextNumero(client, tR, empresaId);

    // Calcular totales por ítem.
    const calc = input.items.map((it) => {
      const cantidad = Number(it.cantidad) || 0;
      const precio = Number(it.precio_unitario) || 0;
      const total = round2(cantidad * precio);
      const tipo = it.tipo_iva || "10%";
      const monto_iva = ivaIncluido(tipo, total);
      return { it, cantidad, precio, total, tipo, monto_iva, subtotal: round2(total - monto_iva) };
    });
    const total = round2(calc.reduce((s, c) => s + c.total, 0));

    const { rows: rr } = await client.query<{ id: string }>(
      `INSERT INTO ${tR} (empresa_id, numero_control, cliente_id, cliente_nombre, estado,
         total, pagado, saldo, observaciones, created_by, usuario_nombre)
       VALUES ($1::uuid,$2,$3::uuid,$4,'activa',$5::numeric,0,$5::numeric,$6,$7::uuid,$8)
       RETURNING id`,
      [empresaId, numero, input.cliente_id || null, input.cliente_nombre || null, total,
       input.observaciones || null, user.id, user.nombre]
    );
    const reservaId = rr[0].id;

    for (const c of calc) {
      await client.query(
        `INSERT INTO ${tRI} (empresa_id, reserva_id, producto_id, producto_nombre, sku,
           cantidad, cantidad_entregada, precio_unitario, tipo_iva, subtotal, monto_iva, total)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::numeric,0,$7::numeric,$8,$9::numeric,$10::numeric,$11::numeric)`,
        [empresaId, reservaId, c.it.producto_id, c.it.producto_nombre, c.it.sku || null,
         c.cantidad, c.precio, c.tipo, c.subtotal, c.monto_iva, c.total]
      );
      // Sacar del stock (mercadería en guarda) + movimiento SALIDA 'reserva'.
      if (c.cantidad > 0) {
        await client.query(
          `UPDATE ${tP} SET stock_actual = stock_actual - $1::numeric, updated_at = now()
            WHERE id = $2::uuid AND empresa_id = $3::uuid`,
          [c.cantidad, c.it.producto_id, empresaId]
        );
        await client.query(
          `INSERT INTO ${tM} (empresa_id, producto_id, producto_nombre, producto_sku,
             tipo, cantidad, costo_unitario, origen, referencia, fecha, created_by, usuario_nombre)
           SELECT $1::uuid, $2::uuid, $3, COALESCE(p.sku,''), 'SALIDA', $4::numeric,
                  COALESCE(p.costo_promedio,0), 'reserva', $5, now(), $6::uuid, $7
             FROM ${tP} p WHERE p.id = $2::uuid`,
          [empresaId, c.it.producto_id, c.it.producto_nombre, c.cantidad, numero, user.id, user.nombre]
        );
      }
    }

    await client.query("COMMIT");
    return { id: reservaId, numero_control: numero };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

export interface RegistrarPagoInput {
  reservaId: string;
  monto: number;
  metodoPago?: string | null;
  entidadBancariaId?: string | null;
  referencia?: string | null;
  observaciones?: string | null;
}

export async function registrarPagoReserva(
  schemaRaw: string,
  empresaId: string,
  input: RegistrarPagoInput,
  user: { id: string | null; email: string | null }
): Promise<{ ok: true; pagado: number; saldo: number }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tR = quoteSchemaTable(schema, "reservas");
  const tPag = quoteSchemaTable(schema, "reserva_pagos");
  const tCajas = quoteSchemaTable(schema, "cajas");
  const tCm = quoteSchemaTable(schema, "caja_movimientos");
  const monto = round2(Number(input.monto) || 0);
  if (monto <= 0) throw new Error("El monto del pago debe ser mayor a 0.");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: rr } = await client.query<{ numero_control: string; total: string; pagado: string; estado: string }>(
      `SELECT numero_control, total, pagado, estado FROM ${tR}
        WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [input.reservaId, empresaId]
    );
    if (rr.length === 0) throw new Error("Reserva no encontrada.");
    if (rr[0].estado !== "activa") throw new Error("La reserva no está activa.");
    const total = round2(Number(rr[0].total) || 0);
    const pagadoActual = round2(Number(rr[0].pagado) || 0);
    const saldoActual = round2(total - pagadoActual);
    if (monto > saldoActual + 0.01) throw new Error(`El pago (${monto}) supera el saldo pendiente (${saldoActual}).`);

    // Ingreso en caja abierta (si hay). Best-effort: si no hay caja, igual se registra el pago.
    let cajaMovId: string | null = null;
    const cajaR = await client.query<{ id: string }>(
      `SELECT id FROM ${tCajas} WHERE empresa_id = $1::uuid AND estado = 'abierta' ORDER BY fecha_apertura DESC LIMIT 1`,
      [empresaId]
    );
    if (cajaR.rowCount && cajaR.rows[0]) {
      const concepto = `Anticipo reserva ${rr[0].numero_control}`.slice(0, 200);
      const medio = input.metodoPago === "tarjeta" || input.metodoPago === "transferencia" ? input.metodoPago : "efectivo";
      const ins = await client.query<{ id: string }>(
        `INSERT INTO ${tCm} (empresa_id, caja_id, tipo, concepto, monto, medio_pago, usuario_id, usuario_email)
         VALUES ($1::uuid,$2::uuid,'ingreso',$3,$4::numeric,$5,$6::uuid,$7) RETURNING id`,
        [empresaId, cajaR.rows[0].id, concepto, monto, medio, user.id, user.email]
      );
      cajaMovId = ins.rows[0]?.id ?? null;
    }

    await client.query(
      `INSERT INTO ${tPag} (empresa_id, reserva_id, monto, metodo_pago, entidad_bancaria_id, referencia, caja_movimiento_id, observaciones)
       VALUES ($1::uuid,$2::uuid,$3::numeric,$4,$5::uuid,$6,$7::uuid,$8)`,
      [empresaId, input.reservaId, monto, input.metodoPago || null, input.entidadBancariaId || null,
       input.referencia || null, cajaMovId, input.observaciones || null]
    );

    const nuevoPagado = round2(pagadoActual + monto);
    const nuevoSaldo = round2(total - nuevoPagado);
    await client.query(
      `UPDATE ${tR} SET pagado = $1::numeric, saldo = $2::numeric, updated_at = now() WHERE id = $3::uuid`,
      [nuevoPagado, Math.max(0, nuevoSaldo), input.reservaId]
    );

    await client.query("COMMIT");
    return { ok: true, pagado: nuevoPagado, saldo: Math.max(0, nuevoSaldo) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

/** Retiro parcial: sube cantidad_entregada del ítem (tope = cantidad). No toca stock. */
export async function marcarEntrega(
  schemaRaw: string,
  empresaId: string,
  reservaItemId: string,
  cantidad: number
): Promise<{ ok: true }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tRI = quoteSchemaTable(schema, "reserva_items");
  const c = Number(cantidad) || 0;
  if (c <= 0) throw new Error("La cantidad a entregar debe ser mayor a 0.");
  await pool().query(
    `UPDATE ${tRI}
        SET cantidad_entregada = LEAST(cantidad, cantidad_entregada + $1::numeric)
      WHERE id = $2::uuid AND empresa_id = $3::uuid`,
    [c, reservaItemId, empresaId]
  );
  return { ok: true };
}

/** Cancela la reserva: devuelve al stock lo NO entregado y marca 'cancelada'. */
export async function cancelarReserva(
  schemaRaw: string,
  empresaId: string,
  reservaId: string,
  user: { id: string | null; nombre: string | null }
): Promise<{ ok: true }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tR = quoteSchemaTable(schema, "reservas");
  const tRI = quoteSchemaTable(schema, "reserva_items");
  const tP = quoteSchemaTable(schema, "productos");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: rr } = await client.query<{ numero_control: string; estado: string }>(
      `SELECT numero_control, estado FROM ${tR} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [reservaId, empresaId]
    );
    if (rr.length === 0) throw new Error("Reserva no encontrada.");
    if (rr[0].estado !== "activa") throw new Error("Solo se puede cancelar una reserva activa.");

    const { rows: items } = await client.query<{ producto_id: string; producto_nombre: string; cantidad: string; cantidad_entregada: string }>(
      `SELECT producto_id, producto_nombre, cantidad::text, cantidad_entregada::text
         FROM ${tRI} WHERE reserva_id = $1::uuid AND empresa_id = $2::uuid`,
      [reservaId, empresaId]
    );
    for (const it of items) {
      const pendiente = (Number(it.cantidad) || 0) - (Number(it.cantidad_entregada) || 0);
      if (pendiente <= 0 || !it.producto_id) continue;
      await client.query(
        `UPDATE ${tP} SET stock_actual = stock_actual + $1::numeric, updated_at = now()
          WHERE id = $2::uuid AND empresa_id = $3::uuid`,
        [pendiente, it.producto_id, empresaId]
      );
      await client.query(
        `INSERT INTO ${tM} (empresa_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia, fecha, created_by, usuario_nombre)
         SELECT $1::uuid, $2::uuid, $3, COALESCE(p.sku,''), 'ENTRADA', $4::numeric,
                COALESCE(p.costo_promedio,0), 'anulacion_reserva', $5, now(), $6::uuid, $7
           FROM ${tP} p WHERE p.id = $2::uuid`,
        [empresaId, it.producto_id, it.producto_nombre, pendiente, `ANUL-${rr[0].numero_control}`, user.id, user.nombre]
      );
    }
    await client.query(`UPDATE ${tR} SET estado = 'cancelada', updated_at = now() WHERE id = $1::uuid`, [reservaId]);
    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

// ── Lecturas ─────────────────────────────────────────────────────────────────

export interface ReservaResumen {
  id: string;
  numero_control: string | null;
  cliente_nombre: string | null;
  fecha: string | null;
  estado: string;
  total: number;
  pagado: number;
  saldo: number;
  items: number;
  entregados: number;
  pendientes: number;
}

export async function listReservas(schemaRaw: string, empresaId: string): Promise<ReservaResumen[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tR = quoteSchemaTable(schema, "reservas");
  const tRI = quoteSchemaTable(schema, "reserva_items");
  const { rows } = await pool().query<ReservaResumen>(
    `SELECT r.id, r.numero_control, r.cliente_nombre,
            to_char(r.fecha, 'YYYY-MM-DD') AS fecha, r.estado,
            r.total, r.pagado, r.saldo,
            COALESCE((SELECT count(*) FROM ${tRI} i WHERE i.reserva_id = r.id),0)::int AS items,
            COALESCE((SELECT count(*) FROM ${tRI} i WHERE i.reserva_id = r.id AND i.cantidad_entregada >= i.cantidad),0)::int AS entregados,
            COALESCE((SELECT count(*) FROM ${tRI} i WHERE i.reserva_id = r.id AND i.cantidad_entregada < i.cantidad),0)::int AS pendientes
       FROM ${tR} r
      WHERE r.empresa_id = $1::uuid
      ORDER BY r.fecha DESC, r.numero_control DESC`,
    [empresaId]
  );
  return rows.map((r) => ({
    ...r,
    total: Number(r.total) || 0, pagado: Number(r.pagado) || 0, saldo: Number(r.saldo) || 0,
  }));
}

export async function getReserva(schemaRaw: string, empresaId: string, id: string) {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tR = quoteSchemaTable(schema, "reservas");
  const tRI = quoteSchemaTable(schema, "reserva_items");
  const tPag = quoteSchemaTable(schema, "reserva_pagos");
  const { rows: hr } = await pool().query(
    `SELECT id, numero_control, cliente_id, cliente_nombre, to_char(fecha,'YYYY-MM-DD HH24:MI') AS fecha,
            estado, total, pagado, saldo, observaciones, venta_id
       FROM ${tR} WHERE id = $1::uuid AND empresa_id = $2::uuid`,
    [id, empresaId]
  );
  if (hr.length === 0) return null;
  const { rows: items } = await pool().query(
    `SELECT id, producto_id, producto_nombre, sku, cantidad::float8 AS cantidad,
            cantidad_entregada::float8 AS cantidad_entregada, precio_unitario::float8 AS precio_unitario,
            tipo_iva, total::float8 AS total
       FROM ${tRI} WHERE reserva_id = $1::uuid AND empresa_id = $2::uuid ORDER BY id`,
    [id, empresaId]
  );
  const { rows: pagos } = await pool().query(
    `SELECT id, to_char(fecha,'YYYY-MM-DD') AS fecha, monto::float8 AS monto, metodo_pago, referencia
       FROM ${tPag} WHERE reserva_id = $1::uuid AND empresa_id = $2::uuid ORDER BY created_at`,
    [id, empresaId]
  );
  return { header: hr[0], items, pagos };
}
