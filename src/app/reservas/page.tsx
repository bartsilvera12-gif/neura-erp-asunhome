"use client";

/** Reservas / Mercadería en guarda — listado. */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Reserva = {
  id: string; numero_control: string | null; cliente_nombre: string | null; fecha: string | null;
  estado: string; total: number; pagado: number; saldo: number; items: number; entregados: number; pendientes: number;
};
const fmtGs = (n: number) => `Gs. ${Math.round(n || 0).toLocaleString("es-PY")}`;
const ESTADO: Record<string, string> = {
  activa: "bg-amber-100 text-amber-700", facturada: "bg-emerald-100 text-emerald-700", cancelada: "bg-slate-100 text-slate-500",
};
const ESTADO_LBL: Record<string, string> = { activa: "En guarda", facturada: "Facturada", cancelada: "Cancelada" };

export default function ReservasPage() {
  const [rows, setRows] = useState<Reserva[]>([]);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true); setErr(null);
    try {
      const r = await fetchWithSupabaseSession("/api/reservas", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? `Error ${r.status}`);
      setRows((j.data?.reservas ?? []) as Reserva[]);
    } catch (e) { setErr(e instanceof Error ? e.message : "Error"); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reservas / Mercadería en guarda</h1>
          <p className="mt-1 text-sm text-slate-500">Productos comprados que quedan en el local. Salen del stock y se retiran/facturan después.</p>
        </div>
        <Link href="/reservas/nueva" className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">Nueva reserva</Link>
      </div>

      {err && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">N°</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Cliente</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Fecha</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">Entrega</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Total</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Pagado</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Saldo</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr><td colSpan={9} className="py-10 text-center text-sm text-slate-400">{cargando ? "Cargando…" : "No hay reservas."}</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 font-mono font-medium text-slate-800">{r.numero_control}</td>
                  <td className="px-4 py-2.5 text-slate-700">{r.cliente_nombre ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{r.fecha ?? "—"}</td>
                  <td className="px-4 py-2.5 text-center text-slate-600">{r.entregados}/{r.items}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtGs(r.total)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{fmtGs(r.pagado)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{fmtGs(r.saldo)}</td>
                  <td className="px-4 py-2.5"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTADO[r.estado] ?? "bg-slate-100 text-slate-600"}`}>{ESTADO_LBL[r.estado] ?? r.estado}</span></td>
                  <td className="px-4 py-2.5 text-right"><Link href={`/reservas/${r.id}`} className="text-sm font-semibold text-[#3F8E91] hover:underline">Ver</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
