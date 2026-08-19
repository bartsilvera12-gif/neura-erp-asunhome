"use client";

/** Historial de devoluciones de ventas. Sin el feature flag, la pantalla avisa y no lista nada. */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, Loader2, Printer } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type { Devolucion } from "@/lib/devoluciones/types";

function gs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}
function fechaHora(iso: string) {
  try {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return iso; }
}

export default function DevolucionesPage() {
  const [flagOn, setFlagOn] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Devolucion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Devolucion | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const f = await fetch("/api/devoluciones/flag", { cache: "no-store" }).then((r) => r.json());
      const on = f?.data?.enabled === true;
      setFlagOn(on);
      if (!on) return;
      const r = await fetchWithSupabaseSession("/api/devoluciones", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j?.success === false) { setError(j?.error ?? "No se pudo cargar el historial."); return; }
      setRows((j.data.devoluciones ?? []) as Devolucion[]);
    } catch { setError("Error de red."); }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function abrirDetalle(id: string) {
    const r = await fetchWithSupabaseSession(`/api/devoluciones/${id}`, { cache: "no-store" });
    const j = await r.json();
    if (r.ok && j?.success !== false) setDetalle(j.data.devolucion as Devolucion);
  }

  if (flagOn === false) {
    return (
      <div className="space-y-4">
        <Link href="/ventas" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Volver a ventas
        </Link>
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          El módulo de devoluciones no está habilitado.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/ventas" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
            <ArrowLeft className="h-4 w-4" /> Volver a ventas
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-900">
            <RotateCcw className="h-6 w-6 text-[#4FAEB2]" /> Devoluciones
          </h1>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {cargando ? (
          <p className="flex items-center gap-2 p-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">Todavía no hay devoluciones registradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-bold">N°</th>
                  <th className="px-4 py-3 text-left font-bold">Venta</th>
                  <th className="px-4 py-3 text-left font-bold">Fecha</th>
                  <th className="px-4 py-3 text-center font-bold">Tipo</th>
                  <th className="px-4 py-3 text-center font-bold">Resolución</th>
                  <th className="px-4 py-3 text-right font-bold">Monto</th>
                  <th className="px-4 py-3 text-left font-bold">Usuario</th>
                  <th className="px-4 py-3 text-center font-bold">Estado</th>
                  <th className="px-4 py-3 text-center font-bold">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">{d.numero_devolucion}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {d.venta_numero_control ?? "—"}
                      {d.cliente_nombre && <span className="block text-slate-400">{d.cliente_nombre}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-slate-600">{fechaHora(d.created_at)}</td>
                    <td className="px-4 py-3 text-center text-xs">
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${d.tipo === "total" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                        {d.tipo === "total" ? "Total" : "Parcial"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${d.resolucion === "cambio" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {d.resolucion === "cambio" ? "Cambio" : "Reembolso"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800">{gs(d.total_devuelto)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{d.usuario_nombre ?? "—"}</td>
                    <td className="px-4 py-3 text-center text-xs">
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${d.estado === "anulada" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {d.estado === "anulada" ? "Anulada" : "Confirmada"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => void abrirDetalle(d.id)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">Detalle</button>
                        <a href={`/api/devoluciones/${d.id}/comprobante`} target="_blank" rel="noopener"
                           className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                          <Printer className="h-3.5 w-3.5" /> Imprimir
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detalle */}
      {detalle && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm" onClick={() => setDetalle(null)}>
          <div className="my-8 w-full max-w-2xl rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{detalle.numero_devolucion}</h2>
                <p className="text-sm text-slate-500">Venta {detalle.venta_numero_control ?? "—"} · {fechaHora(detalle.created_at)}</p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${detalle.estado === "anulada" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                {detalle.estado === "anulada" ? "Anulada" : "Confirmada"}
              </span>
            </div>
            <div className="space-y-4 px-6 py-5 text-sm">
              {detalle.requiere_nota_credito && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  Esta devolución puede requerir una Nota de Crédito fiscal.
                </div>
              )}
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Productos devueltos</p>
                {(detalle.items ?? []).map((it) => (
                  <p key={it.id} className="text-slate-700">
                    {it.cantidad_devuelta}× {it.producto_nombre} — {gs(it.total_devuelto)}
                    <span className={`ml-1 text-xs ${it.condicion === "danado" ? "text-red-600" : "text-emerald-700"}`}>
                      ({it.condicion === "danado" ? "dañado, no volvió al stock" : it.reintegra_stock ? "volvió al stock" : "no volvió al stock"})
                    </span>
                  </p>
                ))}
              </div>
              {(detalle.cambios ?? []).length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Productos entregados</p>
                  {(detalle.cambios ?? []).map((c) => (
                    <p key={c.id} className="text-slate-700">{c.cantidad}× {c.producto_nombre} — {gs(c.total)}</p>
                  ))}
                </div>
              )}
              <div className="space-y-1 rounded-lg bg-slate-50 p-3">
                <div className="flex justify-between"><span className="text-slate-500">Total devuelto</span><span className="tabular-nums">{gs(detalle.total_devuelto)}</span></div>
                {detalle.resolucion === "cambio" && <div className="flex justify-between"><span className="text-slate-500">Total entregado</span><span className="tabular-nums">{gs(detalle.total_entregado)}</span></div>}
                <div className="flex justify-between border-t border-slate-200 pt-1 font-bold">
                  <span>{detalle.diferencia > 0 ? "Diferencia cobrada" : detalle.diferencia < 0 ? "Reembolso" : "Sin movimiento"}</span>
                  <span className="tabular-nums">{gs(Math.abs(detalle.diferencia))}{detalle.metodo_reembolso ? ` · ${detalle.metodo_reembolso}` : ""}</span>
                </div>
              </div>
              <p className="text-xs text-slate-500">Usuario: {detalle.usuario_nombre ?? "—"}{detalle.motivo ? ` · Motivo: ${detalle.motivo}` : ""}</p>
              {detalle.estado === "anulada" && detalle.anulada_motivo && (
                <p className="text-xs text-red-600">Anulada: {detalle.anulada_motivo}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <p className="mr-auto text-xs italic text-slate-400">Registro de solo lectura. Para revertir, anulá la venta desde el listado de ventas.</p>
              <button onClick={() => setDetalle(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
