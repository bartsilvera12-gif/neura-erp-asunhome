/**
 * Cuentas por pagar a proveedores (PG directo, schema del tenant).
 *
 * Modelo:
 *  - Factura provisoria: filas de `compras` con estado='provisoria' (stock ya impactó).
 *  - Convertir a definitiva: se completan datos de factura, las filas pasan a
 *    'registrada' y se genera 1 `cuentas_por_pagar` + N `compra_cuotas`.
 *  - Cuotas automáticas: fecha_vencimiento = fecha_factura + dias_gracia + plazo_i.
 *    Monto por cuota = total / N (la última absorbe el redondeo).
 *  - Pagos parciales: `pagos_proveedores` descuenta saldo de la cuota y de la cuenta.
 *  - 'vencida' se DERIVA en las lecturas (saldo>0 AND fecha_venc < hoy), no se persiste.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Suma `days` a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD (UTC, sin desfase de TZ). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export interface CuotaCalculada {
  numero_cuota: number;
  dias_plazo: number;
  fecha_vencimiento: string;
  monto: number;
}

/**
 * Calcula las cuotas: base = fechaEmision + diasGracia; cada plazo cuenta DESDE
 * el fin de la gracia. Reparte `total` en partes iguales (última absorbe resto).
 */
export function calcularCuotas(
  total: number,
  fechaEmisionYmd: string,
  diasGracia: number,
  plazos: number[]
): CuotaCalculada[] {
  const limpios = (plazos ?? []).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (limpios.length === 0) return [];
  const n = limpios.length;
  const base = round2(total);
  const cuotaBase = round2(base / n);
  const cuotas: CuotaCalculada[] = [];
  let acumulado = 0;
  for (let i = 0; i < n; i++) {
    const esUltima = i === n - 1;
    const monto = esUltima ? round2(base - acumulado) : cuotaBase;
    acumulado = round2(acumulado + monto);
    cuotas.push({
      numero_cuota: i + 1,
      dias_plazo: limpios[i],
      fecha_vencimiento: addDaysYmd(fechaEmisionYmd, diasGracia + limpios[i]),
      monto,
    });
  }
  return cuotas;
}

export interface ConvertirProvisoriaInput {
  numeroControl: string;
  numeroFactura: string;
  nroTimbrado?: string | null;
  fechaFactura: string; // YYYY-MM-DD
}

export interface CuentaPorPagarResumen {
  id: string;
  compra_numero_control: string | null;
  total: number;
  saldo: number;
  estado: string;
  cuotas: number;
}

/**
 * Convierte una provisoria en definitiva y genera la cuenta por pagar + cuotas.
 * Todo en una transacción. Devuelve el resumen de la cuenta creada.
 */
