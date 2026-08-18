import Link from "next/link";
import { Suspense } from "react";
import {
  fetchSorteoCuponesOrdenesServer,
  type SorteoEntradasListParams,
} from "@/lib/sorteos/server-queries";
import type { SorteoEntradaEstadoPago } from "@/lib/sorteos/types";
import SorteoCuponesEstadoPagoFilter from "@/components/sorteos/SorteoCuponesEstadoPagoFilter";
import SorteosCuponesManualClient from "@/components/sorteos/SorteosCuponesManualClient";
import SorteoCuponesPagoCell from "@/components/sorteos/SorteoCuponesPagoCell";
import SorteoCuponesImpresionCell from "@/components/sorteos/SorteoCuponesImpresionCell";

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

function formatFecha(iso: string) {
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

export default async function SorteoCuponesPage({
  searchParams,
}: {
  searchParams?: Sp | Promise<Sp>;
}) {
  const sp = await Promise.resolve(searchParams ?? {});
  const page = Math.max(1, parseInt(pickStr(sp, "page") ?? "1", 10) || 1);
  const q = pickStr(sp, "q")?.trim() || undefined;
  const sorteoId = pickStr(sp, "sorteo_id")?.trim() || undefined;
  const estadoRaw = pickStr(sp, "estado")?.trim();
  /** Cupones: solo estos tres estados en el filtro (sin `pendiente`). */
  const estadoPago: SorteoEntradaEstadoPago | undefined =
    estadoRaw === "pendiente_revision" || estadoRaw === "confirmado" || estadoRaw === "rechazado"
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
  } = await fetchSorteoCuponesOrdenesServer(listParams);

  const totalPages = Math.max(1, Math.ceil(total_count / limit));
  const qsBase = sp;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Cupones</h1>
          <p className="text-gray-500 text-sm mt-1">Órdenes con números de cupón generados</p>
        </div>
        <Suspense fallback={null}>
          <SorteosCuponesManualClient />
        </Suspense>
      </div>

      <nav className="flex flex-wrap gap-2 text-sm border-b border-slate-200 pb-3">
        <Link href="/sorteos" className="text-slate-600 hover:text-[#0EA5E9]">
          Sorteos
        </Link>
        <Link href="/sorteos/entradas" className="text-slate-600 hover:text-[#0EA5E9]">
          Entradas
        </Link>
        <span className="font-semibold text-[#0EA5E9]">Cupones</span>
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
        <SorteoCuponesEstadoPagoFilter />
        <button
          type="submit"
          className="bg-[#0EA5E9] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-sky-600"
        >
          Filtrar
        </button>
        <Link href="/sorteos/cupones" className="text-sm text-slate-600 underline py-2">
          Limpiar
        </Link>
      </form>

      {transient_error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          La base de datos está saturada momentáneamente. Reintentá en unos segundos o usá filtros.
        </div>
      ) : null}

      {queryError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Error al cargar cupones:</strong> {queryError}
        </div>
      ) : null}

      <div className="text-sm text-slate-600">
        Mostrando página {pageOut} de {totalPages} · {total_count} órdenes con cupón · hasta {limit} por página
      </div>

      <div className="flex flex-wrap gap-2 items-center text-sm">
        {pageOut > 1 ? (
          <Link
            href={`/sorteos/cupones${buildQuery(qsBase, { page: String(pageOut - 1) })}`}
            className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50"
          >
            ← Anterior
          </Link>
        ) : null}
        {pageOut < totalPages ? (
          <Link
            href={`/sorteos/cupones${buildQuery(qsBase, { page: String(pageOut + 1) })}`}
            className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50"
          >
            Siguiente →
          </Link>
        ) : null}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        {rows.length === 0 && !queryError ? (
          <div className="py-16 text-center text-gray-400 text-sm">No hay órdenes con cupones</div>
        ) : rows.length === 0 ? null : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1140px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Nº orden</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Sorteo</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Cliente</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Cédula</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Teléfono</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Cantidad</th>
                  <th className="text-right text-sm font-semibold text-slate-600 px-5 py-3">Monto</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Cupones</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Impresión</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Pago</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Fecha</th>
                  <th className="text-left text-sm font-semibold text-slate-600 px-5 py-3">Chat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => (
                  <tr key={r.entrada_id} className="hover:bg-slate-50/80">
                    <td className="px-5 py-3 text-sm font-mono font-semibold text-slate-800">{r.numero_orden}</td>
                    <td className="px-5 py-3 text-sm text-slate-800">{r.sorteo_nombre}</td>
                    <td className="px-5 py-3 text-sm text-slate-800">{r.nombre_participante}</td>
                    <td className="px-5 py-3 text-sm font-mono text-slate-600">{r.documento ?? "—"}</td>
                    <td className="px-5 py-3 text-sm font-mono text-slate-700">{r.whatsapp_numero}</td>
                    <td className="px-5 py-3 text-sm text-slate-800">{r.cantidad_boletos}</td>
                    <td className="px-5 py-3 text-sm text-right tabular-nums text-slate-800">
                      {formatGs(r.monto_total)}
                      {r.promo_nombre ? (
                        <div className="text-[11px] font-normal text-slate-500 mt-0.5">{r.promo_nombre}</div>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-sm font-mono text-slate-800">{r.numeros_cupon.join(", ")}</td>
                    <td className="px-5 py-3 text-sm">
                      <SorteoCuponesImpresionCell
                        sorteoId={r.sorteo_id}
                        entradaId={r.entrada_id}
                        cuponesImpresosAt={r.cupones_impresos_at}
                      />
                    </td>
                    <SorteoCuponesPagoCell entradaId={r.entrada_id} estadoPago={r.estado_pago} />
                    <td className="px-5 py-3 text-sm text-slate-600 whitespace-nowrap">{formatFecha(r.created_at)}</td>
                    <td className="px-5 py-3 text-sm">
                      {r.chat_conversation_id ? (
                        <Link
                          href={`/dashboard/conversaciones?conversationId=${encodeURIComponent(r.chat_conversation_id)}`}
                          className="text-[#0EA5E9] hover:underline"
                        >
                          Abrir
                        </Link>
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
