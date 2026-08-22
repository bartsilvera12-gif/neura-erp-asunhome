/**
 * Módulo "En el técnico" (servicio_tecnico_ordenes).
 *
 * Dos orígenes en la misma tabla:
 *   'interno' → producto propio dañado de fábrica. Al mandarlo al técnico se
 *               resta del stock (movimiento SALIDA). Al volver reparado, si se
 *               reintegra, vuelve al stock (ENTRADA).
 *   'cliente' → equipo que trae un cliente a reparar (servicio).
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export type TecnicoOrigen = "interno" | "cliente";
export type TecnicoEstado =
  | "recibido" | "en_diagnostico" | "presupuestado" | "aprobado"
  | "en_reparacion" | "listo" | "entregado" | "rechazado" | "anulado";

export interface TecnicoRow {
  id: string;
  numero: string;
  origen: TecnicoOrigen;
  estado: TecnicoEstado;
  producto_id: string | null;
  producto_nombre: string | null;
  serie_id: string | null;
  numero_serie: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  equipo_descripcion: string | null;
  falla_reportada: string | null;
  diagnostico: string | null;
  tecnico_nombre: string | null;
  total: number | null;
  fecha_ingreso: string;
  fecha_entrega: string | null;
}

const SEL = `
  o.id, o.numero, o.origen, o.estado, o.producto_id, p.nombre AS producto_nombre,
  o.serie_id, o.numero_serie, o.cliente_id, coalesce(cl.nombre, o.cliente_nombre) AS cliente_nombre,
  o.equipo_descripcion, o.falla_reportada, o.diagnostico, o.tecnico_nombre,
  o.total, o.fecha_ingreso, o.fecha_entrega`;

function joins(schema: string): string {
  const t = (n: string) => quoteSchemaTable(schema, n);
  return `
    FROM ${t("servicio_tecnico_ordenes")} o
    LEFT JOIN ${t("productos")} p ON p.id = o.producto_id
    LEFT JOIN ${t("clientes")} cl ON cl.id = o.cliente_id`;
}

export async function listTecnico(
  schemaRaw: string,
  empresaId: string,
  opts: { origen?: TecnicoOrigen; estado?: TecnicoEstado; q?: string; activos?: boolean } = {}
): Promise<TecnicoRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const cond: string[] = ["o.empresa_id = $1::uuid"];
  const params: unknown[] = [empresaId];
  let i = 2;
  if (opts.origen) { cond.push(`o.origen = $${i}`); params.push(opts.origen); i++; }
  if (opts.estado) { cond.push(`o.estado = $${i}`); params.push(opts.estado); i++; }
  if (opts.activos) cond.push(`o.estado NOT IN ('entregado','rechazado','anulado')`);
  if (opts.q && opts.q.trim()) {
    cond.push(`(o.numero ILIKE $${i} OR p.nombre ILIKE $${i} OR o.numero_serie ILIKE $${i} OR o.cliente_nombre ILIKE $${i})`);
    params.push(`%${opts.q.trim()}%`); i++;
  }
  const { rows } = await pool().query<TecnicoRow>(
    `SELECT ${SEL} ${joins(schema)} WHERE ${cond.join(" AND ")} ORDER BY o.fecha_ingreso DESC LIMIT 500`,
    params
  );
  return rows;
}

async function siguienteNumero(schema: string, empresaId: string): Promise<string> {
  const t = quoteSchemaTable(schema, "servicio_tecnico_ordenes");
  const { rows } = await pool().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${t} WHERE empresa_id = $1::uuid`, [empresaId]
  );
  const n = Number(rows[0]?.n ?? 0) + 1;
  return `ST-${String(n).padStart(5, "0")}`;
}

export interface TecnicoInput {
  origen: TecnicoOrigen;
  producto_id?: string | null;
  serie_id?: string | null;
  numero_serie?: string | null;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  equipo_descripcion?: string | null;
  falla_reportada?: string | null;
}

/**
 * Crea la orden. Si es interna (producto propio dañado de fábrica) resta stock
 * con un movimiento SALIDA y, si tiene serie, la marca 'en_servicio'.
 */
export async function crearTecnico(
  schemaRaw: string,
  empresaId: string,
  input: TecnicoInput,
  usuario: { id?: string | null; nombre?: string | null }
): Promise<string> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "servicio_tecnico_ordenes");
  const numero = await siguienteNumero(schema, empresaId);

  const { rows } = await pool().query<{ id: string }>(
    `INSERT INTO ${t}
       (empresa_id, numero, origen, estado, producto_id, serie_id, numero_serie,
        cliente_id, cliente_nombre, equipo_descripcion, falla_reportada, created_by)
     VALUES ($1::uuid,$2,$3,'recibido',$4::uuid,$5::uuid,$6,$7::uuid,$8,$9,$10,$11::uuid)
     RETURNING id`,
    [empresaId, numero, input.origen, input.producto_id ?? null, input.serie_id ?? null,
     input.numero_serie ?? null, input.cliente_id ?? null, input.cliente_nombre ?? null,
     input.equipo_descripcion ?? null, input.falla_reportada ?? null, usuario.id ?? null]
  );
  const ordenId = rows[0].id;

  if (input.origen === "interno" && input.producto_id) {
    // Resta del stock: el producto dañado de fábrica sale del inventario.
    await ajustarStock(schema, empresaId, input.producto_id, -1, "servicio_tecnico",
      `Enviado al técnico ${numero}`, usuario, ordenId, input.serie_id ?? null, "en_servicio");
  }
  return ordenId;
}

