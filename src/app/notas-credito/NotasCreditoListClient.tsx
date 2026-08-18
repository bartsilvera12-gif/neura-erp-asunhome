"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getClientes } from "@/lib/clientes/storage";
import type { NotaCreditoGlobalListItemDTO } from "@/lib/nota-credito/types";

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] text-sm bg-white";
const labelClass = "block text-xs font-medium text-slate-500 mb-1";

function badgeErp(e: string) {
  const base = "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold";
  const m: Record<string, string> = {
    borrador: "bg-slate-100 text-slate-700",
    pendiente_envio_sifen: "bg-amber-100 text-amber-900",
    aprobada: "bg-emerald-100 text-emerald-900",
    rechazada: "bg-red-100 text-red-900",
    error: "bg-red-100 text-red-800",
    anulada_borrador: "bg-slate-200 text-slate-600 line-through",
  };
  return `${base} ${m[e] ?? "bg-slate-100 text-slate-700"}`;
}

function badgeSifen(e: string | null) {
  const base = "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold";
  if (e == null || e === "") return <span className="text-slate-400">—</span>;
  const m: Record<string, string> = {
    sin_envio: "bg-slate-100 text-slate-600",
    generado: "bg-sky-100 text-sky-900",
    firmado: "bg-indigo-100 text-indigo-900",
    enviado: "bg-blue-100 text-blue-900",
    en_proceso: "bg-violet-100 text-violet-900",
    aprobado: "bg-emerald-100 text-emerald-900",
    rechazado: "bg-red-100 text-red-900",
    error_envio: "bg-orange-100 text-orange-900",
    cancelado: "bg-slate-200 text-slate-600",
  };
  return <span className={`${base} ${m[e] ?? "bg-slate-100 text-slate-700"}`}>{e}</span>;
}

function formatGs(n: number, moneda: string) {
  return moneda === "USD" ? n.toLocaleString("en-US") : n.toLocaleString("es-PY");
}

const ERP_OPTS = [
  "borrador",
  "pendiente_envio_sifen",
  "aprobada",
  "rechazada",
  "error",
  "anulada_borrador",
] as const;

const SIFEN_OPTS = [
  "sin_envio",
  "generado",
  "firmado",
  "enviado",
  "en_proceso",
  "aprobado",
  "rechazado",
  "error_envio",
  "cancelado",
] as const;

