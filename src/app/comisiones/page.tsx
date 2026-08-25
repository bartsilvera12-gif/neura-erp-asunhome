"use client";

/**
 * Comisiones por vendedor (modelo ASUNHOME).
 * Comisión = % fijo del TOTAL de ventas del vendedor en el período.
 * El % es editable por vendedor (se guarda en usuarios.porcentaje_comision).
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Fila = {
  vendedor_id: string;
  vendedor: string;
  porcentaje: number;
  cantidad_ventas: number;
  total_vendido: number;
  comision: number;
};

type Payload = {
  periodo: { desde: string; hasta: string };
  por_vendedor: Fila[];
  totales: { cantidad_ventas: number; total_vendido: number; comision: number };
};

function fmtGs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}
function ymdInicioFinMes(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, d.getMonth() + 1, 0).getDate();
  return { desde: `${y}-${m}-01`, hasta: `${y}-${m}-${String(last).padStart(2, "0")}` };
}

export default function ComisionesPage() {
  const [rango, setRango] = useState(() => ymdInicioFinMes(new Date()));
  const [data, setData] = useState<Payload | null>(null);
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // % editable por vendedor (buffer local antes de guardar).
  const [pctEdit, setPctEdit] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErr(null);
    try {
      const r = await fetchWithSupabaseSession(
        `/api/comisiones/reporte?desde=${rango.desde}&hasta=${rango.hasta}`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? `Error ${r.status}`);
      const payload = j.data as Payload;
      setData(payload);
      // Sincronizar el buffer de % con lo que vino.
      const buf: Record<string, string> = {};
      for (const f of payload.por_vendedor) buf[f.vendedor_id] = String(f.porcentaje);
      setPctEdit(buf);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setCargando(false);
    }
  }, [rango]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardarPct(vendedorId: string) {
    const pct = Number(pctEdit[vendedorId]);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setErr("El porcentaje debe estar entre 0 y 100.");
      return;
    }
    setGuardando(vendedorId);
    setErr(null);
    try {
      const r = await fetchWithSupabaseSession("/api/comisiones/vendedores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vendedorId, porcentaje_comision: pct }),
      });
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? `Error ${r.status}`);
      await cargar();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar el porcentaje.");
    } finally {
      setGuardando(null);
    }
  }

  const filas = data?.por_vendedor ?? [];
  const totales = data?.totales;
  const inputC = "rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Comisiones por vendedor</h1>
          <p className="mt-1 text-sm text-slate-500">Comisión = porcentaje del total de ventas del período. El % es editable por vendedor.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">Desde</label>
            <input type="date" value={rango.desde} onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))} className={inputC} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">Hasta</label>
            <input type="date" value={rango.hasta} onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))} className={inputC} />
          </div>
          <button onClick={() => setRango(ymdInicioFinMes(new Date()))} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Mes actual</button>
          <button onClick={() => void cargar()} disabled={cargando} className="inline-flex items-center gap-1 rounded-md bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>
      </div>

      {err && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {totales && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Ventas" value={String(totales.cantidad_ventas)} />
          <StatCard label="Total vendido" value={fmtGs(totales.total_vendido)} highlight />
          <StatCard label="Comisiones a pagar" value={fmtGs(totales.comision)} highlight />
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Vendedor</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Ventas</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Total vendido</th>
              <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">% Comisión</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Comisión</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas.length === 0 ? (
              <tr><td colSpan={5} className="py-10 text-center text-sm text-slate-400">{cargando ? "Calculando…" : "No hay vendedores cargados."}</td></tr>
            ) : (
              filas.map((f) => {
                const pctBuf = pctEdit[f.vendedor_id] ?? String(f.porcentaje);
                const cambiado = Number(pctBuf) !== f.porcentaje;
                return (
                  <tr key={f.vendedor_id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-800">{f.vendedor}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{f.cantidad_ventas}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmtGs(f.total_vendido)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <span className="relative inline-flex items-center">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            value={pctBuf}
                            onChange={(e) => setPctEdit((p) => ({ ...p, [f.vendedor_id]: e.target.value }))}
                            className="w-20 rounded-md border border-slate-300 py-1 pl-2 pr-5 text-right text-sm tabular-nums outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
                          />
                          <span className="pointer-events-none absolute right-1.5 text-xs text-slate-400">%</span>
                        </span>
                        {cambiado && (
                          <button
                            onClick={() => void guardarPct(f.vendedor_id)}
                            disabled={guardando === f.vendedor_id}
                            className="rounded-md bg-[#4FAEB2] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50"
                          >
                            {guardando === f.vendedor_id ? "…" : "Guardar"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-900">
                      {fmtGs(Math.round((f.total_vendido * Number(pctBuf || 0)) / 100))}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {totales && filas.length > 0 && (
            <tfoot className="border-t border-slate-200 bg-slate-50">
              <tr>
                <td className="px-4 py-3 text-sm font-bold text-slate-700">Totales</td>
                <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-700">{totales.cantidad_ventas}</td>
                <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-700">{fmtGs(totales.total_vendido)}</td>
                <td />
                <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-900">{fmtGs(totales.comision)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-slate-400">
        La comisión se calcula sobre el total de ventas activas (excluye anuladas y devueltas). Cambiar el % recalcula el reporte al guardar.
      </p>
    </div>
  );
}

function StatCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-[#4FAEB2]/30 bg-[#4FAEB2]/[0.06]" : "border-slate-200 bg-white"}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${highlight ? "text-[#3F8E91]" : "text-slate-800"}`}>{value}</p>
    </div>
  );
}
