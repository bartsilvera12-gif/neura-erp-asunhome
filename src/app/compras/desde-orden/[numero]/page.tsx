"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getOrdenCompra, confirmarRecepcionOrdenCompra, type ExcedenteDetalle } from "@/lib/ordenes-compra/storage";
import { uploadComprobante } from "@/lib/compras/storage";
import type { OrdenCompra } from "@/lib/ordenes-compra/types";

function fmtGs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}
function fmtFecha(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}
const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30";
const labelClass = "mb-1 block text-xs font-semibold text-slate-600";

interface RecepcionLinea {
  llego: boolean;
  cantidad: string;      // texto del input "cantidad recibida ahora"
  observacion: string;
}

export default function DesdeOrdenRecepcionPage() {
  const params = useParams<{ numero: string }>();
  const router = useRouter();
  const numeroOc = decodeURIComponent(String(params.numero));

  const [lineas, setLineas] = useState<OrdenCompra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [recepcion, setRecepcion] = useState<Record<string, RecepcionLinea>>({});

  const [numeroFactura, setNumeroFactura] = useState("");
  const [nroTimbrado, setNroTimbrado] = useState("");
  const [fechaFactura, setFechaFactura] = useState("");
  const [tipoPago, setTipoPago] = useState<"contado" | "credito">("contado");
  const [plazoDias, setPlazoDias] = useState("");
  const [observacionCompra, setObservacionCompra] = useState("");
  const [comprobanteFile, setComprobanteFile] = useState<File | null>(null);

  const [procesando, setProcesando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [excedentes, setExcedentes] = useState<ExcedenteDetalle[] | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const l = await getOrdenCompra(numeroOc);
    setLineas(l);
    // Por defecto: precargar como "llegó completo" lo pendiente de cada línea.
    const init: Record<string, RecepcionLinea> = {};
    for (const linea of l) {
      init[linea.id] = {
        llego: linea.cantidad_pendiente > 0,
        cantidad: linea.cantidad_pendiente > 0 ? String(linea.cantidad_pendiente) : "0",
        observacion: "",
      };
    }
    setRecepcion(init);
    setCargando(false);
  }, [numeroOc]);
  useEffect(() => { cargar(); }, [cargar]);

  const cab = lineas[0];
  const lineasConPendiente = useMemo(() => lineas.filter((l) => l.cantidad_pendiente > 0), [lineas]);

  const totalPedido = useMemo(() => lineas.reduce((s, l) => s + l.total, 0), [lineas]);
  const totalRecibidoAhora = useMemo(() => {
    return lineas.reduce((s, l) => {
      const r = recepcion[l.id];
      const cant = r?.llego ? Number(r.cantidad) || 0 : 0;
      return s + cant * l.costo_unitario;
    }, 0);
  }, [lineas, recepcion]);

  function setLinea(id: string, patch: Partial<RecepcionLinea>) {
    setRecepcion((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function toggleLlego(l: OrdenCompra) {
    setRecepcion((prev) => {
      const actual = prev[l.id];
      const llego = !actual.llego;
      return {
        ...prev,
        [l.id]: { ...actual, llego, cantidad: llego ? String(l.cantidad_pendiente) : "0" },
      };
    });
  }

  async function enviar(permitirExcedente: boolean) {
    setErr(null);
    if (!numeroFactura.trim()) { setErr("Ingresá el N° de factura."); return; }
    if (!nroTimbrado.trim()) { setErr("Ingresá el N° de timbrado."); return; }

    const items = lineasConPendiente
      .map((l) => {
        const r = recepcion[l.id];
        const cantidad = r?.llego ? Number(r.cantidad) || 0 : 0;
        return { orden_item_id: l.id, cantidad_recibida: cantidad, observacion: r?.observacion || null };
      })
      .filter((it) => it.cantidad_recibida > 0);

    if (items.length === 0) {
      setErr("Marcá al menos un producto como recibido para confirmar la compra.");
      return;
    }
    for (const l of lineasConPendiente) {
      const r = recepcion[l.id];
      const cantidad = r?.llego ? Number(r.cantidad) || 0 : 0;
      if (cantidad < 0) { setErr(`${l.producto_nombre}: la cantidad recibida no puede ser negativa.`); return; }
    }

    setProcesando(true);
    try {
      let comp: { comprobante_storage_path: string; comprobante_nombre: string; comprobante_mime_type: string } | null = null;
      if (comprobanteFile) {
        const up = await uploadComprobante(comprobanteFile);
        if (!up.ok) { setErr(`Comprobante: ${up.error}`); setProcesando(false); return; }
        comp = up.data;
      }
      const r = await confirmarRecepcionOrdenCompra(numeroOc, {
        numero_factura: numeroFactura,
        nro_timbrado: nroTimbrado,
        fecha_factura: fechaFactura || null,
        observacion: observacionCompra || null,
        tipo_pago: tipoPago,
        plazo_dias: tipoPago === "credito" && plazoDias ? parseInt(plazoDias, 10) : undefined,
        comprobante_storage_path: comp?.comprobante_storage_path ?? null,
        comprobante_nombre: comp?.comprobante_nombre ?? null,
        comprobante_mime_type: comp?.comprobante_mime_type ?? null,
        items,
        permitir_excedente: permitirExcedente,
      });
      if (!r.success) {
        if (r.excedentes && r.excedentes.length > 0 && !permitirExcedente) {
          setExcedentes(r.excedentes);
          setProcesando(false);
          return;
        }
        setErr(r.error);
        setProcesando(false);
        return;
      }
      if (r.warning) alert(r.warning);
      router.push(`/compras/ordenes/${encodeURIComponent(numeroOc)}`);
    } finally {
      setProcesando(false);
    }
  }

  if (cargando) return <p className="py-10 text-center text-slate-500 animate-pulse">Cargando…</p>;
  if (!cab) {
    return (
      <div className="space-y-4">
        <Link href="/compras/desde-orden" className="text-sm text-slate-500 hover:text-[#3F8E91]">← Desde Orden de Compra</Link>
        <p className="text-slate-500">Orden de compra no encontrada.</p>
      </div>
    );
  }
  if (cab.estado === "cancelada" || cab.estado === "recibida_total") {
    return (
      <div className="space-y-4">
        <Link href="/compras/desde-orden" className="text-sm text-slate-500 hover:text-[#3F8E91]">← Desde Orden de Compra</Link>
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Esta orden ya no tiene nada pendiente de recibir ({cab.estado === "cancelada" ? "cancelada" : "recibida por completo"}).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/compras/desde-orden" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-[#3F8E91]">
        ← Desde Orden de Compra
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold text-slate-900">{cab.numero_oc}</h1>
            <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-700">
              {cab.estado === "pendiente" ? "Pendiente" : "Recibida parcial"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {cab.proveedor_nombre || "—"} · Pedida el {fmtFecha(cab.fecha)}
          </p>
        </div>
        {cab.estado === "pendiente" && (
          <Link
            href={`/compras/ordenes/${encodeURIComponent(cab.numero_oc)}/editar`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            title="Editar productos, cantidades o costos de esta OC"
          >
            Editar OC
          </Link>
        )}
      </div>

      {err && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {/* Tabla de recepción producto por producto */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
            <tr>
              {["Llegó", "Producto", "Pedida", "Ya recibida", "Pendiente", "Recibida ahora", "Precio", "Subtotal recibido", "Observación"].map((h, i) => (
                <th key={h} className={`px-3 py-3 text-xs font-bold uppercase tracking-wide text-[#3F8E91] ${i <= 1 ? "text-left" : i === 8 ? "text-left" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lineas.map((l) => {
              const yaCompleta = l.cantidad_pendiente <= 0;
              const r = recepcion[l.id] ?? { llego: false, cantidad: "0", observacion: "" };
              const cantidadAhora = r.llego ? Number(r.cantidad) || 0 : 0;
              const excede = cantidadAhora > l.cantidad_pendiente;
              return (
                <tr key={l.id} className={yaCompleta ? "bg-slate-50/60 opacity-60" : ""}>
                  <td className="px-3 py-2.5">
                    {!yaCompleta && (
                      <button
                        type="button"
                        onClick={() => toggleLlego(l)}
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                          r.llego ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {r.llego ? "Sí" : "No"}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-slate-900">{l.producto_nombre}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{l.cantidad}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{l.cantidad_recibida}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-amber-700">{l.cantidad_pendiente}</td>
                  <td className="px-3 py-2.5 text-right">
                    {yaCompleta ? (
                      <span className="text-xs text-slate-400">completo</span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        step="any"
                        disabled={!r.llego}
                        value={r.cantidad}
                        onChange={(e) => setLinea(l.id, { cantidad: e.target.value })}
                        className={`w-24 rounded-lg border px-2 py-1.5 text-right text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30 disabled:bg-slate-100 disabled:text-slate-400 ${excede ? "border-amber-400" : "border-slate-200"}`}
                      />
                    )}
                    {excede && <p className="mt-0.5 text-[10px] font-semibold text-amber-600">Excede lo pendiente</p>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtGs(l.costo_unitario)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                    {fmtGs(cantidadAhora * l.costo_unitario)}
                  </td>
                  <td className="px-3 py-2.5">
                    {!yaCompleta && (
                      <input
                        type="text"
                        placeholder="opcional"
                        value={r.observacion}
                        onChange={(e) => setLinea(l.id, { observacion: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[#4FAEB2]/30"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td colSpan={7} className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                Total pedido: {fmtGs(totalPedido)} · Total a recibir ahora
              </td>
              <td className="px-3 py-3 text-right tabular-nums font-bold text-slate-900">{fmtGs(totalRecibidoAhora)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Datos de la compra (factura del proveedor) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">Datos de la compra</h2>
        <p className="mt-1 text-xs text-slate-500">
          Se genera una compra SOLO con lo confirmado como recibido arriba. Cargá los datos de la factura del proveedor.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Proveedor</label>
            <input disabled value={cab.proveedor_nombre} className={`${inputClass} bg-slate-50 text-slate-500`} />
          </div>
          <div>
            <label className={labelClass}>N° de factura <span className="text-red-500">*</span></label>
            <input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} placeholder="001-001-0000123" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>N° de timbrado <span className="text-red-500">*</span></label>
            <input value={nroTimbrado} onChange={(e) => setNroTimbrado(e.target.value)} placeholder="Ej: 12345678" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Fecha de factura</label>
            <input type="date" value={fechaFactura} onChange={(e) => setFechaFactura(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Tipo de pago</label>
            <select value={tipoPago} onChange={(e) => setTipoPago(e.target.value as "contado" | "credito")} className={`${inputClass} bg-white`}>
              <option value="contado">Contado</option>
              <option value="credito">Crédito</option>
            </select>
          </div>
          {tipoPago === "credito" && (
            <div>
              <label className={labelClass}>Plazo (días)</label>
              <input type="number" min={1} value={plazoDias} onChange={(e) => setPlazoDias(e.target.value)} className={inputClass} />
            </div>
          )}
          <div className="sm:col-span-2">
            <label className={labelClass}>Observaciones <span className="font-normal text-slate-400">(opcional)</span></label>
            <textarea value={observacionCompra} onChange={(e) => setObservacionCompra(e.target.value)} rows={2} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Comprobante / factura <span className="font-normal text-slate-400">(opcional)</span></label>
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setComprobanteFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#4FAEB2] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-[#3F8E91]" />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Link href={`/compras/ordenes/${encodeURIComponent(numeroOc)}`}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancelar
          </Link>
          <button type="button" onClick={() => enviar(false)} disabled={procesando}
            className="inline-flex items-center gap-2 rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-bold text-white hover:bg-[#3F8E91] disabled:opacity-50">
            {procesando && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar compra y recepción
          </button>
        </div>
      </div>

      {/* Modal de confirmación de excedente */}
      {excedentes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Cantidad mayor a la pendiente</h3>
            <p className="mt-2 text-sm text-slate-600">
              Estás por recibir más cantidad que la pendiente en:
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {excedentes.map((e, i) => (
                <li key={i}>
                  <strong>{e.producto_nombre}</strong>: pendiente {e.pendiente}, intentado {e.intentado}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              ¿Confirmás que el proveedor entregó ese excedente y querés registrarlo igual?
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setExcedentes(null)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Corregir cantidades
              </button>
              <button type="button" onClick={() => { setExcedentes(null); enviar(true); }} disabled={procesando}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50">
                {procesando && <Loader2 className="h-4 w-4 animate-spin" />}
                Sí, recibir el excedente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