export default function NotasCreditoListClient() {
  const [items, setItems] = useState<NotaCreditoGlobalListItemDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [estadoErp, setEstadoErp] = useState("");
  const [estadoSifen, setEstadoSifen] = useState("");
  const [usuarioId, setUsuarioId] = useState("");
  const [facturaId, setFacturaId] = useState("");
  const [buscar, setBuscar] = useState("");
  const [cdc, setCdc] = useState("");
  const [conError, setConError] = useState("");

  const limit = 50;

  useEffect(() => {
    getClientes().then((c) =>
      setClientes(
        c.map((x) => ({
          id: x.id,
          nombre: (x.empresa ?? x.nombre_contacto) || "—",
        }))
      )
    );
  }, []);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(limit));
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (clienteId) p.set("cliente_id", clienteId);
    if (estadoErp) p.set("estado_erp", estadoErp);
    if (estadoSifen) p.set("estado_sifen", estadoSifen);
    if (usuarioId.trim()) p.set("usuario_id", usuarioId.trim());
    if (facturaId.trim()) p.set("factura_id", facturaId.trim());
    if (buscar.trim()) p.set("buscar", buscar.trim());
    if (cdc.trim().length >= 8) p.set("cdc", cdc.trim());
    if (conError) p.set("con_error", conError);
    return p.toString();
  }, [page, desde, hasta, clienteId, estadoErp, estadoSifen, usuarioId, facturaId, buscar, cdc, conError]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/notas-credito?${queryString}`, { cache: "no-store" });
      const j = (await res.json()) as {
        success?: boolean;
        data?: { items: NotaCreditoGlobalListItemDTO[]; total: number };
        error?: string;
      };
      if (!res.ok || !j.success || !j.data) {
        setItems([]);
        setTotal(0);
        setErr(j.error ?? "No se pudo cargar");
        return;
      }
      setItems(j.data.items);
      setTotal(j.data.total);
    } catch {
      setItems([]);
      setTotal(0);
      setErr("Error de red");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Notas de crédito</h1>
        <p className="text-sm text-slate-500 mt-1">
          Auditoría operativa: listado global, estados ERP/SIFEN y vínculo a factura y cliente.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <div>
            <label className={labelClass}>Desde</label>
            <input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Hasta</label>
            <input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Cliente</label>
            <select className={inputClass} value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              <option value="">Todos</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Estado ERP</label>
            <select className={inputClass} value={estadoErp} onChange={(e) => setEstadoErp(e.target.value)}>
              <option value="">Todos</option>
              {ERP_OPTS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Estado SIFEN</label>
            <select className={inputClass} value={estadoSifen} onChange={(e) => setEstadoSifen(e.target.value)}>
              <option value="">Todos</option>
              {SIFEN_OPTS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Con error</label>
            <select className={inputClass} value={conError} onChange={(e) => setConError(e.target.value)}>
              <option value="">Indistinto</option>
              <option value="1">Con error</option>
              <option value="0">Sin error</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Usuario creador (UUID)</label>
            <input
              className={inputClass}
              placeholder="auth user id"
              value={usuarioId}
              onChange={(e) => setUsuarioId(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Factura (UUID)</label>
            <input className={inputClass} placeholder="factura_id" value={facturaId} onChange={(e) => setFacturaId(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Buscar en motivo</label>
            <input className={inputClass} placeholder="texto…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>CDC (≥ 8 caracteres)</label>
            <input className={inputClass} placeholder="44 dígitos o fragmento" value={cdc} onChange={(e) => setCdc(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPage(1)}
            className="px-4 py-2 rounded-lg bg-[#0EA5E9] text-white text-sm font-semibold hover:bg-sky-600"
          >
            Aplicar filtros
          </button>
          <button
            type="button"
            onClick={() => {
              setDesde("");
              setHasta("");
              setClienteId("");
              setEstadoErp("");
              setEstadoSifen("");
              setUsuarioId("");
              setFacturaId("");
              setBuscar("");
              setCdc("");
              setConError("");
              setPage(1);
            }}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"
          >
            Limpiar
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{err}</div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left min-w-[1100px]">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Fecha</th>
                <th className="px-3 py-2.5">Cliente</th>
                <th className="px-3 py-2.5">Factura</th>
                <th className="px-3 py-2.5 text-right">Monto</th>
                <th className="px-3 py-2.5">ERP</th>
                <th className="px-3 py-2.5">SIFEN</th>
                <th className="px-3 py-2.5">CDC</th>
                <th className="px-3 py-2.5">Usuario</th>
                <th className="px-3 py-2.5">Motivo</th>
                <th className="px-3 py-2.5">Error</th>
                <th className="px-3 py-2.5">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                    Cargando…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                    Sin resultados
                  </td>
                </tr>
              ) : (
                items.map((nc) => (
                  <tr key={nc.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                      {new Date(nc.created_at).toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="px-3 py-2 max-w-[160px]">
                      <Link href={`/clientes/${nc.cliente_id}`} className="text-[#0EA5E9] font-medium hover:underline truncate block">
                        {nc.cliente_display}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`/facturas/${nc.factura_id}`} className="text-[#0EA5E9] hover:underline">
                        {nc.factura_numero ?? nc.factura_id.slice(0, 8) + "…"}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {nc.moneda_snapshot === "USD" ? "USD" : "Gs."} {formatGs(nc.monto, nc.moneda_snapshot)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={badgeErp(nc.estado_erp)}>{nc.estado_erp}</span>
                    </td>
                    <td className="px-3 py-2">{badgeSifen(nc.estado_sifen)}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-600 max-w-[120px] truncate" title={nc.cdc ?? ""}>
                      {nc.cdc ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-[140px] truncate" title={nc.created_by_email_snapshot ?? ""}>
                      {nc.created_by_nombre_snapshot ?? nc.created_by_email_snapshot ?? "—"}
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate text-slate-700" title={nc.motivo}>
                      {nc.motivo}
                    </td>
                    <td className="px-3 py-2 max-w-[160px] truncate text-red-800 text-xs" title={nc.last_error_resumido ?? ""}>
                      {nc.last_error_resumido ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/notas-credito/${nc.id}`} className="text-[#0EA5E9] font-semibold text-xs hover:underline">
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > limit && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-600">
            <span>
              Página {page} — {total} registros
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page * limit >= total}
                className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
