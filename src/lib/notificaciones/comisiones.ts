/**
 * Notificaciones de comisiones para Ferrecolor.
 *
 * Dos disparadores:
 *  - Cruce de tramo (A): al confirmar una venta, si el vendedor cruzó los umbrales
 *    de 20M o 35M de GANANCIA acumulada este mes.
 *  - Cierre mensual (B): el día 1 de cada mes, se registra un aviso con las
 *    comisiones totales del mes anterior por vendedor.
 *
 * Ambas insertan en la tabla `notificaciones` (misma que usa la campanita).
 * Dedupe: (empresa, tipo, mensaje) con ON CONFLICT DO NOTHING, para evitar spam.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

const UMBRALES = [20_000_000, 35_000_000];
const PORCENTAJES = [5, 7];
const TIPO_CRUCE = "comision_cruce_tramo";
const TIPO_MENSUAL = "comision_mensual";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

function pyMonthBounds(offsetMonths = 0): { desde: string; hasta: string; label: string } {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth() + offsetMonths;
  const first = new Date(anio, mes, 1);
  const last = new Date(anio, mes + 1, 0);
  const y = first.getFullYear();
  const m = String(first.getMonth() + 1).padStart(2, "0");
  const lastD = String(last.getDate()).padStart(2, "0");
  const label = first.toLocaleDateString("es-PY", { month: "long", year: "numeric" });
  return { desde: `${y}-${m}-01`, hasta: `${y}-${m}-${lastD}`, label };
}

/**
 * Devuelve la ganancia acumulada del mes actual por vendedor.
 * Ganancia = ventas.total - Σ(cantidad * costo_unitario) de movimientos SALIDA activos.
 */
async function gananciaPorVendedor(
  schema: string,
  empresaId: string,
  desde: string,
  hasta: string
): Promise<Map<string, number>> {
  const tV = quoteSchemaTable(schema, "ventas");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const { rows } = await pool().query<{ vendedor: string; ganancia: string }>(
    `SELECT COALESCE(v.usuario_nombre, 'Sin vendedor') AS vendedor,
            SUM(v.total - COALESCE(costos.costo, 0))::text AS ganancia
       FROM ${tV} v
       LEFT JOIN (
         SELECT venta_id, SUM(cantidad * costo_unitario) AS costo
           FROM ${tM}
          WHERE empresa_id = $1::uuid AND tipo = 'SALIDA' AND anulado_at IS NULL
          GROUP BY venta_id
       ) costos ON costos.venta_id = v.id
      WHERE v.empresa_id = $1::uuid
        AND v.estado NOT IN ('anulada', 'devuelta_total')
        AND v.fecha >= $2::date
        AND v.fecha < ($3::date + INTERVAL '1 day')
      GROUP BY v.usuario_nombre`,
    [empresaId, desde, hasta]
  );
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.vendedor, Number(r.ganancia) || 0);
  return m;
}

/**
 * (A) Evalúa cruces de tramo. Se llama después de crear una venta.
 * Compara la ganancia ANTES y DESPUÉS de la venta con los umbrales; si cruzó
 * uno, inserta una notificación (con dedupe por umbral+mes).
 */
export async function evaluarCruceTramoComision(
  schemaRaw: string,
  empresaId: string,
  vendedorNombre: string,
  ventaGanancia: number
): Promise<void> {
  if (ventaGanancia <= 0 || !vendedorNombre) return;
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const { desde, hasta, label } = pyMonthBounds(0);
  const totales = await gananciaPorVendedor(schema, empresaId, desde, hasta);
  const despues = totales.get(vendedorNombre) ?? ventaGanancia;
  const antes = despues - ventaGanancia;

  const t = quoteSchemaTable(schema, "notificaciones");
  for (let i = 0; i < UMBRALES.length; i++) {
    const umbral = UMBRALES[i];
    if (antes < umbral && despues >= umbral) {
      const titulo = `Comisión ${PORCENTAJES[i]}% desbloqueada`;
      const mensaje = `${vendedorNombre} superó ${new Intl.NumberFormat("es-PY").format(umbral)} de ganancia en ${label}. Ahora comisiona al ${PORCENTAJES[i]}%.`;
      await pool().query(
        `INSERT INTO ${t} (empresa_id, tipo, titulo, mensaje, url)
         VALUES ($1::uuid, $2, $3, $4, '/comisiones')
         ON CONFLICT DO NOTHING`,
        [empresaId, `${TIPO_CRUCE}_${umbral}_${desde}_${vendedorNombre}`.slice(0, 60), titulo, mensaje]
      );
    }
  }
}

/**
 * (B) Aviso mensual: el día 1 de cada mes crea (una vez) el resumen de
 * comisiones del mes anterior. Best-effort, se puede llamar desde el GET
 * de notificaciones (throttled a nivel proceso).
 */
const ultimaEvalMensual = new Map<string, number>();
const THROTTLE_MS = 60 * 60 * 1000; // 1h

export async function evaluarComisionesMensuales(schemaRaw: string, empresaId: string): Promise<void> {
  const ahora = Date.now();
  const last = ultimaEvalMensual.get(empresaId) ?? 0;
  if (ahora - last < THROTTLE_MS) return;
  ultimaEvalMensual.set(empresaId, ahora);

  const hoy = new Date();
  // Solo generar durante los primeros 5 dias del mes, para que se muestre
  // el resumen del mes recien terminado.
  if (hoy.getDate() > 5) return;

  const schema = assertAllowedChatDataSchema(schemaRaw);
  const { desde, hasta, label } = pyMonthBounds(-1);
  const totales = await gananciaPorVendedor(schema, empresaId, desde, hasta);
  if (totales.size === 0) return;

  let totalComision = 0;
  const lineas: string[] = [];
  for (const [vend, gan] of totales) {
    let pct = 0;
    if (gan >= UMBRALES[1]) pct = PORCENTAJES[1];
    else if (gan >= UMBRALES[0]) pct = PORCENTAJES[0];
    const com = Math.round((gan * pct) / 100);
    totalComision += com;
    if (com > 0) lineas.push(`${vend}: ${new Intl.NumberFormat("es-PY").format(com)}`);
  }
  if (totalComision <= 0) return;

  const titulo = `Comisiones ${label}`;
  const mensaje = `Total a pagar: Gs. ${new Intl.NumberFormat("es-PY").format(totalComision)}. ${lineas.join(" · ")}`;
  const t = quoteSchemaTable(schema, "notificaciones");
  await pool().query(
    `INSERT INTO ${t} (empresa_id, tipo, titulo, mensaje, url)
     VALUES ($1::uuid, $2, $3, $4, '/comisiones')
     ON CONFLICT DO NOTHING`,
    [empresaId, `${TIPO_MENSUAL}_${desde}`, titulo, mensaje]
  );
}
