/**
 * `.in(columna, ids)` por tandas.
 *
 * PostgREST arma la URL con todos los ids del `.in(...)`. Con cientos de uuids la URL pasa los
 * ~8 KB que acepta el gateway y la consulta vuelve rechazada (414): la pantalla queda sin esos
 * datos (estado SIFEN, fecha de pago, ítems) sin avisar. Hasta el 1-oct-2026 una URL así además
 * cortaba la conexión con Cloudflare y daba 520 a otras peticiones.
 *
 * Uso:
 *   const { data, error } = await inPorTandas(ids, (tanda) =>
 *     supabase.from("pagos").select("factura_id, fecha_pago").eq("empresa_id", e).in("factura_id", tanda)
 *   );
 *
 * Con `paginado: true` la consulta recibe además el rango de filas y TIENE que aplicar
 * `.order(...)` y `.range(desde, hasta)`: sirve cuando una tanda puede devolver más de las
 * 1000 filas que entrega PostgREST por consulta.
 */

/** Ids por consulta: 100 uuids ≈ 4 KB de URL. NO subir sin medir (tope real ~8 KB). */
export const IN_TANDA = 100;
const TANDAS_EN_PARALELO = 6;
const PAGINA = 1000;

type RespuestaTanda = { data: unknown; error: { message: string } | null };

export type ResultadoTandas = { data: unknown[] | null; error: { message: string } | null };

export async function inPorTandas(
  ids: readonly string[],
  consulta: (tanda: string[], desde: number, hasta: number) => PromiseLike<RespuestaTanda>,
  opts: { tanda?: number; paginado?: boolean } = {}
): Promise<ResultadoTandas> {
  const tamano = opts.tanda ?? IN_TANDA;
  const tandas: string[][] = [];
  for (let i = 0; i < ids.length; i += tamano) tandas.push(ids.slice(i, i + tamano));

  const unaTanda = async (tanda: string[]): Promise<ResultadoTandas> => {
    const filas: unknown[] = [];
    for (let desde = 0; ; desde += PAGINA) {
      const r = await consulta(tanda, desde, desde + PAGINA - 1);
      if (r.error) return { data: null, error: r.error };
      const lote = Array.isArray(r.data) ? r.data : [];
      filas.push(...lote);
      if (!opts.paginado || lote.length < PAGINA) break;
    }
    return { data: filas, error: null };
  };

  const todo: unknown[] = [];
  for (let i = 0; i < tandas.length; i += TANDAS_EN_PARALELO) {
    const resultados = await Promise.all(tandas.slice(i, i + TANDAS_EN_PARALELO).map(unaTanda));
    for (const r of resultados) {
      if (r.error) return { data: null, error: r.error };
      todo.push(...(r.data ?? []));
    }
  }
  return { data: todo, error: null };
}