/** Mueve stock y deja movimiento de inventario. delta -1 (sale) / +1 (vuelve). */
async function ajustarStock(
  schema: string,
  empresaId: string,
  productoId: string,
  delta: number,
  origen: string,
  referencia: string,
  usuario: { id?: string | null; nombre?: string | null },
  ordenId: string | null,
  serieId: string | null,
  serieEstado: string | null
): Promise<void> {
  const tProd = quoteSchemaTable(schema, "productos");
  const tMov = quoteSchemaTable(schema, "movimientos_inventario");
  try {
    const { rows } = await pool().query<{ nombre: string; sku: string; costo_promedio: number }>(
      `UPDATE ${tProd} SET stock_actual = greatest(0, stock_actual + $3), updated_at = now()
        WHERE id = $1::uuid AND empresa_id = $2::uuid
      RETURNING nombre, sku, costo_promedio`,
      [productoId, empresaId, delta]
    );
    const p = rows[0];
    if (!p) return;
    await pool().query(
      `INSERT INTO ${tMov}
         (empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad,
          costo_unitario, origen, referencia, orden_servicio_id, serie_id, usuario_nombre, created_by)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11::uuid,$12,$13::uuid)`,
      [empresaId, productoId, p.nombre, p.sku, delta < 0 ? "SALIDA" : "ENTRADA",
       Math.abs(delta), p.costo_promedio ?? 0, origen, referencia, ordenId, serieId,
       usuario.nombre ?? null, usuario.id ?? null]
    );
    if (serieId && serieEstado) {
      const tS = quoteSchemaTable(schema, "producto_series");
      await pool().query(
        `UPDATE ${tS} SET estado = $3, updated_at = now() WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        [serieId, empresaId, serieEstado]
      );
    }
  } catch (e) {
    console.error("[tecnico] ajustarStock:", e instanceof Error ? e.message : e);
  }
}

/**
 * Cambia el estado. Si una orden interna vuelve reparada y se reintegra,
 * el producto vuelve al stock.
 */
export async function actualizarTecnico(
  schemaRaw: string,
  empresaId: string,
  id: string,
  patch: { estado?: TecnicoEstado; diagnostico?: string | null; tecnico_nombre?: string | null; reintegrarStock?: boolean },
  usuario: { id?: string | null; nombre?: string | null }
): Promise<boolean> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "servicio_tecnico_ordenes");

  // Leer la orden para saber si es interna y su producto/serie.
  const { rows: cur } = await pool().query<{
    origen: string; producto_id: string | null; serie_id: string | null; numero: string; estado: string;
  }>(
    `SELECT origen, producto_id, serie_id, numero, estado FROM ${t}
      WHERE id = $1::uuid AND empresa_id = $2::uuid`,
    [id, empresaId]
  );
  const orden = cur[0];
  if (!orden) return false;

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const add = (c: string, v: unknown, cast = "") => { sets.push(`${c} = $${i}${cast}`); params.push(v); i++; };
  if (patch.estado !== undefined) add("estado", patch.estado);
  if (patch.diagnostico !== undefined) add("diagnostico", patch.diagnostico);
  if (patch.tecnico_nombre !== undefined) add("tecnico_nombre", patch.tecnico_nombre);
  if (patch.estado === "entregado") sets.push("fecha_entrega = now()");
  if (sets.length === 0) return false;
  sets.push("updated_at = now()");
  params.push(id, empresaId);
  const { rowCount } = await pool().query(
    `UPDATE ${t} SET ${sets.join(", ")} WHERE id = $${i}::uuid AND empresa_id = $${i + 1}::uuid`,
    params
  );
  if ((rowCount ?? 0) === 0) return false;

  // Interno marcado 'listo' + reintegrar → vuelve al stock (una sola vez).
  if (
    patch.estado === "listo" &&
    patch.reintegrarStock &&
    orden.origen === "interno" &&
    orden.producto_id &&
    orden.estado !== "listo"
  ) {
    await ajustarStock(schema, empresaId, orden.producto_id, +1, "servicio_tecnico",
      `Volvió del técnico ${orden.numero}`, usuario, id, orden.serie_id, "en_stock");
  }
  return true;
}
