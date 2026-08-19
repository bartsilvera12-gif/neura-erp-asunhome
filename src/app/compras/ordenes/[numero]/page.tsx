"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getOrdenCompra, cancelarOrdenCompra } from "@/lib/ordenes-compra/storage";
import type { OrdenCompra, EstadoOrdenCompra } from "@/lib/ordenes-compra/types";

function fmtGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function fmtFecha(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}
const IVA_LBL: Record<string, string> = { exenta: "Exenta", "5": "5%", "10": "10%" };
const ESTADO_BADGE: Record<EstadoOrdenCompra, string> = {
  pendiente: "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]",
  recibida_parcial: "bg-sky-100 text-sky-700",
  recibida_total: "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]",
  cancelada: "bg-slate-100 text-slate-500",
};
const ESTADO_LBL: Record<EstadoOrdenCompra, string> = {
  pendiente: "Pendiente",
  recibida_parcial: "Recibida parcial",
  recibida_total: "Recibida total",
  cancelada: "Cancelada",
};

export default function OrdenCompraDetallePage() {
  const params = useParams<{ numero: string }>();
  const numeroOc = decodeURIComponent(String(params.numero));

  const [lineas, setLineas] = useState<OrdenCompra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const l = await getOrdenCompra(numeroOc);
    setLineas(l);
    setCargando(false);
  }, [numeroOc]);
  useEffect(() => { cargar(); }, [cargar]);

  const cab = lineas[0];
  const total = useMemo(() => lineas.reduce((s, l) => s + l.total, 0), [lineas]);
  const subtotal = useMemo(() => lineas.reduce((s, l) => s + l.subtotal, 0), [lineas]);
  const totalIva = useMemo(() => lineas.reduce((s, l) => s + l.monto_iva, 0), [lineas]);
  const puedeRecibir = cab?.estado === "pendiente" || cab?.estado === "recibida_parcial";

  async function onCancelar() {
    if (!confirm("¿Cancelar esta orden de compra? No se podrá recibir después.")) return;
    const motivo = prompt("Motivo (opcional):") ?? null;
    setProcesando(true);
    setErr(null);
    const r = await cancelarOrdenCompra(numeroOc, motivo);
    setProcesando(false);
    if (!r.success) { setErr(r.error); return; }
    setMsg("Orden cancelada.");
    cargar();
  }

  if (cargando) return <p className="py-10 text-center text-slate-500 animate-pulse">Cargando…</p>;
  if (!cab) {
    return (
      <div className="space-y-4">
        <Link href="/compras/ordenes" className="text-sm text-slate-500 hover:text-[#3F8E91]">← Órdenes de compra</Link>
        <p className="text-slate-500">Orden de compra no encontrada.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/compras/ordenes" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-[#3F8E91]">
        ← Órdenes de compra
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold text-slate-900">{cab.numero_oc}</h1>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO_BADGE[cab.estado]}`}>
              {ESTADO_LBL[cab.estado]}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {cab.proveedor_nombre || "—"} · {fmtFecha(cab.fecha)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {cab.estado === "pendiente" && (
            <>
              <Link href={`/compras/ordenes/${encodeURIComponent(cab.numero_oc)}/editar`}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Editar
              </Link>
              <button onClick={onCancelar} disabled={procesando}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                Cancelar OC
              </button>
            </>
          )}
          {puedeRecibir && (
            <Link href={`/compras/desde-orden/${encodeURIComponent(cab.numero_oc)}`}
              className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-bold text-white shadow-sm shadow-[#4FAEB2]/30 hover:bg-[#3F8E91]">
              {cab.estado === "recibida_parcial" ? "Recibir el resto" : "Registrar compra (recibir)"}
            </Link>
          )}
        </div>
      </div>

      {msg && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}
      {err && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {(cab.estado === "recibida_parcial" || cab.estado === "recibida_total") && cab.compra_numero_control && (
        <p className="rounded-lg border border-[#4FAEB2]/30 bg-[#E5F4F4] px-3 py-2 text-sm text-[#3F8E91]">
          Última compra registrada: <span className="font-mono font-bold">{cab.compra_numero_control}</span>
          {cab.estado === "recibida_total" ? ` (recibida completa el ${fmtFecha(cab.recibida_at)})` : " — recepción parcial, puede haber más de una compra asociada."}{" "}
          <Link href="/compras" className="font-semibold underline">Ver en Compras</Link>
        </p>
      )}
      {cab.estado === "cancelada" && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Cancelada el {fmtFecha(cab.cancelada_at)}{cab.cancelada_motivo ? ` · ${cab.cancelada_motivo}` : ""}.
        </p>
      )}

      {/* Ítems */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="border-b-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
            <tr>
              {["Producto", "Pedida", "Recibida", "Pendiente", "Costo unit.", "IVA", "Subtotal", "Total"].map((h, i) => (
                <th key={h} className={`px-4 py-3 text-xs font-bold uppercase tracking-wide text-[#3F8E91] ${i === 0 ? "text-left" : i === 5 ? "text-center" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lineas.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{l.producto_nombre}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">{l.cantidad}</td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{l.cantidad_recibida}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-amber-700">{l.cantidad_pendiente}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">{fmtGs(l.costo_unitario)}</td>
                <td className="px-4 py-3 text-center text-slate-600">{IVA_LBL[l.iva_tipo] ?? l.iva_tipo}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">{fmtGs(l.subtotal)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">{fmtGs(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td colSpan={6} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Totales pedidos</td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-600">{fmtGs(subtotal)}</td>
              <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-900">{fmtGs(total)}</td>
            </tr>
            <tr>
              <td colSpan={8} className="px-4 py-2 text-right text-xs text-slate-500">IVA incluido: {fmtGs(totalIva)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
