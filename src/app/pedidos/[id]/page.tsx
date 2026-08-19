"use client";

/**
 * /pedidos/[id] — Pantalla de detalle (solo lectura) de un pedido.
 *
 * Muestra cabecera + items con presentacion + equivalencia + auditoria
 * (vendedor, cajero, fecha). Acciones contextuales por estado:
 *
 *   pendiente  -> [Editar] [Cancelar] [Ir a cobrar]
 *   en_caja    -> [Editar] [Liberar] [Cancelar] [Ir a cobrar]
 *   facturado  -> [Ver venta]    (link a /ventas/[id]/ticket)
 *   cancelado  -> readonly
 *
 * No duplica logica: para editar usa /pedidos/[id]/editar. El cobro se hace
 * desde la Caja (/ventas) ("Ir a cobrar" enlaza alli).
 */

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import {
  Receipt,
  Clock,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  Pencil,
  Trash2,
  ArrowRight,
  Loader2,
  User,
  Phone,
  FileText,
  Package,
  ExternalLink,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import type {
  PedidoCaja,
  PedidoCajaItem,
  EstadoPedidoCaja,
} from "@/lib/pedidos-caja/types";

function fmtGs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}
function fmtFechaHora(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-PY", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function VerPedidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: pedidoId } = use(params);

  const [pedido, setPedido] = useState<PedidoCaja | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(
        `/api/pedidos-caja/${pedidoId}`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success || !j.data?.pedido) {
        setError(j?.error ?? "Pedido no encontrado.");
        setPedido(null);
        return;
      }
      setPedido(j.data.pedido as PedidoCaja);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, [pedidoId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleLiberar() {
    if (!pedido) return;
    setBusy(true);
    try {
      const r = await fetchWithSupabaseSession(
        `/api/pedidos-caja/${pedido.id}/liberar`,
        { method: "POST" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "Error");
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Error.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelar() {
    if (!pedido) return;
    const ok = window.confirm(
      `¿Cancelar el pedido ${pedido.numero ?? ""}?\n\nEsta acción no se puede deshacer.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetchWithSupabaseSession(
        `/api/pedidos-caja/${pedido.id}?motivo=cancelado+desde+detalle`,
        { method: "DELETE" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "Error");
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Error.");
    } finally {
      setBusy(false);
    }
  }

  // ============================================================
  // Render
  // ============================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-7 w-7 animate-spin text-[#4FAEB2]" />
      </div>
    );
  }

  if (error || !pedido) {
    return (
      <div className="w-full py-8 px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-2xl border-2 border-red-200 p-8 text-center max-w-md mx-auto">
          <XCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
          <p className="text-sm font-bold text-red-700">
            {error ?? "Pedido no encontrado."}
          </p>
          <Link
            href="/pedidos"
            className="inline-flex items-center gap-2 mt-4 text-sm font-semibold text-[#3F8E91] hover:underline"
          >
            ← Volver al listado
          </Link>
        </div>
      </div>
    );
  }

  const total = pedido.items.reduce(
    (s, it) => s + it.cantidad * it.precio_venta,
    0
  );

  return (
    <div className="w-full py-8 px-4 sm:px-6 lg:px-8 space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#4FAEB2]/8 border border-[#4FAEB2]/30 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#3F8E91] mb-3">
            <Receipt className="h-3 w-3 text-[#4FAEB2]" />
            Pedidos · Detalle
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 tracking-tight leading-tight font-mono">
              {pedido.numero ?? pedido.titulo}
            </h1>
            <EstadoBadge estado={pedido.estado} venta_numero={pedido.venta_numero} />
          </div>
          <p className="text-[14px] text-slate-500 mt-1.5">
            Creado el {fmtFechaHora(pedido.created_at)}
            {pedido.armado_por_email && (
              <>
                {" "}
                por <span className="font-semibold text-slate-700">{pedido.armado_por_email}</span>
              </>
            )}
            .
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/pedidos"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#3F8E91]"
          >
            ← Listado
          </Link>
          <Acciones
            pedido={pedido}
            busy={busy}
            onLiberar={handleLiberar}
            onCancelar={handleCancelar}
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Items — toma 2/3 */}
        <section className="lg:col-span-2 bg-white rounded-2xl border-2 border-[#4FAEB2]/20 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent">
            <h2 className="text-[15px] font-bold text-slate-800 flex items-center gap-2">
              <Package className="h-4 w-4 text-[#4FAEB2]" />
              Productos
              <span className="inline-flex items-center justify-center min-w-[24px] h-[22px] px-2 rounded-full bg-[#4FAEB2] text-white text-[11px] font-bold tabular-nums">
                {pedido.items.length}
              </span>
            </h2>
          </div>
          {pedido.items.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              Pedido sin productos.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50/70 text-slate-500 text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold">Producto</th>
                    <th className="px-3 py-3 text-left font-semibold">Presentación</th>
                    <th className="px-3 py-3 text-center font-semibold">IVA</th>
                    <th className="px-3 py-3 text-right font-semibold">Cantidad</th>
                    <th className="px-3 py-3 text-right font-semibold">Precio</th>
                    <th className="px-3 py-3 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pedido.items.map((it, idx) => (
                    <ItemRow key={idx} it={it} />
                  ))}
                </tbody>
                <tfoot className="bg-slate-50/40 border-t-2 border-slate-100">
                  <tr>
                    <td colSpan={5} className="px-5 py-3 text-right font-bold text-slate-700">
                      Total
                    </td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums text-lg text-[#3F8E91]">
                      {fmtGs(total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* Sidebar info — 1/3 */}
        <aside className="space-y-4">
          {/* Cliente */}
          <InfoCard
            title="Cliente"
            icon={<User className="h-4 w-4 text-[#4FAEB2]" />}
          >
            {pedido.cliente_nombre ? (
              <>
                <p className="text-sm font-bold text-slate-800">
                  {pedido.cliente_nombre}
                </p>
                {pedido.cliente_telefono && (
                  <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                    <Phone className="h-3 w-3" />
                    {pedido.cliente_telefono}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-400 italic">Sin cliente asignado</p>
            )}
          </InfoCard>

          {/* Vendedor */}
          <InfoCard
            title="Vendedor"
            icon={<User className="h-4 w-4 text-[#4FAEB2]" />}
          >
            <p className="text-sm text-slate-700">
              {pedido.armado_por_email ?? (
                <span className="text-slate-400 italic">Desconocido</span>
              )}
            </p>
          </InfoCard>

          {/* Cajero (si aplica) */}
          {(pedido.estado === "en_caja" || pedido.estado === "facturado") && (
            <InfoCard
              title="Cajero"
              icon={<User className="h-4 w-4 text-[#4FAEB2]" />}
            >
              <p className="text-sm text-slate-700">
                {pedido.abierto_por_email ?? (
                  <span className="text-slate-400 italic">—</span>
                )}
              </p>
              {pedido.abierto_at && (
                <p className="text-xs text-slate-500 mt-1">
                  Tomado el {fmtFechaHora(pedido.abierto_at)}
                </p>
              )}
            </InfoCard>
          )}

          {/* Observación */}
          {pedido.observacion && (
            <InfoCard
              title="Observación"
              icon={<FileText className="h-4 w-4 text-[#4FAEB2]" />}
            >
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {pedido.observacion}
              </p>
            </InfoCard>
          )}

          {/* Línea de tiempo */}
          <InfoCard
            title="Línea de tiempo"
            icon={<Clock className="h-4 w-4 text-[#4FAEB2]" />}
          >
            <ul className="space-y-2 text-xs">
              <Evento
                label="Creado"
                fecha={pedido.created_at}
                color="amber"
              />
              {pedido.abierto_at && (
                <Evento
                  label="Tomado por caja"
                  fecha={pedido.abierto_at}
                  color="sky"
                />
              )}
              {pedido.facturado_at && (
                <Evento
                  label={`Facturado${pedido.venta_numero ? ` · ${pedido.venta_numero}` : ""}`}
                  fecha={pedido.facturado_at}
                  color="emerald"
                />
              )}
              {pedido.cancelado_at && (
                <Evento
                  label={`Cancelado${pedido.cancelado_motivo ? ` (${pedido.cancelado_motivo})` : ""}`}
                  fecha={pedido.cancelado_at}
                  color="slate"
                />
              )}
            </ul>
          </InfoCard>

          {/* Link a venta */}
          {pedido.estado === "facturado" && pedido.venta_id && (
            <Link
              href={`/api/ventas/${pedido.venta_id}/comprobante-a4`}
              target="_blank"
              className="inline-flex items-center justify-center gap-2 w-full rounded-xl bg-[#4FAEB2] hover:bg-[#3F8E91] text-white text-sm font-bold py-3 transition-colors shadow-md shadow-[#4FAEB2]/30"
            >
              <ExternalLink className="h-4 w-4" />
              Ver ticket de venta
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

// ============================================================
// Subcomponentes
// ============================================================

function ItemRow({ it }: { it: PedidoCajaItem }) {
  const cantBase = it.presentacion_cantidad_base ?? 1;
  const showsPres =
    !!it.presentacion_nombre &&
    it.presentacion_nombre.toLowerCase() !== "unidad";
  return (
    <tr className="hover:bg-slate-50/50 transition-colors">
      <td className="px-5 py-3">
        <p className="font-semibold text-slate-800">{it.producto_nombre}</p>
        {it.sku && (
          <p className="text-[10.5px] font-mono text-slate-400 mt-0.5">{it.sku}</p>
        )}
      </td>
      <td className="px-3 py-3">
        {showsPres ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-md bg-[#4FAEB2]/10 text-[#3F8E91] border border-[#4FAEB2]/20 px-2 py-0.5 text-[11px] font-bold">
              {it.presentacion_nombre}
            </span>
            {cantBase > 1 && (
              <p className="text-[10.5px] text-slate-500 mt-1 tabular-nums">
                = {cantBase} unidades
              </p>
            )}
          </>
        ) : (
          <span className="text-xs text-slate-400">Unidad</span>
        )}
      </td>
      <td className="px-3 py-3 text-center">
        <span className="inline-flex items-center rounded-md bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
          {it.tipo_iva ?? "10%"}
        </span>
      </td>
      <td className="px-3 py-3 text-right">
        <p className="font-bold tabular-nums text-slate-800">{it.cantidad}</p>
        {showsPres && cantBase > 1 && (
          <p className="text-[10.5px] text-slate-500 tabular-nums">
            = {it.cantidad * cantBase}
          </p>
        )}
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-slate-700 text-xs">
        {fmtGs(it.precio_venta)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums font-bold text-slate-900">
        {fmtGs(it.cantidad * it.precio_venta)}
      </td>
    </tr>
  );
}

function EstadoBadge({
  estado,
  venta_numero,
}: {
  estado: EstadoPedidoCaja;
  venta_numero: string | null;
}) {
  if (estado === "facturado") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border-2 border-emerald-200 px-2.5 py-1 text-xs font-bold text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Facturado{venta_numero ? ` · ${venta_numero}` : ""}
      </span>
    );
  }
  if (estado === "cancelado") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 border-2 border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600">
        <XCircle className="h-3.5 w-3.5" />
        Cancelado
      </span>
    );
  }
  if (estado === "en_caja") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 border-2 border-sky-200 px-2.5 py-1 text-xs font-bold text-sky-700">
        <Lock className="h-3.5 w-3.5" />
        En caja
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border-2 border-amber-200 px-2.5 py-1 text-xs font-bold text-amber-700">
      <Clock className="h-3.5 w-3.5" />
      Pendiente
    </span>
  );
}

function Acciones({
  pedido,
  busy,
  onLiberar,
  onCancelar,
}: {
  pedido: PedidoCaja;
  busy: boolean;
  onLiberar: () => void;
  onCancelar: () => void;
}) {
  if (pedido.estado === "facturado" || pedido.estado === "cancelado") {
    return null;
  }
  return (
    <>
      <Link
        href={`/pedidos/${pedido.id}/editar`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#3F8E91]"
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar
      </Link>
      {pedido.estado === "en_caja" && (
        <button
          type="button"
          onClick={onLiberar}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
        >
          <Unlock className="h-3.5 w-3.5" />
          Liberar
        </button>
      )}
      <button
        type="button"
        onClick={onCancelar}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Cancelar
      </button>
      <Link
        href="/ventas"
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white text-sm font-bold px-4 py-2 transition-colors shadow-sm shadow-[#4FAEB2]/30"
        title="Ir a la Caja para cobrar"
      >
        Ir a cobrar
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </>
  );
}

function InfoCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-[10.5px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-1.5 mb-2">
        {icon}
        {title}
      </p>
      <div>{children}</div>
    </div>
  );
}

function Evento({
  label,
  fecha,
  color,
}: {
  label: string;
  fecha: string | null;
  color: "amber" | "sky" | "emerald" | "slate";
}) {
  const bgMap = {
    amber: "bg-amber-500",
    sky: "bg-sky-500",
    emerald: "bg-emerald-500",
    slate: "bg-slate-400",
  };
  return (
    <li className="flex items-start gap-2">
      <span
        className={`w-2 h-2 rounded-full ${bgMap[color]} mt-1.5 shrink-0`}
      />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-700">{label}</p>
        <p className="text-slate-500 tabular-nums">{fmtFechaHora(fecha)}</p>
      </div>
    </li>
  );
}
