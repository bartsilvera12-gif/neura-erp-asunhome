"use client";

/**
 * Comisiones (Ferrecolor) — se calculan sobre la GANANCIA acumulada del vendedor
 * en el período. Ganancia = precio_venta − costo_unitario_snapshot (movimientos_inventario).
 *
 * Escalas:
 *   - < 20.000.000 → 0%
 *   - 20M a 35M    → 5% de la ganancia total
 *   - ≥ 35M        → 7% de la ganancia total
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Fila = {
  vendedor: string;
  ventas: number;
  ingresos: number;
  costo: number;
  ganancia: number;
  tramo_desde: number;
  tramo_hasta: number | null;
  porcentaje: number;
  comision: number;
};

type Escala = { desde: number; hasta: number | null; porcentaje: number };

type Payload = {
  periodo: { desde: string; hasta: string };
  escalas: Escala[];
  por_vendedor: Fila[];
  totales: { ventas: number; ingresos: number; costo: number; ganancia: number; comision: number };
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

  const cargar = useCallback(async () => {
    setCargando(true);
    setErr(null);
    try {
      const r = await fetchWithSupabaseSession(
        `/api/comisiones/ferrecolor?desde=${rango.desde}&hasta=${rango.hasta}`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? `Error ${r.status}`);
      setData(j.data as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setCargando(false);
    }
  }, [rango]);

  useEffect(() => { void cargar(); }, [cargar]);

  const escalas = data?.escalas ?? [];
  const filas = data?.por_vendedor ?? [];
  const totales = data?.totales;

  const escalaLabel = useCallback((e: Escala) => {
    const desde = fmtGs(e.desde);
    const hasta = e.hasta === null ? "∞" : fmtGs(e.hasta);
    return `${desde} → ${hasta} · ${e.porcentaje}%`;
  }, []);

  const inputC = "rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30";

  const explicacion = useMemo(() => (
    <ul className="ml-4 mt-1 list-disc space-y-0.5 text-xs text-slate-500">
      {escalas.map((e, i) => (
        <li key={i}>{escalaLabel(e)}</li>
      ))}
    </ul>
  ), [escalas, escalaLabel]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Comisiones por vendedor</h1>
          <p className="mt-1 text-sm text-slate-500">Calculadas sobre la ganancia acumulada del período (precio venta − costo).</p>
          {escalas.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Escalas activas</p>
              {explicacion}
            </div>
          )}
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Ventas" value={String(totales.ventas)} />
          <StatCard label="Ingresos" value={fmtGs(totales.ingresos)} />
          <StatCard label="Ganancia total" value={fmtGs(totales.ganancia)} highlight />
          <StatCard label="Comisiones a pagar" value={fmtGs(totales.comision)} highlight />
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Vendedor</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Ventas</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Ingresos</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Costo</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Ganancia</th>
              <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">Tramo</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Comisión</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas.length === 0 ? (
              <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-400">{cargando ? "Calculando…" : "Sin ventas en el período."}</td></tr>
            ) : (
              filas.map((f) => (
                <tr key={f.vendedor} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-800">{f.vendedor}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{f.ventas}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmtGs(f.ingresos)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{fmtGs(f.costo)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">{fmtGs(f.ganancia)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${f.porcentaje === 0 ? "bg-slate-100 text-slate-600" : f.porcentaje >= 7 ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
                      {f.porcentaje}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-900">{fmtGs(f.comision)}</td>
                </tr>
              ))
            )}
          </tbody>
          {totales && filas.length > 0 && (
            <tfoot className="border-t border-slate-200 bg-slate-50">
              <tr>
                <td className="px-4 py-3 text-sm font-bold text-slate-700">Totales</td>
                <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-700">{totales.ventas}</td>
                <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-700">{fmtGs(totales.ingresos)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-500">{fmtGs(totales.costo)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-emerald-700">{fmtGs(totales.ganancia)}</td>
                <td />
                <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-900">{fmtGs(totales.comision)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
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
