/**
 * Emisión de factura autoimpresor: asigna el número fiscal correlativo a una
 * venta y lo persiste, incrementando `numero_actual` de empresa_autoimpresor_config
 * de forma ATÓMICA (SELECT ... FOR UPDATE dentro de una transacción) para que
 * dos ventas simultáneas nunca reciban el mismo número ni se saltee uno.
 *
 * El documento se imprime en formato TICKET (ver render-factura-ticket.ts).
 * NO toca SIFEN. Convive con el ticket interno.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export interface FacturaAutoimpresor {
  id: string;
  empresa_id: string;
  venta_id: string;
  numero_secuencia: number;
  numero_completo: string;
  establecimiento_codigo: string;
  punto_expedicion_codigo: string;
  timbrado_numero: string;
  timbrado_inicio_vigencia: string | null;
  timbrado_fin_vigencia: string | null;
  condicion: "contado" | "credito";
  gravado_10: number;
  iva_10: number;
  gravado_5: number;
  iva_5: number;
  exentas: number;
  total: number;
  emitida_at: string;
}

/** Motivo por el que NO se puede emitir una factura autoimpresor real (→ borrador). */
export type BloqueoEmision =
  | "modo_no_autoimpresor"
  | "config_inactiva"
  | "config_incompleta"
  | "timbrado_agotado";

export class EmisionBloqueadaError extends Error {
  motivo: BloqueoEmision;
  constructor(motivo: BloqueoEmision, message: string) {
    super(message);
    this.name = "EmisionBloqueadaError";
    this.motivo = motivo;
  }
}

const FA_COLS = `
  id, empresa_id::text, venta_id::text, numero_secuencia, numero_completo,
  establecimiento_codigo, punto_expedicion_codigo, timbrado_numero,
  timbrado_inicio_vigencia, timbrado_fin_vigencia, condicion,
  gravado_10, iva_10, gravado_5, iva_5, exentas, total, emitida_at
`;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function mapRow(r: Record<string, unknown>): FacturaAutoimpresor {
  return {
    id: String(r.id),
    empresa_id: String(r.empresa_id),
    venta_id: String(r.venta_id),
    numero_secuencia: num(r.numero_secuencia),
    numero_completo: String(r.numero_completo),
    establecimiento_codigo: String(r.establecimiento_codigo),
    punto_expedicion_codigo: String(r.punto_expedicion_codigo),
    timbrado_numero: String(r.timbrado_numero),
    timbrado_inicio_vigencia: r.timbrado_inicio_vigencia ? String(r.timbrado_inicio_vigencia) : null,
    timbrado_fin_vigencia: r.timbrado_fin_vigencia ? String(r.timbrado_fin_vigencia) : null,
    condicion: r.condicion === "credito" ? "credito" : "contado",
    gravado_10: num(r.gravado_10),
    iva_10: num(r.iva_10),
    gravado_5: num(r.gravado_5),
    iva_5: num(r.iva_5),
    exentas: num(r.exentas),
    total: num(r.total),
    emitida_at: String(r.emitida_at),
  };
}

/** Liquidación de IVA de una venta (montos con IVA incluido, como se emiten). */
export interface LiquidacionIva {
  gravado_10: number;
  iva_10: number;
  gravado_5: number;
  iva_5: number;
  exentas: number;
  total: number;
}

interface ItemIva {
  tipo_iva: string;
  total_linea: number | string;
  monto_iva: number | string;
}

/**
 * Reparte los ítems de la venta por tasa de IVA. Los montos son IVA incluido
 * (`total_linea`); `monto_iva` es el IVA contenido en esa línea.
 */
export function liquidarIva(items: ItemIva[]): LiquidacionIva {
  const liq: LiquidacionIva = { gravado_10: 0, iva_10: 0, gravado_5: 0, iva_5: 0, exentas: 0, total: 0 };
  for (const it of items) {
    const linea = num(it.total_linea);
    const iva = num(it.monto_iva);
    liq.total += linea;
    const t = String(it.tipo_iva).toUpperCase();
    if (t === "10%") {
      liq.gravado_10 += linea;
      liq.iva_10 += iva;
    } else if (t === "5%") {
      liq.gravado_5 += linea;
      liq.iva_5 += iva;
    } else {
      liq.exentas += linea;
    }
  }
  return liq;
}

