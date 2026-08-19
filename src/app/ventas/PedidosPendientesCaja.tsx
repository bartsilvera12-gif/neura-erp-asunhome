"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PedidoPendiente = {
  id: string;
  titulo: string;
  cliente_nombre: string | null;
  total_estimado: number;
  origen: string;
  fecha: string | null;
  items: { producto_nombre: string; cantidad: number }[];
};

const ORIGEN_LABEL: Record<string, string> = {
  presupuesto: "Presupuesto",
  venta: "Venta",
  manual: "Manual",
};

function fmtGs(n: number) {
  return "Gs. " + Math.round(n || 0).toLocaleString("es-PY");
}
function fmtFecha(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function PedidosPendientesCaja() {
  const [pedidos, setPedidos] = useState<PedidoPendiente[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    fetch("/api/caja/pedidos-pendientes", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        if (j?.success && Array.isArray(j.data?.pedidos)) setPedidos(j.data.pedidos as PedidoPendiente[]);
      })
      .catch(() => {})
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);

  // Mientras carga, no ocupar espacio; si no hay pendientes, no mostrar la sección.
  if (loading || pedidos.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-amber-900">
          Pedidos pendientes de facturación
          <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-800">
            {pedidos.length}
          </span>
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="text-xs uppercase text-amber-700/80">
            <tr>
              <th className="py-2 pr-4 font-medium">Pedido</th>
              <th className="py-2 pr-4 font-medium">Cliente</th>
              <th className="py-2 pr-4 font-medium">Items</th>
              <th className="py-2 pr-4 font-medium text-right">Total estimado</th>
              <th className="py-2 pr-4 font-medium">Origen</th>
              <th className="py-2 pr-4 font-medium">Fecha</th>
              <th className="py-2 pr-2 font-medium text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {pedidos.map((p) => (
              <tr key={p.id} className="align-middle">
                <td className="py-2.5 pr-4 font-medium text-slate-800">{p.titulo || "Pedido"}</td>
                <td className="py-2.5 pr-4 text-slate-600">{p.cliente_nombre ?? "—"}</td>
                <td className="py-2.5 pr-4 text-slate-600">
                  {p.items.length === 0
                    ? "—"
                    : p.items.slice(0, 2).map((it) => `${it.cantidad}× ${it.producto_nombre}`).join(", ") +
                      (p.items.length > 2 ? ` +${p.items.length - 2}` : "")}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums font-semibold text-slate-800">{fmtGs(p.total_estimado)}</td>
                <td className="py-2.5 pr-4">
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                    {ORIGEN_LABEL[p.origen] ?? p.origen}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-slate-500">{fmtFecha(p.fecha)}</td>
                <td className="py-2.5 pr-2 text-right">
                  <Link
                    href={`/ventas/nueva?pedido_id=${p.id}`}
                    className="inline-flex items-center rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91]"
                  >
                    Facturar / Cobrar
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
