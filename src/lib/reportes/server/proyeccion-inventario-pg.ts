/**
 * Proyección de inventario (cobertura de stock en días), server-side.
 * Solo lectura sobre productos + ventas_items + ventas (schema ferreteriarepublica).
 * Mismo patrón de pool que rotacion-abc-pg / reportes-pg.
 *
 * Incluye productos SIN ventas (LEFT JOIN) → "Sin movimiento". Excluye ventas
 * anuladas. Cobertura y estado se calculan con el helper compartido
 * `clasificarCobertura`.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { clasificarCobertura, type EstadoStock } from "@/lib/reportes/proyeccion";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export interface ProyeccionRow {
  producto_id: string;
  nombre: string;
  sku: string | null;
  stock_actual: number;
  stock_minimo: number;
  cantidad_vendida: number;
  promedio_diario: number;
  dias_cobertura: number | null;
  estado: EstadoStock;
}

export interface ProyeccionResult {
  desde: string;
  hasta: string;
  dias: number;
  totales: Record<EstadoStock, number> & { total: number };
  productos: ProyeccionRow[];
}

interface RawRow {
  producto_id: string;
  nombre: string;
  sku: string | null;
  stock_actual: number | string;
  stock_minimo: number | string;
  cantidad_vendida: number | string;
}

const num = (v: unknown): number => Number(v ?? 0) || 0;

export async function getProyeccionInventario(
  schemaRaw: string,
  empresaId: string,
  bounds: { start: string; end: string; desde: string; hasta: string; dias: number }
): Promise<ProyeccionResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tProd = quoteSchemaTable(schema, "productos");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tV = quoteSchemaTable(schema, "ventas");

  const { rows } = await pool().query<RawRow>(
    `SELECT p.id AS producto_id, p.nombre, p.sku,
            p.stock_actual::float8 AS stock_actual,
            p.stock_minimo::float8 AS stock_minimo,
            COALESCE(s.cantidad, 0)::float8 AS cantidad_vendida
       FROM ${tProd} p
       LEFT JOIN (
         SELECT vi.producto_id, SUM(vi.cantidad) AS cantidad
           FROM ${tVI} vi
           JOIN ${tV} v ON v.id = vi.venta_id
          WHERE v.empresa_id = $1::uuid
            AND v.fecha >= $2::timestamptz AND v.fecha <= $3::timestamptz
            AND COALESCE(v.estado, '') <> 'anulada'
          GROUP BY vi.producto_id
       ) s ON s.producto_id = p.id
      WHERE p.empresa_id = $1::uuid AND p.activo = true AND p.es_vendible = true
      ORDER BY p.nombre ASC`,
    [empresaId, bounds.start, bounds.end]
  );

  const totales = {
    total: 0,
    sin_stock: 0,
    sin_movimiento: 0,
    critico: 0,
    bajo: 0,
    normal: 0,
    sobrestock: 0,
  };

  const productos: ProyeccionRow[] = rows.map((r) => {
    const stock_actual = num(r.stock_actual);
    const cantidad_vendida = num(r.cantidad_vendida);
    const c = clasificarCobertura(stock_actual, cantidad_vendida, bounds.dias);
    totales.total++;
    totales[c.estado]++;
    return {
      producto_id: r.producto_id,
      nombre: r.nombre,
      sku: r.sku,
      stock_actual,
      stock_minimo: num(r.stock_minimo),
      cantidad_vendida,
      promedio_diario: c.promedio_diario,
      dias_cobertura: c.dias_cobertura,
      estado: c.estado,
    };
  });

  return { desde: bounds.desde, hasta: bounds.hasta, dias: bounds.dias, totales, productos };
}

/** Proyección de UN producto (para el detalle). null si no existe / no pertenece. */
export async function getProyeccionProducto(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  bounds: { start: string; end: string; desde: string; hasta: string; dias: number }
): Promise<(ProyeccionRow & { desde: string; hasta: string; dias: number }) | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tProd = quoteSchemaTable(schema, "productos");
  const tVI = quoteSchemaTable(schema, "ventas_items");
  const tV = quoteSchemaTable(schema, "ventas");

  const { rows } = await pool().query<RawRow>(
    `SELECT p.id AS producto_id, p.nombre, p.sku,
            p.stock_actual::float8 AS stock_actual,
            p.stock_minimo::float8 AS stock_minimo,
            COALESCE((
              SELECT SUM(vi.cantidad)
                FROM ${tVI} vi
                JOIN ${tV} v ON v.id = vi.venta_id
               WHERE vi.producto_id = p.id
                 AND v.empresa_id = $1::uuid
                 AND v.fecha >= $3::timestamptz AND v.fecha <= $4::timestamptz
                 AND COALESCE(v.estado, '') <> 'anulada'
            ), 0)::float8 AS cantidad_vendida
       FROM ${tProd} p
      WHERE p.id = $2::uuid AND p.empresa_id = $1::uuid`,
    [empresaId, productoId, bounds.start, bounds.end]
  );
  const r = rows[0];
  if (!r) return null;

  const stock_actual = num(r.stock_actual);
  const cantidad_vendida = num(r.cantidad_vendida);
  const c = clasificarCobertura(stock_actual, cantidad_vendida, bounds.dias);
  return {
    producto_id: r.producto_id,
    nombre: r.nombre,
    sku: r.sku,
    stock_actual,
    stock_minimo: num(r.stock_minimo),
    cantidad_vendida,
    promedio_diario: c.promedio_diario,
    dias_cobertura: c.dias_cobertura,
    estado: c.estado,
    desde: bounds.desde,
    hasta: bounds.hasta,
    dias: bounds.dias,
  };
}
