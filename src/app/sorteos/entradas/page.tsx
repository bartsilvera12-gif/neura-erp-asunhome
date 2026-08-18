import Link from "next/link";
import {
  fetchSorteoEntradasServer,
  type SorteoEntradasListParams,
} from "@/lib/sorteos/server-queries";
import type { SorteoEntradaEstadoPago } from "@/lib/sorteos/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Sp = Record<string, string | string[] | undefined>;

function pickStr(sp: Sp, key: string): string | undefined {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return undefined;
}

function buildQuery(
  sp: Sp,
  patch: Record<string, string | null | undefined>
): string {
  const p = new URLSearchParams();
  const base: Record<string, string | undefined> = {
    page: pickStr(sp, "page"),
    q: pickStr(sp, "q"),
    sorteo_id: pickStr(sp, "sorteo_id"),
    estado: pickStr(sp, "estado"),
  };
  for (const [k, v] of Object.entries({ ...base, ...patch })) {
    if (v && v.length > 0) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function formatGs(n: number) {
  return `${n.toLocaleString("es-PY")} ₲`;
}

function formatFecha(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-PY", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function estadoPagoLabel(e: string) {
  if (e === "pendiente_revision") return "Pendiente revisión";
  if (e === "pendiente") return "Pendiente";
  if (e === "confirmado") return "Confirmado";
  if (e === "rechazado") return "Rechazado";
  return e;
}

function precioFuenteLabel(v: string | null | undefined) {
  if (v === "promo") return "Promo";
  if (v === "lista") return "Lista";
  return "—";
}

export default async function SorteoEntradasPage({
  searchParams,
}: {
  searchParams?: Sp | Promise<Sp>;
}) {
  const sp = await Promise.resolve(searchParams ?? {});
  const page = Math.max(1, parseInt(pickStr(sp, "page") ?? "1", 10) || 1);
  const q = pickStr(sp, "q")?.trim() || undefined;
  const sorteoId = pickStr(sp, "sorteo_id")?.trim() || undefined;
  const estadoRaw = pickStr(sp, "estado")?.trim();
  const estadoPago: SorteoEntradaEstadoPago | undefined =
    estadoRaw === "pendiente" ||
    estadoRaw === "pendiente_revision" ||
    estadoRaw === "confirmado" ||
    estadoRaw === "rechazado"
      ? estadoRaw
      : undefined;

  const listParams: SorteoEntradasListParams = {
    page,
    limit: 50,
    q: q ?? null,
    sorteoId: sorteoId ?? null,
    estadoPago: estadoPago ?? null,
  };

  const {
    data: rows,
    error: queryError,
    total_count,
    page: pageOut,
    limit,
    transient_error,
  } = await fetchSorteoEntradasServer(listParams);

  const totalPages = Math.max(1, Math.ceil(total_count / limit));
  const qsBase = sp;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-800">Entradas</h1>
        <p className="text-gray-500 text-sm mt-1">Compras registradas por participante</p>
      </div>

      <nav className="flex flex-wrap gap-2 text-sm border-b border-slate-200 pb-3">
        <Link href="/sorteos" className="text-slate-600 hover:text-[#0EA5E9]">
          Sorteos
        </Link>
        <span className="font-semibold text-[#0EA5E9]">Entradas</span>
        <Link href="/sorteos/cupones" className="text-slate-600 hover:text-[#0EA5E9]">
          Cupones
        </Link>
      </nav>

      <form method="get" className="flex flex-wrap gap-2 items-end bg-slate-50 border border-slate-200 rounded-lg p-4">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Buscar
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Nombre, doc, teléfono…"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm w-[220px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Sorteo (UUID)
          <input
            name="sorteo_id"
            defaultValue={sorteoId ?? ""}
            placeholder="opcional"
            className="border border-slate-300 rounded px-2 py-1.5 text-sm font-mono w-[260px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Estado pago
          <select
            name="estado"
            defaultValue={estadoRaw ?? ""}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm"
          >
            <option value="">Todos</option>
            <option value="pendiente_revision">Pendiente revisión</option>
            <option value="pendiente">Pendiente</option>
            <option value="confirmado">Confirmado</option>
            <option value="rechazado">Rechazado</option>
          </select>
        </label>
        <button
          type="submit"
          className="bg-[#0EA5E9] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-sky-600"
        >
          Filtrar
        </button>
        <Link
          href="/sorteos/entradas"
          className="text-sm text-slate-600 underline py-2"
        >
          Limpiar
        </Link>
      </form>

      {transient_error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          La base de datos está saturada momentáneamente. Reintentá en unos segundos o usá filtros para reducir resultados.
        </div>
      ) : null}

      {queryError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Error al cargar entradas:</strong> {queryError}
        </div>
      ) : null}

      <div className="text-sm text-slate-600">
        Mostrando página {pageOut} de {totalPages} · {total_count} entradas en total · hasta {limit} por página
      </div>

      <div className="flex flex-wrap gap-2 items-center text-sm">
        {pageOut > 1 ? (
          <Link
            href={`/sorteos/entradas${buildQuery(qsBase, { page: String(pageOut - 1) })}`}
            className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50"
          >
            ← Anterior
          </Link>
        ) : null}
        {pageOut < totalPages ? (
          <Link
            href={`/sorteos/entradas${buildQuery(qsBase, { page: String(pageOut + 1) })}`}
            className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50"
          >
            Siguiente →
          </Link>
        ) : null}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        {rows.length === 0 && !queryError ? (
          <div className="py-16 text-center text-gray-400 text-sm">No hay entradas</div>
        ) : rows.length === 0 ? null : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Nº orden</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Sorteo</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Participante</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Documento</th>
                  <th className="text-right text-sm font-semibold text-slate-600 px-5 py-3">Cant.</th>
                  <th className="text-right text-sm font-semibold text-slate-600 px-5 py-3">Monto</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3 min-w-[140px]">
                    Promo / fuente
                  </th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Pago</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Fecha pago</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Validado</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Creado</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Comprobante</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="px-5 py-3 text-sm font-mono font-semibold text-slate-800">
                      {typeof r.numero_orden === "number" ? r.numero_orden : "—"}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-800">
                      {(r.sorteos as { nombre?: string } | undefined)?.nombre ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-sm">{r.nombre_participante}</td>
                    <td className="px-5 py-3 text-sm font-mono text-slate-600">{r.documento ?? "—"}</td>
                    <td className="px-5 py-3 text-sm text-right tabular-nums">{r.cantidad_boletos}</td>
                    <td className="px-5 py-3 text-sm text-right tabular-nums">{formatGs(r.monto_total)}</td>
                    <td className="px-5 py-3 text-sm">
                      <div className="text-xs font-medium text-slate-700">
                        {precioFuenteLabel(r.precio_fuente ?? null)}
                      </div>
                      {r.promo_nombre ? (
                        <div className="text-xs text-slate-500 mt-0.5 leading-snug">{r.promo_nombre}</div>
                      ) : null}
                      {typeof r.precio_regular_referencia === "number" &&
                      r.precio_regular_referencia > 0 &&
                      r.precio_fuente === "promo" ? (
                        <div className="text-[11px] text-slate-400 mt-0.5 line-through tabular-nums">
                          Ref. lista {formatGs(r.precio_regular_referencia)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-sm">{estadoPagoLabel(r.estado_pago)}</td>
                    <td className="px-5 py-3 text-sm whitespace-nowrap">{formatFecha(r.fecha_pago)}</td>
                    <td className="px-5 py-3 text-sm">{r.validado_por ?? "—"}</td>
                    <td className="px-5 py-3 text-sm whitespace-nowrap">{formatFecha(r.created_at)}</td>
                    <td className="px-5 py-3 text-sm">
                      {r.comprobante_url?.trim() ? (
                        <a
                          href={r.comprobante_url.trim()}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#0EA5E9] hover:underline font-medium"
                        >
                          Abrir
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
