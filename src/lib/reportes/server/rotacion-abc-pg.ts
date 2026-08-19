/**
 * Rotación de productos (clasificación ABC por ventas), server-side.
 * Solo lectura sobre productos + ventas_items + ventas (schema ferreteriarepublica).
 * Mismo patrón de pool que reportes-pg / compras-pg.
 *
 * Incluye productos SIN ventas (LEFT JOIN) para que aparezcan como C.
 * Excluye ventas anuladas. La clasificación A/B/C se calcula con el helper
 * compartido `clasificarABC` (misma lógica que usa el listado de productos).
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { clasificarABC, type RangoABC } from "@/lib/reportes/abc";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export interface ProductoRotacionRow {
  producto_id: string;
  nombre: string;
  sku: string | null;
  stock_actual: number;
  stock_minimo: number;
  cantidad_vendida: number;
  importe_vendido: number;
  rango: RangoABC;
}

export interface RotacionAbcResult {
  desde: string;
  hasta: string;
  meses: number;
  totales: { total: number; a: number; b: number; c: number; sin_ventas: number };
  productos: ProductoRotacionRow[];
}

interface RawRow {
  producto_id: string;
  nombre: string;
  sku: string | null;
  stock_actual: number | string;
  stock_minimo: number | string;
  cantidad_vendida: number | string;
  importe_vendido: number | string;
}

const num = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Devuelve todos los productos vendibles activos con su cantidad/importe vendido
 * en [start, end] y su rango A/B/C.
 */
export async function getRotacionAbc(
  schemaRaw: string,
  empresaId: string,
  bounds: { start: string; end: string; desde: string; hasta: string; meses: number }
): Promise<RotacionAbcResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tProd = quoteSchemaTable(schema, "productos");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tV = quoteSchemaTable(schema, "ventas");

  const { rows } = await pool().query<RawRow>(
    `SELECT p.id AS producto_id, p.nombre, p.sku,
            p.stock_actual::float8  AS stock_actual,
            p.stock_minimo::float8  AS stock_minimo,
            COALESCE(s.cantidad, 0)::float8 AS cantidad_vendida,
            COALESCE(s.importe, 0)::float8  AS importe_vendido
       FROM ${tProd} p
       LEFT JOIN (
         SELECT vi.producto_id,
                SUM(vi.cantidad)     AS cantidad,
                SUM(vi.total_linea)  AS importe
           FROM ${tVI} vi
           JOIN ${tV} v ON v.id = vi.venta_id
          WHERE v.empresa_id = $1::uuid
            AND v.fecha >= $2::timestamptz AND v.fecha <= $3::timestamptz
            AND COALESCE(v.estado, '') <> 'anulada'
          GROUP BY vi.producto_id
       ) s ON s.producto_id = p.id
      WHERE p.empresa_id = $1::uuid AND p.activo = true AND p.es_vendible = true
      ORDER BY cantidad_vendida DESC, p.nombre ASC`,
    [empresaId, bounds.start, bounds.end]
  );

  const base = rows.map((r) => ({
    producto_id: r.producto_id,
    nombre: r.nombre,
    sku: r.sku,
    stock_actual: num(r.stock_actual),
    stock_minimo: num(r.stock_minimo),
    cantidad_vendida: num(r.cantidad_vendida),
    importe_vendido: num(r.importe_vendido),
  }));

  const productos: ProductoRotacionRow[] = clasificarABC(base);

  const totales = { total: productos.length, a: 0, b: 0, c: 0, sin_ventas: 0 };
  for (const p of productos) {
    if (p.rango === "A") totales.a++;
    else if (p.rango === "B") totales.b++;
    else totales.c++;
    if (p.cantidad_vendida <= 0) totales.sin_ventas++;
  }

  return {
    desde: bounds.desde,
    hasta: bounds.hasta,
    meses: bounds.meses,
    totales,
    productos,
  };
}
