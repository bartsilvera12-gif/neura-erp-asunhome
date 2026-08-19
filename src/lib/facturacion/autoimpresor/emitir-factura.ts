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
