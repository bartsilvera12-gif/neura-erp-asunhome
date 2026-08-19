"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import { getCreditosReporte } from "@/lib/reportes/storage";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import type { CreditosReporte, AgingBucket } from "@/lib/reportes/types";

const AGING_OPCIONES: { value: AgingBucket; label: string }[] = [
  { value: "todos", label: "Toda la antigüedad" },
  { value: "por_vencer", label: "Por vencer" },
  { value: "d_1_30", label: "Vencido 1–30 días" },
  { value: "d_31_60", label: "Vencido 31–60 días" },
  { value: "d_61_90", label: "Vencido 61–90 días" },
  { value: "d_90_mas", label: "Vencido +90 días" },
];
const AGING_CAMPO: Record<Exclude<AgingBucket, "todos">, keyof CreditosReporte["clientes"][number]> = {
  por_vencer: "por_vencer",
  d_1_30: "vencido_1_30",
  d_31_60: "vencido_31_60",
  d_61_90: "vencido_61_90",
  d_90_mas: "vencido_90_mas",
};

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatFecha(iso: string | null) {
  if (!iso) return "—";
  const s = String(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

export default function CreditosReportePage() {
  const [data, setData] = useState<CreditosReporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [soloConSaldo, setSoloConSaldo] = useState(true);
  const [aging, setAging] = useState<AgingBucket>("todos");

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    getCreditosReporte().then((d) => { if (!cancel) { setData(d); setCargando(false); } });
    return () => { cancel = true; };
  }, []);

  const t = data?.totales;

  const filtrados = useMemo(() => {
    if (!data) return [];
    return data.clientes.filter((c) => {
      if (soloConSaldo && c.saldo <= 0) return false;
      if (aging !== "todos" && Number(c[AGING_CAMPO[aging]]) <= 0) return false;
      return productoMatchesQuery(busqueda, c.cliente_nombre, c.cliente_ruc);
    });
  }, [data, busqueda, soloConSaldo, aging]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Créditos por cliente"
        description="Ventas a crédito y saldos por cliente. Abrí el extracto de cada uno para seguimiento."
        backHref="/reportes"
        backLabel="Reportes"
        actions={<ExportExcelButton url="/api/reportes/creditos/export" />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard compact accent label="Saldo pendiente total" value={t ? formatGs(t.saldo_pendiente) : "—"} hint={t ? `${t.clientes_con_saldo} cliente(s) con deuda` : ""} />
        <StatCard compact label="Vencido" value={t ? formatGs(t.monto_vencido) : "—"} hint="saldo con cuota vencida" />
        <StatCard compact label="Total a crédito" value={t ? formatGs(t.total_credito) : "—"} hint={t ? `${t.ventas_credito} venta(s) a crédito` : ""} />
        <StatCard compact label="Cobrado" value={t ? formatGs(t.total_cobrado) : "—"} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Buscar cliente por nombre o RUC…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30 sm:min-w-72"
        />
        <select value={aging} onChange={(e) => setAging(e.target.value as AgingBucket)}
          className="w-52 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30">
          {AGING_OPCIONES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={soloConSaldo} onChange={(e) => setSoloConSaldo(e.target.checked)} />
          Solo con saldo pendiente
        </label>
      </div>

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500 shadow-sm">No se pudo cargar el reporte.</div>
      ) : (
        <div className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10">
          {filtrados.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              {soloConSaldo ? "No hay clientes con saldo de crédito pendiente." : "No hay clientes con ventas a crédito."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="border-b-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
                  <tr>
                    {["Cliente", "RUC / CI", "Ventas", "Total", "Cobrado", "Saldo", "Vencido", "Próx. venc.", ""].map((h, i) => (
                      <th key={h} className={`px-3 py-3 text-xs font-bold uppercase tracking-wide text-[#3F8E91] ${i >= 2 && i <= 6 ? "text-right" : i === 7 || i === 8 ? "text-center" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtrados.map((c) => (
                    <tr key={c.cliente_id} className="transition-colors hover:bg-[#4FAEB2]/5">
                      <td className="px-3 py-2.5 text-xs font-medium text-slate-800">{c.cliente_nombre}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{c.cliente_ruc || "—"}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{c.ventas_credito}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{formatGs(c.total)}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-emerald-700">{formatGs(c.cobrado)}</td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums font-bold text-slate-900">{formatGs(c.saldo)}</td>
                      <td className={`px-3 py-2.5 text-right text-xs tabular-nums font-semibold ${c.vencido > 0 ? "text-red-600" : "text-slate-400"}`}>
                        {c.vencido > 0 ? formatGs(c.vencido) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs tabular-nums text-slate-600">{formatFecha(c.proximo_vencimiento)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <Link href={`/reportes/creditos/${encodeURIComponent(c.cliente_id)}`} className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#3F8E91]">Ver extracto</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
