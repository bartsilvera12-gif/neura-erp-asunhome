"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { getExtractoCliente } from "@/lib/reportes/storage";
import { EMPRESA_DOC } from "@/lib/documentos/membrete";
import type { ExtractoCliente } from "@/lib/reportes/types";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatFecha(iso: string | null) {
  if (!iso) return "—";
  const s = String(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
const ESTADO_LBL: Record<string, string> = {
  pendiente: "Pendiente",
  parcial: "Parcial",
  pagada: "Pagada",
  vencida: "Vencida",
};
const METODO_LBL: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cheque: "Cheque",
};

export default function ExtractoClientePage() {
  const params = useParams<{ clienteId: string }>();
  const clienteId = params?.clienteId ?? "";
  const [data, setData] = useState<ExtractoCliente | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clienteId) return;
    let cancel = false;
    setCargando(true);
    getExtractoCliente(clienteId).then((d) => {
      if (cancel) return;
      if (!d) setError("No se pudo cargar el extracto.");
      setData(d);
      setCargando(false);
    });
    return () => { cancel = true; };
  }, [clienteId]);

  if (cargando) return <p className="py-10 text-center text-slate-500 animate-pulse">Cargando…</p>;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link href="/reportes/creditos" className="text-sm text-slate-500 hover:text-[#3F8E91]">← Créditos por cliente</Link>
        <p className="text-slate-500">{error ?? "Sin datos."}</p>
      </div>
    );
  }

  const { cliente, cuentas, cobros, totales } = data;

  return (
    <div className="space-y-6">
      {/* Barra de acciones (no se imprime) */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/reportes/creditos" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-[#3F8E91]">
          <ArrowLeft className="h-4 w-4" /> Créditos por cliente
        </Link>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#3F8E91]">
          <Printer className="h-4 w-4" /> Imprimir / Guardar PDF
        </button>
      </div>

      {/* Documento */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none">
        {/* Membrete */}
        <div className="mb-5 flex items-start justify-between gap-4 border-b-2 border-[#4FAEB2] pb-4">
          <div>
            <div className="text-lg font-bold text-slate-900">{EMPRESA_DOC.nombre}</div>
            {EMPRESA_DOC.telefono && <div className="text-xs text-slate-500">Tel: {EMPRESA_DOC.telefono}</div>}
            <div className="text-xs text-slate-500">{EMPRESA_DOC.direccion.join(" · ")}</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold uppercase tracking-wide text-[#3F8E91]">Extracto de crédito</div>
            <div className="text-xs text-slate-500">Emitido: {formatFecha(new Date().toISOString())}</div>
          </div>
        </div>

        {/* Cliente + resumen */}
        <div className="mb-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-3 text-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cliente</p>
            <p className="font-semibold text-slate-800">{cliente.nombre}</p>
            {cliente.ruc && <p className="text-xs text-slate-500">RUC/CI: {cliente.ruc}</p>}
            {cliente.telefono && <p className="text-xs text-slate-500">Tel: {cliente.telefono}</p>}
            {cliente.direccion && <p className="text-xs text-slate-500">{cliente.direccion}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Mini label="Total a crédito" value={formatGs(totales.total)} />
            <Mini label="Cobrado" value={formatGs(totales.cobrado)} tone="emerald" />
            <Mini label="Saldo pendiente" value={formatGs(totales.saldo)} tone="turquesa" />
            <Mini label="Vencido" value={formatGs(totales.vencido)} tone={totales.vencido > 0 ? "red" : undefined} />
          </div>
        </div>

        {/* Ventas a crédito */}
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-600">Ventas a crédito</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[10.5px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-bold">N° Venta</th>
                <th className="px-3 py-2 text-left font-bold">Fecha</th>
                <th className="px-3 py-2 text-left font-bold">Vencimiento</th>
                <th className="px-3 py-2 text-right font-bold">Total</th>
                <th className="px-3 py-2 text-right font-bold">Cobrado</th>
                <th className="px-3 py-2 text-right font-bold">Saldo</th>
                <th className="px-3 py-2 text-center font-bold">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cuentas.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{c.numero_venta || "—"}</td>
                  <td className="px-3 py-2 text-xs tabular-nums text-slate-600">{formatFecha(c.fecha_emision)}</td>
                  <td className="px-3 py-2 text-xs tabular-nums text-slate-600">
                    {formatFecha(c.fecha_vencimiento)}
                    {c.dias_vencido > 0 && <span className="ml-1 text-[10px] font-semibold text-red-600">({c.dias_vencido}d vencido)</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatGs(c.total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{formatGs(c.cobrado)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{formatGs(c.saldo)}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-600">{ESTADO_LBL[c.estado] ?? c.estado}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#4FAEB2]/40 bg-[#E5F4F4] font-bold text-[#3F8E91]">
                <td className="px-3 py-2 text-xs" colSpan={3}>Totales</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatGs(totales.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatGs(totales.cobrado)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatGs(totales.saldo)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Cobros */}
        {cobros.length > 0 && (
          <>
            <h2 className="mb-2 mt-6 text-xs font-bold uppercase tracking-wider text-slate-600">Cobros registrados</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-[10.5px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold">Fecha</th>
                    <th className="px-3 py-2 text-left font-bold">N° Venta</th>
                    <th className="px-3 py-2 text-left font-bold">Método</th>
                    <th className="px-3 py-2 text-left font-bold">Referencia</th>
                    <th className="px-3 py-2 text-right font-bold">Monto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cobros.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 text-xs tabular-nums text-slate-600">{formatFecha(p.fecha_pago)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{p.numero_venta || "—"}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{p.metodo_pago ? (METODO_LBL[p.metodo_pago] ?? p.metodo_pago) : "—"}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{p.referencia || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">{formatGs(p.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="mt-6 border-t border-dashed border-slate-300 pt-3 text-center text-[11px] text-slate-400">
          Documento de seguimiento interno. Los saldos reflejan el estado a la fecha de emisión de este extracto.
        </p>
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "turquesa" | "red" }) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "turquesa" ? "text-[#3F8E91]" : tone === "red" ? "text-red-600" : "text-slate-800";
  return (
    <div className="rounded-xl border border-slate-200 p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}
