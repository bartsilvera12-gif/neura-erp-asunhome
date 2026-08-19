"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, ArrowLeft, Loader2, Download, FileCheck2, Pencil } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ESTADO_LABEL, type EstadoPresupuesto } from "@/lib/presupuestos/types";

type Presu = {
  id: string;
  numero_control: string;
  cliente_nombre: string;
  cliente_ruc: string | null;
  cliente_telefono: string | null;
  cliente_direccion: string | null;
  estado: EstadoPresupuesto;
  moneda: string;
  subtotal: number | string;
  monto_iva: number | string;
  descuento_total: number | string;
  total: number | string;
  validez_dias: number | null;
  fecha: string;
  fecha_vencimiento: string | null;
  forma_pago: string | null;
  plazo_entrega: string | null;
  observaciones: string | null;
  convertido_pedido_id: string | null;
};
type ItemRow = {
  id: string;
  producto_nombre: string;
  sku: string | null;
  cantidad: number | string;
  unidad_medida: string | null;
  precio_unitario: number | string;
  iva_tipo: string;
  descuento: number | string;
  total: number | string;
};

const ESTADO_BADGE: Record<EstadoPresupuesto, string> = {
  creado: "bg-slate-100 text-slate-700",
  enviado: "bg-sky-100 text-sky-700",
  aprobado: "bg-emerald-100 text-emerald-700",
  rechazado: "bg-red-100 text-red-700",
  convertido: "bg-violet-100 text-violet-700",
};
// Transiciones permitidas desde la UI (no incluye 'convertido', que va por /convertir).
const SIGUIENTES: Record<EstadoPresupuesto, EstadoPresupuesto[]> = {
  creado: ["enviado", "aprobado", "rechazado"],
  enviado: ["aprobado", "rechazado"],
  aprobado: ["rechazado"],
  rechazado: ["creado", "enviado"],
  convertido: [],
};