function formatNumeroFiscal(est: string, punto: string, seq: number): string {
  const e = String(est).replace(/\D/g, "").padStart(3, "0").slice(-3);
  const p = String(punto).replace(/\D/g, "").padStart(3, "0").slice(-3);
  const n = String(seq).padStart(7, "0");
  return `${e}-${p}-${n}`;
}

/** Lee la factura ya emitida para una venta (o null si aún no se emitió). */
export async function getFacturaAutoimpresor(
  schemaRaw: string,
  empresaId: string,
  ventaId: string
): Promise<FacturaAutoimpresor | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const t = quoteSchemaTable(schema, "factura_autoimpresor");
  const { rows } = await pool.query(
    `SELECT ${FA_COLS} FROM ${t} WHERE empresa_id = $1::uuid AND venta_id = $2::uuid LIMIT 1`,
    [empresaId, ventaId]
  );
  return rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null;
}

/**
 * Emite (o devuelve si ya existía) la factura autoimpresor de una venta.
 * Asigna el número correlativo e incrementa numero_actual atómicamente.
 * Lanza EmisionBloqueadaError si la config no permite emitir.
 */
export async function emitirFacturaAutoimpresor(
  schemaRaw: string,
  empresaId: string,
  ventaId: string
): Promise<FacturaAutoimpresor> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");

  const tFactura = quoteSchemaTable(schema, "factura_autoimpresor");
  const tConfig = quoteSchemaTable(schema, "empresa_autoimpresor_config");
  const tVenta = quoteSchemaTable(schema, "ventas");
  const tItems = quoteSchemaTable(schema, "ventas_items");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Idempotencia: si ya se emitió, devolvemos esa (sin tocar la secuencia).
    const yaQ = await client.query(
      `SELECT ${FA_COLS} FROM ${tFactura} WHERE empresa_id = $1::uuid AND venta_id = $2::uuid LIMIT 1`,
      [empresaId, ventaId]
    );
    if (yaQ.rows[0]) {
      await client.query("COMMIT");
      return mapRow(yaQ.rows[0] as Record<string, unknown>);
    }

    // Config con lock: nadie más puede tomar el mismo numero_actual mientras tanto.
    const cfgQ = await client.query(
      `SELECT activo, timbrado_numero, timbrado_inicio_vigencia, timbrado_fin_vigencia,
              establecimiento_codigo, punto_expedicion_codigo,
              numero_inicial, numero_final, numero_actual
         FROM ${tConfig}
        WHERE empresa_id = $1::uuid
        FOR UPDATE`,
      [empresaId]
    );
    const cfg = cfgQ.rows[0] as Record<string, unknown> | undefined;
    if (!cfg) throw new EmisionBloqueadaError("config_incompleta", "No hay configuración de autoimpresor.");
    if (cfg.activo !== true) throw new EmisionBloqueadaError("config_inactiva", "El autoimpresor no está activo.");

    const est = cfg.establecimiento_codigo ? String(cfg.establecimiento_codigo) : "";
    const punto = cfg.punto_expedicion_codigo ? String(cfg.punto_expedicion_codigo) : "";
    const timbrado = cfg.timbrado_numero ? String(cfg.timbrado_numero) : "";
    const inicial = cfg.numero_inicial == null ? null : num(cfg.numero_inicial);
    const final = cfg.numero_final == null ? null : num(cfg.numero_final);
    const actual = cfg.numero_actual == null ? null : num(cfg.numero_actual);
    if (!est || !punto || !timbrado || inicial == null || final == null || actual == null) {
      throw new EmisionBloqueadaError("config_incompleta", "Faltan datos del timbrado (establecimiento, punto, rango).");
    }
    if (actual < inicial || actual > final) {
      throw new EmisionBloqueadaError("timbrado_agotado", "El timbrado se agotó o el número actual está fuera de rango.");
    }

    // Venta (condición) + ítems (liquidación de IVA).
    const vQ = await client.query(
      `SELECT tipo_venta FROM ${tVenta} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
      [ventaId, empresaId]
    );
    if (!vQ.rows[0]) throw new Error("Venta no encontrada.");
    const tipoVenta = String((vQ.rows[0] as Record<string, unknown>).tipo_venta ?? "").toUpperCase();
    const condicion: "contado" | "credito" = tipoVenta === "CREDITO" ? "credito" : "contado";

    const iQ = await client.query(
      `SELECT tipo_iva, total_linea, monto_iva FROM ${tItems} WHERE venta_id = $1::uuid AND empresa_id = $2::uuid`,
      [ventaId, empresaId]
    );
    const liq = liquidarIva(iQ.rows as ItemIva[]);

    const seq = actual;
    const numeroCompleto = formatNumeroFiscal(est, punto, seq);

    const insQ = await client.query(
      `INSERT INTO ${tFactura} (
         empresa_id, venta_id, numero_secuencia, numero_completo,
         establecimiento_codigo, punto_expedicion_codigo, timbrado_numero,
         timbrado_inicio_vigencia, timbrado_fin_vigencia, condicion,
         gravado_10, iva_10, gravado_5, iva_5, exentas, total
       ) VALUES (
         $1::uuid, $2::uuid, $3::integer, $4,
         $5, $6, $7,
         $8::date, $9::date, $10,
         $11, $12, $13, $14, $15, $16
       )
       RETURNING ${FA_COLS}`,
      [
        empresaId, ventaId, seq, numeroCompleto,
        est, punto, timbrado,
        cfg.timbrado_inicio_vigencia ?? null, cfg.timbrado_fin_vigencia ?? null, condicion,
        liq.gravado_10, liq.iva_10, liq.gravado_5, liq.iva_5, liq.exentas, liq.total,
      ]
    );

    await client.query(
      `UPDATE ${tConfig} SET numero_actual = $2::integer, updated_at = now() WHERE empresa_id = $1::uuid`,
      [empresaId, seq + 1]
    );

    await client.query("COMMIT");
    return mapRow(insQ.rows[0] as Record<string, unknown>);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * "La factura salió mal → reimprimir en hoja nueva": salta (anula) el número
 * actual de la venta y le asigna el SIGUIENTE número del talonario, para que el
 * sistema quede alineado con la hoja física nueva. El número anterior queda como
 * salto en el correlativo (la hoja física se archiva anulada, en papel).
 *
 * A diferencia de `emitirFacturaAutoimpresor`, NO es idempotente: cada llamada
 * avanza el número (una por cada hoja física desperdiciada). Requiere que la venta
 * ya tenga una factura emitida (si no, no hay nada que reimprimir).
 */
export async function reimprimirFacturaEnNuevaHoja(
  schemaRaw: string,
  empresaId: string,
  ventaId: string
): Promise<FacturaAutoimpresor> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");

  const tFactura = quoteSchemaTable(schema, "factura_autoimpresor");
  const tConfig = quoteSchemaTable(schema, "empresa_autoimpresor_config");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Debe existir una factura previa (ya se imprimió al menos una vez).
    const prevQ = await client.query(
      `SELECT id FROM ${tFactura} WHERE empresa_id = $1::uuid AND venta_id = $2::uuid
        ORDER BY numero_secuencia DESC LIMIT 1 FOR UPDATE`,
      [empresaId, ventaId]
    );
    if (!prevQ.rows[0]) {
      throw new EmisionBloqueadaError("config_incompleta", "La venta todavía no tiene una factura emitida para reimprimir.");
    }
    const facturaId = String((prevQ.rows[0] as Record<string, unknown>).id);

    // Config con lock (mismo criterio que la emisión normal).
    const cfgQ = await client.query(
      `SELECT activo, establecimiento_codigo, punto_expedicion_codigo,
              numero_inicial, numero_final, numero_actual
         FROM ${tConfig} WHERE empresa_id = $1::uuid FOR UPDATE`,
      [empresaId]
    );
    const cfg = cfgQ.rows[0] as Record<string, unknown> | undefined;
    if (!cfg) throw new EmisionBloqueadaError("config_incompleta", "No hay configuración de autoimpresor.");
    if (cfg.activo !== true) throw new EmisionBloqueadaError("config_inactiva", "El autoimpresor no está activo.");
    const est = cfg.establecimiento_codigo ? String(cfg.establecimiento_codigo) : "";
    const punto = cfg.punto_expedicion_codigo ? String(cfg.punto_expedicion_codigo) : "";
    const inicial = cfg.numero_inicial == null ? null : num(cfg.numero_inicial);
    const final = cfg.numero_final == null ? null : num(cfg.numero_final);
    const actual = cfg.numero_actual == null ? null : num(cfg.numero_actual);
    if (!est || !punto || inicial == null || final == null || actual == null) {
      throw new EmisionBloqueadaError("config_incompleta", "Faltan datos del timbrado (establecimiento, punto, rango).");
    }
    if (actual < inicial || actual > final) {
      throw new EmisionBloqueadaError("timbrado_agotado", "El timbrado se agotó o el número actual está fuera de rango.");
    }

    const seq = actual;
    const numeroCompleto = formatNumeroFiscal(est, punto, seq);

    const updQ = await client.query(
      `UPDATE ${tFactura} SET numero_secuencia = $2::integer, numero_completo = $3, emitida_at = now()
        WHERE id = $1::uuid RETURNING ${FA_COLS}`,
      [facturaId, seq, numeroCompleto]
    );
    await client.query(
      `UPDATE ${tConfig} SET numero_actual = $2::integer, updated_at = now() WHERE empresa_id = $1::uuid`,
      [empresaId, seq + 1]
    );

    await client.query("COMMIT");
    return mapRow(updQ.rows[0] as Record<string, unknown>);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Edita manualmente el número de factura preimpresa de una venta (para que Norma
 * mantenga el correlativo). Valida que el número esté dentro del rango del timbrado
 * y que NO esté usado por otra factura (evita duplicados). Si el nuevo número queda
 * por encima del contador, adelanta `numero_actual` para no colisionar en la próxima
 * emisión. Solo numeración: no toca stock/caja/ítems.
 */
export async function setNumeroFacturaAutoimpresor(
  schemaRaw: string,
  empresaId: string,
  ventaId: string,
  nuevoSeq: number
): Promise<FacturaAutoimpresor> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");

  const tFactura = quoteSchemaTable(schema, "factura_autoimpresor");
  const tConfig = quoteSchemaTable(schema, "empresa_autoimpresor_config");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const prevQ = await client.query(
      `SELECT id, establecimiento_codigo AS est, punto_expedicion_codigo AS punto
         FROM ${tFactura} WHERE empresa_id = $1::uuid AND venta_id = $2::uuid
        ORDER BY numero_secuencia DESC LIMIT 1 FOR UPDATE`,
      [empresaId, ventaId]
    );
    if (!prevQ.rows[0]) {
      throw new Error("La venta no tiene una factura emitida para editarle el número.");
    }
    const row = prevQ.rows[0] as Record<string, unknown>;
    const facturaId = String(row.id);
    const est = String(row.est ?? "");
    const punto = String(row.punto ?? "");

    // Rango del timbrado.
    const cfgQ = await client.query(
      `SELECT numero_inicial, numero_final, numero_actual FROM ${tConfig} WHERE empresa_id = $1::uuid FOR UPDATE`,
      [empresaId]
    );
    const cfg = cfgQ.rows[0] as Record<string, unknown> | undefined;
    if (cfg) {
      const ni = num(cfg.numero_inicial);
      const nf = num(cfg.numero_final);
      if (nuevoSeq < ni || nuevoSeq > nf) {
        throw new Error(`El número debe estar entre ${ni} y ${nf} (rango del timbrado).`);
      }
    }

    // Que no lo tenga otra factura.
    const dupQ = await client.query(
      `SELECT 1 FROM ${tFactura} WHERE empresa_id = $1::uuid AND numero_secuencia = $2::integer AND id <> $3::uuid LIMIT 1`,
      [empresaId, nuevoSeq, facturaId]
    );
    if (dupQ.rows[0]) {
      throw new Error(`El número ${formatNumeroFiscal(est, punto, nuevoSeq)} ya está usado por otra factura.`);
    }

    const numeroCompleto = formatNumeroFiscal(est, punto, nuevoSeq);
    const updQ = await client.query(
      `UPDATE ${tFactura} SET numero_secuencia = $2::integer, numero_completo = $3 WHERE id = $1::uuid RETURNING ${FA_COLS}`,
      [facturaId, nuevoSeq, numeroCompleto]
    );

    // Adelantar el contador si hace falta, para no colisionar en la próxima emisión.
    if (cfg && num(cfg.numero_actual) <= nuevoSeq) {
      await client.query(
        `UPDATE ${tConfig} SET numero_actual = $2::integer, updated_at = now() WHERE empresa_id = $1::uuid`,
        [empresaId, nuevoSeq + 1]
      );
    }

    await client.query("COMMIT");
    return mapRow(updQ.rows[0] as Record<string, unknown>);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
