/**
 * Reporte de créditos por cliente (ventas a crédito / cuentas por cobrar).
 *  - getCreditosReporte: lista de clientes con crédito + totales (seguimiento).
 *  - getExtractoCliente: extracto de un cliente (sus ventas a crédito + cobros)
 *    para revisar el detalle y exportarlo/enviarlo.
 *
 * Fuente: cuentas_por_cobrar (1 por venta a crédito, con saldo/vencimiento) +
 * cobros_clientes (pagos). PG directo, mismo patrón que reportes-pg. No toca
 * ventas/caja/SIFEN.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type {
  CreditosReporte,
  CreditoClienteFila,
  ExtractoCliente,
  ExtractoCuentaFila,
  ExtractoCobroFila,
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

const NOMBRE_SQL = `COALESCE(NULLIF(cl.empresa,''), NULLIF(cl.nombre_contacto,''), NULLIF(cl.nombre,''), 'Cliente')`;

export async function getCreditosReporte(
  schemaRaw: string,
  empresaId: string
): Promise<CreditosReporte> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tCxc = quoteSchemaTable(schema, "cuentas_por_cobrar");
  const tCli = quoteSchemaTable(schema, "clientes");

  const { rows } = await pool().query(
    `SELECT c.cliente_id                                   AS cliente_id,
            ${NOMBRE_SQL}                                  AS cliente_nombre,
            cl.ruc                                         AS cliente_ruc,
            count(*)                                       AS ventas_credito,
            sum(c.total)                                   AS total,
            sum(c.saldo)                                   AS saldo,
            sum(CASE WHEN c.saldo > 0 AND c.fecha_vencimiento IS NOT NULL
                     AND c.fecha_vencimiento < CURRENT_DATE THEN c.saldo ELSE 0 END) AS vencido,
            sum(CASE WHEN c.saldo > 0 AND (c.fecha_vencimiento IS NULL OR c.fecha_vencimiento >= CURRENT_DATE)
                     THEN c.saldo ELSE 0 END) AS por_vencer,
            sum(CASE WHEN c.saldo > 0 AND (CURRENT_DATE - c.fecha_vencimiento) BETWEEN 1 AND 30
                     THEN c.saldo ELSE 0 END) AS vencido_1_30,
            sum(CASE WHEN c.saldo > 0 AND (CURRENT_DATE - c.fecha_vencimiento) BETWEEN 31 AND 60
                     THEN c.saldo ELSE 0 END) AS vencido_31_60,
            sum(CASE WHEN c.saldo > 0 AND (CURRENT_DATE - c.fecha_vencimiento) BETWEEN 61 AND 90
                     THEN c.saldo ELSE 0 END) AS vencido_61_90,
            sum(CASE WHEN c.saldo > 0 AND (CURRENT_DATE - c.fecha_vencimiento) > 90
                     THEN c.saldo ELSE 0 END) AS vencido_90_mas,
            min(CASE WHEN c.saldo > 0 THEN c.fecha_vencimiento END) AS proximo_vencimiento,
            max(c.fecha_emision)                           AS ultima_venta
       FROM ${tCxc} c
       LEFT JOIN ${tCli} cl ON cl.id = c.cliente_id AND cl.empresa_id = c.empresa_id
      WHERE c.empresa_id = $1::uuid
      GROUP BY c.cliente_id, cl.empresa, cl.nombre_contacto, cl.nombre, cl.ruc
      ORDER BY saldo DESC, total DESC`,
    [empresaId]
  );

  const clientes: CreditoClienteFila[] = rows.map((r: Record<string, unknown>) => {
    const total = num(r.total);
    const saldo = num(r.saldo);
    return {
      cliente_id: String(r.cliente_id),
      cliente_nombre: r.cliente_nombre != null ? String(r.cliente_nombre) : "Cliente",
      cliente_ruc: r.cliente_ruc != null ? String(r.cliente_ruc) : null,
      ventas_credito: num(r.ventas_credito),
      total,
      cobrado: Math.max(0, total - saldo),
      saldo,
      vencido: num(r.vencido),
      proximo_vencimiento: r.proximo_vencimiento ? String(r.proximo_vencimiento).slice(0, 10) : null,
      ultima_venta: r.ultima_venta ? String(r.ultima_venta) : null,
      por_vencer: num(r.por_vencer),
      vencido_1_30: num(r.vencido_1_30),
      vencido_31_60: num(r.vencido_31_60),
      vencido_61_90: num(r.vencido_61_90),
      vencido_90_mas: num(r.vencido_90_mas),
    };
  });

  const sum = (f: (c: CreditoClienteFila) => number) => clientes.reduce((s, c) => s + f(c), 0);
  const totales = {
    clientes_con_saldo: clientes.filter((c) => c.saldo > 0).length,
    ventas_credito: sum((c) => c.ventas_credito),
    total_credito: sum((c) => c.total),
    total_cobrado: sum((c) => c.cobrado),
    saldo_pendiente: sum((c) => c.saldo),
    monto_vencido: sum((c) => c.vencido),
    por_vencer: sum((c) => c.por_vencer),
    vencido_1_30: sum((c) => c.vencido_1_30),
    vencido_31_60: sum((c) => c.vencido_31_60),
    vencido_61_90: sum((c) => c.vencido_61_90),
    vencido_90_mas: sum((c) => c.vencido_90_mas),
  };

  return { totales, clientes };
}

export async function getExtractoCliente(
  schemaRaw: string,
  empresaId: string,
  clienteId: string
): Promise<ExtractoCliente | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tCxc = quoteSchemaTable(schema, "cuentas_por_cobrar");
  const tCob = quoteSchemaTable(schema, "cobros_clientes");
  const tCli = quoteSchemaTable(schema, "clientes");

  const cliQ = await pool().query(
    `SELECT id,
            COALESCE(NULLIF(empresa,''), NULLIF(nombre_contacto,''), NULLIF(nombre,''), 'Cliente') AS nombre,
            ruc, telefono, direccion
       FROM ${tCli} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
    [clienteId, empresaId]
  );
  if (cliQ.rows.length === 0) return null;
  const c = cliQ.rows[0] as Record<string, unknown>;

  const cuentasQ = await pool().query(
    `SELECT id, numero_venta, fecha_emision, fecha_vencimiento, total, saldo, estado
       FROM ${tCxc}
      WHERE empresa_id = $1::uuid AND cliente_id = $2::uuid
      ORDER BY fecha_emision ASC, created_at ASC`,
    [empresaId, clienteId]
  );
  const cuentas: ExtractoCuentaFila[] = cuentasQ.rows.map((r: Record<string, unknown>) => {
    const total = num(r.total);
    const saldo = num(r.saldo);
    const venc = r.fecha_vencimiento ? String(r.fecha_vencimiento).slice(0, 10) : null;
    let dias = 0;
    if (venc && saldo > 0) {
      const d = Math.floor((Date.now() - new Date(`${venc}T00:00:00`).getTime()) / 86400000);
      dias = d > 0 ? d : 0;
    }
    return {
      id: String(r.id),
      numero_venta: r.numero_venta != null ? String(r.numero_venta) : null,
      fecha_emision: String(r.fecha_emision),
      fecha_vencimiento: venc,
      total,
      saldo,
      cobrado: Math.max(0, total - saldo),
      estado: r.estado != null ? String(r.estado) : "pendiente",
      dias_vencido: dias,
    };
  });

  const cobrosQ = await pool().query(
    `SELECT id, fecha_pago, numero_venta, monto, metodo_pago, referencia
       FROM ${tCob}
      WHERE empresa_id = $1::uuid AND cliente_id = $2::uuid
      ORDER BY fecha_pago ASC, created_at ASC`,
    [empresaId, clienteId]
  ).catch(async () => {
    // Fallback si cobros_clientes no tiene numero_venta en algún tenant.
    return pool().query(
      `SELECT id, fecha_pago, monto, metodo_pago, referencia
         FROM ${tCob} WHERE empresa_id = $1::uuid AND cliente_id = $2::uuid ORDER BY fecha_pago ASC`,
      [empresaId, clienteId]
    );
  });
  const cobros: ExtractoCobroFila[] = cobrosQ.rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    fecha_pago: String(r.fecha_pago),
    numero_venta: r.numero_venta != null ? String(r.numero_venta) : null,
    monto: num(r.monto),
    metodo_pago: r.metodo_pago != null ? String(r.metodo_pago) : null,
    referencia: r.referencia != null ? String(r.referencia) : null,
  }));

  const totales = {
    total: cuentas.reduce((s, x) => s + x.total, 0),
    cobrado: cuentas.reduce((s, x) => s + x.cobrado, 0),
    saldo: cuentas.reduce((s, x) => s + x.saldo, 0),
    vencido: cuentas.reduce((s, x) => s + (x.dias_vencido > 0 ? x.saldo : 0), 0),
  };

  return {
    cliente: {
      id: String(c.id),
      nombre: c.nombre != null ? String(c.nombre) : "Cliente",
      ruc: c.ruc != null ? String(c.ruc) : null,
      telefono: c.telefono != null ? String(c.telefono) : null,
      direccion: c.direccion != null ? String(c.direccion) : null,
    },
    cuentas,
    cobros,
    totales,
  };
}