function fmtGs(n: number | string, moneda: string) {
  const v = Number(n) || 0;
  return (moneda === "USD" ? "USD " : "Gs. ") + v.toLocaleString("es-PY", { maximumFractionDigits: moneda === "USD" ? 2 : 0 });
}
function fmtFecha(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function PresupuestoDetallePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [presu, setPresu] = useState<Presu | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/presupuestos/${id}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo cargar el presupuesto.");
        return;
      }
      setPresu(body.data.presupuesto as Presu);
      setItems((body.data.items ?? []) as ItemRow[]);
    } catch {
      setError("Error de red.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cambiarEstado(nuevo: EstadoPresupuesto) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/presupuestos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: nuevo }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo cambiar el estado.");
        return;
      }
      setPresu(body.data.presupuesto as Presu);
      setOk(`Estado actualizado a "${ESTADO_LABEL[nuevo]}".`);
      setTimeout(() => setOk(null), 2500);
    } catch {
      setError("Error de red al cambiar el estado.");
    } finally {
      setBusy(false);
    }
  }

  async function convertir() {
    if (busy) return;
    if (!confirm("¿Crear un pedido desde este presupuesto? No se descuenta stock ni se genera venta.")) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/presupuestos/${id}/convertir`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo crear el pedido.");
        return;
      }
      setOk("Pedido creado correctamente.");
      await cargar();
    } catch {
      setError("Error de red al crear el pedido.");
    } finally {
      setBusy(false);
    }
  }

  function abrirPdf() {
    window.open(`/api/presupuestos/${id}/pdf?auto=1`, "_blank", "noopener");
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>;
  }
  if (!presu) {
    return (
      <div className="p-6 space-y-3">
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error ?? "Presupuesto no encontrado"}</div>
        <Link href="/presupuestos" className="text-sm text-[#4FAEB2] hover:underline">Volver a presupuestos</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href="/presupuestos" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Volver a presupuestos
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileText className="h-7 w-7 text-[#4FAEB2]" />
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{presu.numero_control}</h1>
            <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_BADGE[presu.estado]}`}>
              {ESTADO_LABEL[presu.estado]}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={abrirPdf} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Download className="h-4 w-4" /> Descargar PDF
          </button>
          {presu.estado !== "convertido" && (
            <Link
              href={`/presupuestos/${presu.id}/editar`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              title="Editar productos, cliente y condiciones"
            >
              <Pencil className="h-4 w-4" /> Editar
            </Link>
          )}
          {presu.estado === "aprobado" && (
            <Link
              href={`/ventas/nueva?presupuesto_id=${presu.id}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white hover:bg-[#3F8E91]"
            >
              <FileCheck2 className="h-4 w-4" /> Cobrar en Caja
            </Link>
          )}
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
      {ok && <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">✓ {ok}</div>}

      {presu.estado === "convertido" && presu.convertido_pedido_id && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-violet-50 border border-violet-200 p-3 text-sm text-violet-800">
          <span>Este presupuesto ya fue convertido en pedido.</span>
          <Link
            href={`/dashboard/proyectos/${presu.convertido_pedido_id}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
          >
            <FileCheck2 className="h-3.5 w-3.5" /> Abrir pedido
          </Link>
        </div>
      )}

      {/* Estados */}
      {SIGUIENTES[presu.estado].length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Cambiar estado</h2>
          <div className="flex flex-wrap gap-2">
            {SIGUIENTES[presu.estado].map((s) => (
              <button key={s} onClick={() => cambiarEstado(s)} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Marcar como {ESTADO_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cliente + datos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Cliente</h3>
          <p className="font-semibold text-gray-800">{presu.cliente_nombre}</p>
          {presu.cliente_ruc && <p className="text-sm text-gray-600">RUC/CI: {presu.cliente_ruc}</p>}
          {presu.cliente_telefono && <p className="text-sm text-gray-600">Tel: {presu.cliente_telefono}</p>}
          {presu.cliente_direccion && <p className="text-sm text-gray-600">{presu.cliente_direccion}</p>}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Datos</h3>
          <p className="text-sm text-gray-600">Fecha: {fmtFecha(presu.fecha)}</p>
          {presu.validez_dias != null && <p className="text-sm text-gray-600">Validez: {presu.validez_dias} día(s){presu.fecha_vencimiento ? ` (vence ${fmtFecha(presu.fecha_vencimiento)})` : ""}</p>}
          {presu.forma_pago && <p className="text-sm text-gray-600">Forma de pago: {presu.forma_pago}</p>}
          {presu.plazo_entrega && <p className="text-sm text-gray-600">Plazo de entrega: {presu.plazo_entrega}</p>}
        </div>
      </div>

      {/* Items */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="py-3 px-4 text-left font-medium">Descripción</th>
                <th className="py-3 px-4 text-center font-medium">Cant.</th>
                <th className="py-3 px-4 text-right font-medium">Precio unit.</th>
                <th className="py-3 px-4 text-center font-medium">IVA</th>
                <th className="py-3 px-4 text-right font-medium">Desc.</th>
                <th className="py-3 px-4 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="py-2.5 px-4 text-gray-800">{it.producto_nombre}{it.sku ? <span className="text-gray-400 text-xs"> · {it.sku}</span> : null}</td>
                  <td className="py-2.5 px-4 text-center tabular-nums">{Number(it.cantidad).toLocaleString("es-PY")} {it.unidad_medida ?? ""}</td>
                  <td className="py-2.5 px-4 text-right tabular-nums">{fmtGs(it.precio_unitario, presu.moneda)}</td>
                  <td className="py-2.5 px-4 text-center">{it.iva_tipo}</td>
                  <td className="py-2.5 px-4 text-right tabular-nums">{Number(it.descuento) > 0 ? fmtGs(it.descuento, presu.moneda) : "—"}</td>
                  <td className="py-2.5 px-4 text-right tabular-nums font-medium">{fmtGs(it.total, presu.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 p-4">
          <div className="ml-auto w-full sm:w-72 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal (sin IVA)</span><span className="tabular-nums">{fmtGs(presu.subtotal, presu.moneda)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">IVA</span><span className="tabular-nums">{fmtGs(presu.monto_iva, presu.moneda)}</span></div>
            {Number(presu.descuento_total) > 0 && <div className="flex justify-between"><span className="text-gray-500">Descuentos</span><span className="tabular-nums">- {fmtGs(presu.descuento_total, presu.moneda)}</span></div>}
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-base"><span>Total</span><span className="tabular-nums text-[#4FAEB2]">{fmtGs(presu.total, presu.moneda)}</span></div>
          </div>
        </div>
      </div>

      {presu.observaciones && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Observaciones</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{presu.observaciones}</p>
        </div>
      )}
    </div>
  );
}