export async function convertirProvisoriaEnDefinitiva(
  schemaRaw: string,
  empresaId: string,
  input: ConvertirProvisoriaInput
): Promise<CuentaPorPagarResumen> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tProv = quoteSchemaTable(schema, "proveedores");
  const tCxp = quoteSchemaTable(schema, "cuentas_por_pagar");
  const tCuo = quoteSchemaTable(schema, "compra_cuotas");

  const numero = input.numeroControl.trim();
  const fechaFactura = input.fechaFactura;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaFactura)) {
    throw new Error("fecha_factura inválida (YYYY-MM-DD).");
  }
  if (!input.numeroFactura?.trim()) {
    throw new Error("El número de factura es obligatorio para convertir en definitiva.");
  }

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // Filas de la provisoria (lock).
    const { rows: filas } = await client.query<{
      total: string | number;
      proveedor_id: string | null;
      proveedor_nombre: string | null;
      moneda: string | null;
      estado: string;
    }>(
      `SELECT total, proveedor_id, proveedor_nombre, moneda, estado
         FROM ${tC}
        WHERE empresa_id = $1::uuid AND numero_control = $2
        FOR UPDATE`,
      [empresaId, numero]
    );
    if (filas.length === 0) throw new Error("No se encontró la compra provisoria.");
    if (!filas.some((f) => f.estado === "provisoria")) {
      throw new Error("Esa compra no está en estado provisoria (ya fue convertida).");
    }

    const total = round2(filas.reduce((s, f) => s + (Number(f.total) || 0), 0));
    const proveedorId = filas[0].proveedor_id;
    const proveedorNombre = filas[0].proveedor_nombre;
    const moneda = filas[0].moneda || "PYG";

    // Pasar filas a definitiva + datos de factura.
    await client.query(
      `UPDATE ${tC}
          SET estado = 'registrada',
              numero_factura = $3,
              nro_timbrado = COALESCE($4, nro_timbrado),
              fecha_factura = $5::date
        WHERE empresa_id = $1::uuid AND numero_control = $2`,
      [empresaId, numero, input.numeroFactura.trim(), input.nroTimbrado?.trim() || null, fechaFactura]
    );

    // Config del proveedor (gracia + plazos).
    let diasGracia = 0;
    let plazos: number[] = [];
    if (proveedorId) {
      const { rows: pr } = await client.query<{ dias_gracia: number | null; plazos_cuotas: number[] | null }>(
        `SELECT dias_gracia, plazos_cuotas FROM ${tProv}
          WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
        [proveedorId, empresaId]
      );
      if (pr[0]) {
        diasGracia = Number(pr[0].dias_gracia) || 0;
        plazos = Array.isArray(pr[0].plazos_cuotas) ? pr[0].plazos_cuotas.map(Number) : [];
      }
    }
    // Si el proveedor no tiene plazos, se crea una única cuota al fin de la gracia.
    const cuotas = plazos.length > 0
      ? calcularCuotas(total, fechaFactura, diasGracia, plazos)
      : calcularCuotas(total, fechaFactura, diasGracia, [0]);

    const fechaInicioPago = addDaysYmd(fechaFactura, diasGracia);

    // Cuenta por pagar (upsert por numero_control: si ya existía, la reemplaza).
    await client.query(
      `DELETE FROM ${tCxp} WHERE empresa_id = $1::uuid AND compra_numero_control = $2`,
      [empresaId, numero]
    );
    const { rows: cxpRows } = await client.query<{ id: string }>(
      `INSERT INTO ${tCxp} (
         empresa_id, proveedor_id, proveedor_nombre, compra_numero_control,
         fecha_emision, dias_gracia, fecha_inicio_pago, moneda, total, saldo, estado
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5::date, $6::integer, $7::date, $8, $9::numeric, $9::numeric, 'pendiente'
       ) RETURNING id`,
      [empresaId, proveedorId, proveedorNombre, numero, fechaFactura, diasGracia, fechaInicioPago, moneda, total]
    );
    const cuentaId = cxpRows[0].id;

    for (const c of cuotas) {
      await client.query(
        `INSERT INTO ${tCuo} (
           empresa_id, cuenta_por_pagar_id, numero_cuota, dias_plazo,
           fecha_vencimiento, monto, saldo, estado
         ) VALUES ($1::uuid, $2::uuid, $3::integer, $4::integer, $5::date, $6::numeric, $6::numeric, 'pendiente')`,
        [empresaId, cuentaId, c.numero_cuota, c.dias_plazo, c.fecha_vencimiento, c.monto]
      );
    }

    await client.query("COMMIT");
    return {
      id: cuentaId,
      compra_numero_control: numero,
      total,
      saldo: total,
      estado: "pendiente",
      cuotas: cuotas.length,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

// ── Lecturas para el panel ──────────────────────────────────────────────────

export interface CuotaRow {
  id: string;
  cuenta_por_pagar_id: string;
  numero_cuota: number;
  fecha_vencimiento: string;
  monto: number;
  saldo: number;
  estado: string;
  proveedor_nombre: string | null;
  compra_numero_control: string | null;
  moneda: string;
}

/** Lista todas las cuotas con datos del proveedor/cuenta, para el panel de pagos. */
export async function listCuotas(schemaRaw: string, empresaId: string): Promise<CuotaRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tCuo = quoteSchemaTable(schema, "compra_cuotas");
  const tCxp = quoteSchemaTable(schema, "cuentas_por_pagar");
  const { rows } = await pool().query<CuotaRow>(
    `SELECT c.id, c.cuenta_por_pagar_id, c.numero_cuota,
            to_char(c.fecha_vencimiento, 'YYYY-MM-DD') AS fecha_vencimiento,
            c.monto, c.saldo, c.estado,
            cx.proveedor_nombre, cx.compra_numero_control, cx.moneda
       FROM ${tCuo} c
       JOIN ${tCxp} cx ON cx.id = c.cuenta_por_pagar_id
      WHERE c.empresa_id = $1::uuid AND c.estado <> 'anulada'
      ORDER BY c.fecha_vencimiento ASC`,
    [empresaId]
  );
  return rows.map((r) => ({
    ...r,
    monto: Number(r.monto) || 0,
    saldo: Number(r.saldo) || 0,
  }));
}

export interface RegistrarPagoInput {
  cuotaId: string;
  monto: number;
  fechaPago?: string | null;
  metodoPago?: string | null;
  referencia?: string | null;
  observaciones?: string | null;
}

/**
 * Registra un pago (parcial o total) de una cuota: inserta en pagos_proveedores,
 * baja el saldo de la cuota y recalcula el saldo/estado de la cuenta. Transaccional.
 */
export async function registrarPagoProveedor(
  schemaRaw: string,
  empresaId: string,
  input: RegistrarPagoInput
): Promise<{ ok: true }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tCuo = quoteSchemaTable(schema, "compra_cuotas");
  const tCxp = quoteSchemaTable(schema, "cuentas_por_pagar");
  const tPag = quoteSchemaTable(schema, "pagos_proveedores");

  const monto = round2(Number(input.monto) || 0);
  if (monto <= 0) throw new Error("El monto del pago debe ser mayor a 0.");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    const { rows: cuotaRows } = await client.query<{
      id: string;
      cuenta_por_pagar_id: string;
      saldo: string | number;
      proveedor_id: string | null;
    }>(
      `SELECT c.id, c.cuenta_por_pagar_id, c.saldo, cx.proveedor_id
         FROM ${tCuo} c JOIN ${tCxp} cx ON cx.id = c.cuenta_por_pagar_id
        WHERE c.id = $1::uuid AND c.empresa_id = $2::uuid
        FOR UPDATE`,
      [input.cuotaId, empresaId]
    );
    if (cuotaRows.length === 0) throw new Error("Cuota no encontrada.");
    const cuota = cuotaRows[0];
    const saldoCuota = round2(Number(cuota.saldo) || 0);
    if (monto > saldoCuota + 0.01) {
      throw new Error(`El pago (${monto}) supera el saldo de la cuota (${saldoCuota}).`);
    }

    await client.query(
      `INSERT INTO ${tPag} (
         empresa_id, proveedor_id, cuenta_por_pagar_id, cuota_id,
         fecha_pago, monto, metodo_pago, referencia, observaciones
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, COALESCE($5::date, current_date), $6::numeric, $7, $8, $9)`,
      [empresaId, cuota.proveedor_id, cuota.cuenta_por_pagar_id, cuota.id,
       input.fechaPago || null, monto, input.metodoPago || null, input.referencia || null, input.observaciones || null]
    );

    const nuevoSaldoCuota = round2(saldoCuota - monto);
    const estadoCuota = nuevoSaldoCuota <= 0.01 ? "pagada" : "parcial";
    await client.query(
      `UPDATE ${tCuo} SET saldo = $1::numeric, estado = $2, updated_at = now() WHERE id = $3::uuid`,
      [Math.max(0, nuevoSaldoCuota), estadoCuota, cuota.id]
    );

    // Recalcular la cuenta desde las cuotas.
    const { rows: agg } = await client.query<{ total: string; saldo: string; pend: string }>(
      `SELECT COALESCE(SUM(monto),0) AS total, COALESCE(SUM(saldo),0) AS saldo,
              COUNT(*) FILTER (WHERE saldo > 0.01 AND estado <> 'anulada') AS pend
         FROM ${tCuo} WHERE cuenta_por_pagar_id = $1::uuid AND estado <> 'anulada'`,
      [cuota.cuenta_por_pagar_id]
    );
    const saldoCuenta = round2(Number(agg[0]?.saldo) || 0);
    const pend = Number(agg[0]?.pend) || 0;
    const estadoCuenta = saldoCuenta <= 0.01 ? "pagado" : pend > 0 && saldoCuenta < round2(Number(agg[0]?.total) || 0) ? "parcial" : "pendiente";
    await client.query(
      `UPDATE ${tCxp} SET saldo = $1::numeric, estado = $2, updated_at = now() WHERE id = $3::uuid`,
      [Math.max(0, saldoCuenta), estadoCuenta, cuota.cuenta_por_pagar_id]
    );

    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

// ── Provisorias (para la UI de compras) ─────────────────────────────────────

export interface ProvisoriaResumen {
  numero_control: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  moneda: string;
  total: number;
  items: number;
  fecha: string | null;
}

/** Lista las compras en estado provisoria, agrupadas por numero_control. */
export async function listProvisorias(schemaRaw: string, empresaId: string): Promise<ProvisoriaResumen[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const { rows } = await pool().query<{
    numero_control: string;
    proveedor_id: string | null;
    proveedor_nombre: string | null;
    moneda: string | null;
    total: string;
    items: string;
    fecha: string | null;
  }>(
    `SELECT numero_control,
            MAX(proveedor_id::text) AS proveedor_id,
            MAX(proveedor_nombre) AS proveedor_nombre,
            MAX(moneda) AS moneda,
            COALESCE(SUM(total),0) AS total,
            COUNT(*) AS items,
            to_char(MAX(fecha), 'YYYY-MM-DD') AS fecha
       FROM ${tC}
      WHERE empresa_id = $1::uuid AND estado = 'provisoria'
      GROUP BY numero_control
      ORDER BY MAX(fecha) DESC`,
    [empresaId]
  );
  return rows.map((r) => ({
    numero_control: r.numero_control,
    proveedor_id: r.proveedor_id,
    proveedor_nombre: r.proveedor_nombre,
    moneda: r.moneda || "PYG",
    total: Number(r.total) || 0,
    items: Number(r.items) || 0,
    fecha: r.fecha,
  }));
}
