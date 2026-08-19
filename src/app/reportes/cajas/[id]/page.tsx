"use client";

/**
 * /reportes/cajas/[id] — Detalle de un turno de caja (página completa).
 *
 * Reemplaza al modal: muestra el resumen del arqueo + la línea de tiempo
 * cronológica del turno (apertura, ventas y movimientos manuales).
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowDownCircle, ArrowUpCircle, ShoppingCart, DoorOpen } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { getCajaDetalle } from "@/lib/reportes/storage";
import type { ArqueoItem, CajaDetalle, MedioPagoCaja } from "@/lib/caja/types";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatHora(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "—";
  }
}
function formatFechaHora(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const fch = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    return `${fch} ${formatHora(iso)}`;
  } catch {
    return iso;
  }
}

const MEDIO_LABEL: Record<MedioPagoCaja, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  otro: "Otro",
};

type TimelineRow = {
  key: string;
  ts: string;
  icon: React.ReactNode;
  tipo: string;
  tipoClass: string;
  detalle: string;
  medio: MedioPagoCaja | null;
  monto: number;
  signo: 1 | -1;
  tachado?: boolean;
};

export default function CajaDetalledPage() {
  const params = useParams<{ id: string }>();
  const cajaId = params?.id ?? "";
  const [data, setData] = useState<CajaDetalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cajaId) return;
    let cancel = false;
    setCargando(true);
    setError(null);
    getCajaDetalle(cajaId)
      .then((d) => {
        if (cancel) return;
        if (!d) setError("No se pudo cargar el detalle del turno.");
        setData(d);
      })
      .finally(() => {
        if (!cancel) setCargando(false);
      });
    return () => {
      cancel = true;
    };
  }, [cajaId]);

  const c = data?.caja;

  // Resumen por vendedor: agrupa ventas activas por usuario y desglosa por
  // metodo de pago. Los movimientos manuales tambien se suman al autor.
  type ResumenVendedor = {
    nombre: string;
    ventas: number;
    total: number;
    efectivo: number;
    tarjeta: number;
    transferencia: number;
    ingresos_manuales: number;
    egresos_manuales: number;
  };
  const porVendedor: ResumenVendedor[] = (() => {
    if (!data) return [];
    const map = new Map<string, ResumenVendedor>();
    const get = (n: string): ResumenVendedor => {
      let r = map.get(n);
      if (!r) {
        r = {
          nombre: n,
          ventas: 0, total: 0,
          efectivo: 0, tarjeta: 0, transferencia: 0,
          ingresos_manuales: 0, egresos_manuales: 0,
        };
        map.set(n, r);
      }
      return r;
    };
    for (const v of data.ventas) {
      if (v.estado === "anulada") continue;
      const nombre = v.usuario_nombre?.trim() || "Sin vendedor";
      const r = get(nombre);
      r.ventas += 1;
      r.total += v.total;
      if (v.metodo_pago === "mixto" && v.desglose_pago) {
        r.efectivo += v.desglose_pago.efectivo;
        r.tarjeta += v.desglose_pago.tarjeta;
        r.transferencia += v.desglose_pago.transferencia;
      } else if (v.metodo_pago === "tarjeta") r.tarjeta += v.total;
      else if (v.metodo_pago === "transferencia") r.transferencia += v.total;
      else r.efectivo += v.total;
    }
    for (const m of data.movimientos) {
      const nombre = (m.usuario_nombre || m.usuario_email || "").trim() || "Sin autor";
      const r = get(nombre);
      const abs = Math.abs(m.monto);
      if (m.tipo === "ingreso" || (m.tipo === "ajuste" && m.monto >= 0)) r.ingresos_manuales += abs;
      else r.egresos_manuales += abs;
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  })();

  // Línea de tiempo unificada: apertura + ventas + movimientos manuales.
  const timeline: TimelineRow[] = [];
  if (c && data) {
    timeline.push({
      key: "apertura",
      ts: c.fecha_apertura,
      icon: <DoorOpen className="h-3.5 w-3.5" />,
      tipo: "Apertura",
      tipoClass: "bg-[#E5F4F4] text-[#3F8E91]",
      detalle: c.abierta_por_nombre ? `Abrió ${c.abierta_por_nombre}` : "Apertura de caja",
      medio: "efectivo",
      monto: c.monto_apertura,
      signo: 1,
    });
    for (const v of data.ventas) {
      const tv = v.tipo_venta ? ` · ${v.tipo_venta}` : "";
      const vendedor = v.usuario_nombre ? ` · ${v.usuario_nombre}` : "";
      timeline.push({
        key: `v-${v.id}`,
        ts: v.fecha,
        icon: <ShoppingCart className="h-3.5 w-3.5" />,
        tipo: "Venta",
        tipoClass: "bg-emerald-50 text-emerald-700",
        detalle: `${v.numero_control ?? "Venta"}${tv}${vendedor}`,
        medio: v.metodo_pago,
        monto: v.total,
        signo: 1,
        tachado: v.estado === "anulada",
      });
    }
    for (const m of data.movimientos) {
      const esEntrada = m.tipo === "ingreso" || (m.tipo === "ajuste" && m.monto >= 0);
      const tipoLabel =
        m.tipo === "ingreso"
          ? "Ingreso"
          : m.tipo === "egreso"
          ? "Egreso"
          : m.tipo === "retiro"
          ? "Retiro"
          : "Ajuste";
      const autor = m.usuario_nombre || m.usuario_email;
      timeline.push({
        key: `m-${m.id}`,
        ts: m.created_at,
        icon: esEntrada ? <ArrowDownCircle className="h-3.5 w-3.5" /> : <ArrowUpCircle className="h-3.5 w-3.5" />,
        tipo: tipoLabel,
        tipoClass: esEntrada ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700",
        detalle: autor ? `${m.concepto} · ${autor}` : m.concepto,
        medio: m.medio_pago,
        monto: Math.abs(m.monto),
        signo: esEntrada ? 1 : -1,
      });
    }
    timeline.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  }

  const dif = c?.diferencia ?? null;
  const difClass =
    dif == null ? "text-slate-400" : dif === 0 ? "text-emerald-600" : dif < 0 ? "text-red-600" : "text-amber-600";

  const descripcion = c
    ? `${formatFechaHora(c.fecha_apertura)}${c.fecha_cierre ? ` → ${formatFechaHora(c.fecha_cierre)}` : " · en curso"}`
    : "Arqueo del turno: ventas y movimientos.";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Detalle del turno"
        description={descripcion}
        backHref="/reportes/cajas"
        backLabel="Cierres de caja"
      />

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : error || !c ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500 shadow-sm">
          {error ?? "Sin datos."}
        </div>
      ) : (
        <>
          {/* Resumen del arqueo */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Resumen label="Vendido" value={formatGs(c.total_vendido)} hint={`${c.cantidad_ventas} venta(s)`} accent />
            <Resumen label="Efectivo" value={formatGs(c.total_efectivo)} />
            <Resumen label="Tarjeta" value={formatGs(c.total_tarjeta)} />
            <Resumen label="Transferencia" value={formatGs(c.total_transferencia)} />
            <Resumen label="Efectivo esperado" value={formatGs(c.efectivo_esperado)} hint="apertura + efectivo ± movs" />
            <Resumen
              label="Contado / Diferencia"
              value={c.monto_cierre_contado == null ? "—" : formatGs(c.monto_cierre_contado)}
              hint={dif == null ? "turno abierto" : `${dif > 0 ? "+" : ""}${formatGs(dif)}`}
              hintClass={difClass}
            />
          </div>

          {/* Resumen por vendedor */}
          {porVendedor.length > 0 && (
            <div className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10">
              <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
                Resumen por vendedor
              </h2>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Vendedor</th>
                      <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Ventas</th>
                      <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Total</th>
                      <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Efectivo</th>
                      <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Tarjeta</th>
                      <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Transfer.</th>
                      <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Otros ingresos</th>
                      <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Egresos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {porVendedor.map((r) => (
                      <tr key={r.nombre} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2.5 font-semibold text-slate-800">{r.nombre}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.ventas}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-900">{formatGs(r.total)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatGs(r.efectivo)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatGs(r.tarjeta)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatGs(r.transferencia)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-sky-700">{formatGs(r.ingresos_manuales)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{formatGs(r.egresos_manuales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                Los importes son de la misma caja física; el desglose es solo para seguimiento por vendedor.
              </p>
            </div>
          )}

          {/* Línea de tiempo */}
          <div className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10">
            <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
              <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
              Movimientos del turno
            </h2>
            {timeline.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">Sin movimientos en este turno.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Hora</th>
                      <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Movimiento</th>
                      <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Detalle</th>
                      <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Método</th>
                      <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {timeline.map((r) => (
                      <tr key={r.key} className="hover:bg-slate-50/70">
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-500">{formatHora(r.ts)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.tipoClass}`}>
                            {r.icon}
                            {r.tipo}
                          </span>
                        </td>
                        <td className={`px-3 py-2 text-xs ${r.tachado ? "text-slate-400 line-through" : "text-slate-700"}`}>
                          {r.detalle}
                          {r.tachado && <span className="ml-1 text-[10px] font-semibold text-red-500">(anulada)</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">{r.medio ? MEDIO_LABEL[r.medio] : "—"}</td>
                        <td
                          className={`px-3 py-2 text-right text-xs font-semibold tabular-nums ${
                            r.tachado ? "text-slate-400 line-through" : r.signo < 0 ? "text-red-600" : "text-emerald-600"
                          }`}
                        >
                          {r.signo < 0 ? "−" : "+"}
                          {formatGs(r.monto)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {c.observacion_cierre && (
              <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Observación de cierre:</span> {c.observacion_cierre}
              </p>
            )}
          </div>

          {/* Arqueo por denominaciones (si el turno lo usó) */}
          {(c.arqueo_apertura_json?.length || c.arqueo_cierre_json?.length) ? (
            <div className="rounded-2xl border border-[#4FAEB2]/30 bg-white p-6 shadow-sm ring-1 ring-[#4FAEB2]/10">
              <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
                Arqueo por denominaciones
              </h2>
              <div className="grid gap-6 md:grid-cols-2">
                <ArqueoDetalle titulo="Apertura" items={c.arqueo_apertura_json} />
                <ArqueoDetalle titulo="Cierre" items={c.arqueo_cierre_json} />
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function ArqueoDetalle({ titulo, items }: { titulo: string; items: ArqueoItem[] | null }) {
  if (!items || items.length === 0) {
    return (
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">{titulo}</p>
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
          Sin arqueo por denominaciones.
        </p>
      </div>
    );
  }
  const total = items.reduce((s, it) => s + it.valor, 0);
  const conteo = items.filter((it) => it.cantidad > 0);
  const monedas = conteo.filter((it) => it.tipo === "moneda");
  const billetes = conteo.filter((it) => it.tipo === "billete");
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">{titulo}</p>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10.5px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-1.5 text-left font-bold">Denom.</th>
              <th className="px-3 py-1.5 text-center font-bold">Cant.</th>
              <th className="px-3 py-1.5 text-right font-bold">Valor</th>
            </tr>
          </thead>
          <tbody>
            <ArqueoGrupo titulo="Monedas" filas={monedas} />
            <ArqueoGrupo titulo="Billetes" filas={billetes} />
            {conteo.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-xs text-slate-400">
                  Todas las denominaciones en 0.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
              <td className="px-3 py-2 text-xs font-bold text-[#3F8E91]" colSpan={2}>Total contado</td>
              <td className="px-3 py-2 text-right text-sm font-bold tabular-nums text-[#3F8E91]">{formatGs(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ArqueoGrupo({ titulo, filas }: { titulo: string; filas: ArqueoItem[] }) {
  if (filas.length === 0) return null;
  return (
    <>
      <tr className="bg-slate-100/70">
        <td colSpan={3} className="px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-600">{titulo}</td>
      </tr>
      {filas.map((it) => (
        <tr key={it.denominacion} className="border-t border-slate-100">
          <td className="px-3 py-1.5 tabular-nums text-slate-700">{formatGs(it.denominacion)}</td>
          <td className="px-3 py-1.5 text-center tabular-nums text-slate-600">{it.cantidad}</td>
          <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-800">{formatGs(it.valor)}</td>
        </tr>
      ))}
    </>
  );
}

function Resumen({
  label,
  value,
  hint,
  hintClass,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  hintClass?: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? "border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.07]" : "border-slate-200 bg-white"}`}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums ${accent ? "text-[#3F8E91]" : "text-slate-800"}`}>{value}</p>
      {hint && <p className={`mt-0.5 text-[11px] tabular-nums ${hintClass ?? "text-slate-400"}`}>{hint}</p>}
    </div>
  );
}
