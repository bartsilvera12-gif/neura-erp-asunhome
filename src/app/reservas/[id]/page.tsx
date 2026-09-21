"use client";

/** Detalle de reserva: ítems (entregar), pagos (anticipo), cancelar. */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import MontoInput from "@/components/ui/MontoInput";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Item = { id: string; producto_nombre: string; sku: string | null; cantidad: number; cantidad_entregada: number; precio_unitario: number; tipo_iva: string | null; total: number; venta_id: string | null; venta_numero: string | null };
type Pago = { id: string; fecha: string; monto: number; metodo_pago: string | null; referencia: string | null };
type Header = { id: string; numero_control: string; cliente_nombre: string | null; fecha: string; estado: string; total: number; pagado: number; saldo: number; observaciones: string | null; venta_id: string | null };
const fmtGs = (n: number) => `Gs. ${Math.round(n || 0).toLocaleString("es-PY")}`;
const ESTADO_LBL: Record<string, string> = { activa: "En guarda", facturada: "Facturada", cancelada: "Cancelada" };

export default function ReservaDetallePage() {
  const { id } = useParams<{ id: string }>();
  const [header, setHeader] = useState<Header | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pagoOpen, setPagoOpen] = useState(false);
  const [facturando, setFacturando] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  // Flujo "cobrar saldo y facturar todo": monto sugerido para el modal de pago y
  // bandera para, tras registrar el cobro, facturar todo lo pendiente sin re-preguntar.
  const [pagoMontoSugerido, setPagoMontoSugerido] = useState<number | undefined>(undefined);
  const [facturarTrasPago, setFacturarTrasPago] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true); setErr(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/reservas/${id}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? `Error ${r.status}`);
      setHeader(j.data.header); setItems(j.data.items ?? []); setPagos(j.data.pagos ?? []);
    } catch (e) { setErr(e instanceof Error ? e.message : "Error"); }
    finally { setCargando(false); }
  }, [id]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function entregar(itemId: string, max: number) {
    const txt = window.prompt(`¿Cuántas unidades entregás? (máx ${max})`, String(max));
    if (txt == null) return;
    const cant = Number(txt);
    if (!Number.isFinite(cant) || cant <= 0) return;
    const r = await fetchWithSupabaseSession(`/api/reservas/${id}/entrega`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reserva_item_id: itemId, cantidad: cant }),
    });
    const j = await r.json();
    if (!r.ok || j?.success === false) { alert(j?.error ?? "No se pudo registrar la entrega."); return; }
    void cargar();
  }

  async function cancelar() {
    if (!window.confirm("¿Estás seguro de CANCELAR esta reserva?\n\nEsta acción no se puede deshacer: los productos no entregados vuelven al stock y se pierde la guarda.\n\nSi solo querías facturar, cerrá este aviso y usá \"Facturar todo lo pendiente\".")) return;
    const r = await fetchWithSupabaseSession(`/api/reservas/${id}/cancelar`, { method: "POST" });
    const j = await r.json();
    if (!r.ok || j?.success === false) { alert(j?.error ?? "No se pudo cancelar."); return; }
    void cargar();
  }

  // itemIds=null → factura TODOS los pendientes; con array → solo esos (parcial).
  // skipConfirm: cuando ya se confirmó en el flujo "cobrar y facturar".
  async function facturar(itemIds: string[] | null, opts?: { skipConfirm?: boolean }) {
    if (facturando) return; // guard anti doble-click
    const cuantos = itemIds ? itemIds.length : items.filter((it) => !it.venta_id).length;
    const msg = itemIds
      ? `¿Facturar ${cuantos} producto(s) seleccionado(s) al precio pactado? No se vuelve a descontar stock.`
      : `¿Facturar todos los productos pendientes al precio pactado? No se vuelve a descontar stock.`;
    if (!opts?.skipConfirm && !window.confirm(msg)) return;
    setFacturando(true);
    try {
      const r = await fetchWithSupabaseSession(`/api/reservas/${id}/facturar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemIds ? { item_ids: itemIds } : {}),
      });
      const j = await r.json();
      if (!r.ok || j?.success === false) { alert(j?.error ?? "No se pudo facturar."); return; }
      setSeleccionados(new Set());
      await cargar(); // recargar: muestra qué productos quedaron facturados y cuáles en guarda
    } finally {
      setFacturando(false);
    }
  }

  if (cargando) return <p className="text-slate-500 animate-pulse">Cargando…</p>;
  if (err || !header) return <p className="text-red-600">{err ?? "No encontrada."}</p>;
  const activa = header.estado === "activa";
  const facturada = header.estado === "facturada";
  const itemsPendientes = items.filter((it) => !it.venta_id);
  const selPend = itemsPendientes.filter((it) => seleccionados.has(it.id));
  const totalSeleccionado = selPend.reduce((s, it) => s + it.total, 0);
  const toggleSel = (itemId: string) =>
    setSeleccionados((prev) => { const n = new Set(prev); if (n.has(itemId)) n.delete(itemId); else n.add(itemId); return n; });
  const toggleTodos = () =>
    setSeleccionados((prev) => (prev.size >= itemsPendientes.length && itemsPendientes.length > 0 ? new Set() : new Set(itemsPendientes.map((it) => it.id))));

  // Regla de dinero: "lo pagado cubre lo facturado". Cada facturación (parcial o
  // total) sólo procede si el pago acumulado alcanza para cubrir lo ya facturado
  // MÁS lo que se está por facturar. `disponible` = pago que aún no respalda
  // ninguna factura y por ende puede cubrir productos nuevos.
  const facturadoPrevio = items.filter((it) => it.venta_id).reduce((s, it) => s + it.total, 0);
  const disponible = header.pagado - facturadoPrevio;
  const selCubierto = totalSeleccionado <= disponible + 0.009;
  const totalPendiente = itemsPendientes.reduce((s, it) => s + it.total, 0);
  const todoCubierto = totalPendiente <= disponible + 0.009;
  // Faltante para poder facturar TODO lo pendiente (toma en cuenta la seña/anticipos
  // ya registrados vía `disponible`). Nunca supera el saldo de la reserva.
  const faltantePorCubrir = Math.max(0, Math.round(totalPendiente - disponible));

  // Flujo pedido: "Facturar todo lo pendiente" aunque haya saldo. Si el pago ya cubre,
  // factura directo; si falta, abre el cobro del saldo restante y, al confirmarse el
  // pago, factura todo automáticamente. Nunca obliga a cancelar la reserva.
  const facturarTodoFlow = () => {
    if (facturando || itemsPendientes.length === 0) return;
    if (todoCubierto) { void facturar(null); return; }
    if (!window.confirm(`Para facturar todo lo pendiente falta cobrar ${fmtGs(faltantePorCubrir)}.\n\n¿Registrar ese cobro ahora y facturar todos los productos pendientes?`)) return;
    setPagoMontoSugerido(faltantePorCubrir);
    setFacturarTrasPago(true);
    setPagoOpen(true);
  };

  return (
    <div className="space-y-6">
      <Link href="/reservas" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="h-4 w-4" /> Reservas</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{header.numero_control}</h1>
          <p className="mt-0.5 text-sm text-slate-500">{header.cliente_nombre ?? "Sin cliente"} · {header.fecha} · <span className="font-medium">{ESTADO_LBL[header.estado] ?? header.estado}</span></p>
        </div>
        {activa && (
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => setPagoOpen(true)} className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">Registrar pago / anticipo</button>
              {selPend.length > 0 && (
                <button
                  onClick={() => facturar(selPend.map((it) => it.id))}
                  disabled={!selCubierto || facturando}
                  title={selCubierto ? "Factura sólo los productos seleccionados al precio pactado, sin volver a descontar stock. Los demás quedan en guarda." : "El pago acumulado no cubre los productos seleccionados."}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {facturando ? "Facturando…" : `Facturar seleccionados (${selPend.length})`}
                </button>
              )}
              {itemsPendientes.length > 0 && (
                <button
                  onClick={facturarTodoFlow}
                  disabled={facturando}
                  title={todoCubierto ? "Factura todos los productos pendientes al precio pactado." : "Cobra el saldo restante y factura todo lo pendiente en un solo paso."}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {facturando ? "Facturando…" : todoCubierto ? "Facturar todo lo pendiente" : "Cobrar saldo y facturar todo"}
                </button>
              )}
              <button onClick={cancelar} className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100">Cancelar</button>
            </div>
            {selPend.length > 0 && !selCubierto && (
              <p className="text-[11px] text-amber-600">Lo pagado no cubre lo seleccionado ({fmtGs(totalSeleccionado)}). Registrá {fmtGs(totalSeleccionado - disponible)} más para facturarlos.</p>
            )}
            {selPend.length > 0 && selCubierto && (
              <p className="text-[11px] text-slate-500">Seleccionados: {selPend.length} · {fmtGs(totalSeleccionado)} (cubierto por lo pagado).</p>
            )}
            {selPend.length === 0 && !todoCubierto && (
              <p className="text-[11px] text-amber-600">Hay un saldo de {fmtGs(header.saldo)}. Con “Cobrar saldo y facturar todo” registrás el cobro y facturás todo lo pendiente en un paso (no hace falta cancelar). O facturá por partes seleccionando productos.</p>
            )}
          </div>
        )}
        {facturada && (
          <Link href="/ventas" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">
            ✓ Facturada — ver en Ventas
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card label="Total" value={fmtGs(header.total)} />
        <Card label="Pagado" value={fmtGs(header.pagado)} tone="emerald" />
        <Card label="Saldo pendiente" value={fmtGs(header.saldo)} tone="teal" />
      </div>

      {/* Ítems */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold text-slate-700">Productos en guarda</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                {activa && (
                  <th className="w-10 px-3 py-2.5 text-center">
                    {itemsPendientes.length > 0 && (
                      <input
                        type="checkbox"
                        checked={selPend.length === itemsPendientes.length && itemsPendientes.length > 0}
                        onChange={toggleTodos}
                        title="Seleccionar todos los productos en guarda"
                        className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                      />
                    )}
                  </th>
                )}
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Producto</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Cant.</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Entregado</th>
                <th className="px-4 py-2.5 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">Estado</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Total</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it) => {
                const pend = it.cantidad - it.cantidad_entregada;
                const facturado = !!it.venta_id;
                const checked = seleccionados.has(it.id);
                return (
                  <tr key={it.id} className={`hover:bg-slate-50/50 ${checked ? "bg-emerald-50/40" : ""}`}>
                    {activa && (
                      <td className="px-3 py-2.5 text-center">
                        {!facturado && (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSel(it.id)}
                            title="Seleccionar para facturar este producto"
                            className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                          />
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2.5 font-medium text-slate-800">{it.producto_nombre}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{it.cantidad}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{it.cantidad_entregada}{pend > 0 ? <span className="text-amber-600"> ({pend} en guarda)</span> : <span className="text-emerald-600"> ✓</span>}</td>
                    <td className="px-4 py-2.5 text-center">
                      {facturado ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700" title="Este producto ya fue facturado.">Facturado{it.venta_numero ? ` · ${it.venta_numero}` : ""}</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">En guarda</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{fmtGs(it.total)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {activa && !facturado && pend > 0 && (
                        <button onClick={() => entregar(it.id, pend)} className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Entregar</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagos */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold text-slate-700">Pagos / anticipos</h2></div>
        {pagos.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">Sin pagos registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Fecha</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Método</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Referencia</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagos.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 text-slate-600">{p.fecha}</td>
                  <td className="px-4 py-2 text-slate-600">{p.metodo_pago ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-500">{p.referencia ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-700">{fmtGs(p.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {header.observaciones && <p className="text-sm text-slate-500">Observaciones: {header.observaciones}</p>}
      <p className="text-xs text-slate-400">Podés facturar los productos por partes: seleccioná los que se lleva el cliente y facturálos: cada uno se factura con el precio pactado, siempre que el pago acumulado lo cubra. Los demás quedan en guarda. NO se vuelve a descontar stock (la mercadería ya salió al crear la guarda) y los anticipos ya entraron a caja.</p>

      {pagoOpen && (
        <PagoModal
          reservaId={id}
          saldo={header.saldo}
          montoSugerido={pagoMontoSugerido}
          onClose={() => { setPagoOpen(false); setFacturarTrasPago(false); setPagoMontoSugerido(undefined); }}
          onDone={async () => {
            setPagoOpen(false);
            const encadenar = facturarTrasPago;
            setFacturarTrasPago(false);
            setPagoMontoSugerido(undefined);
            await cargar();
            // Ya se registró el cobro del saldo → facturar todo lo pendiente sin re-preguntar.
            if (encadenar) await facturar(null, { skipConfirm: true });
          }}
        />
      )}
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "teal" }) {
  const c = tone === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : tone === "teal" ? "border-[#4FAEB2]/30 bg-[#4FAEB2]/[0.06] text-[#3F8E91]" : "border-slate-200 bg-white text-slate-800";
  return <div className={`rounded-xl border p-4 ${c}`}><p className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</p><p className="mt-1 text-lg font-bold tabular-nums">{value}</p></div>;
}

function PagoModal({ reservaId, saldo, montoSugerido, onClose, onDone }: { reservaId: string; saldo: number; montoSugerido?: number; onClose: () => void; onDone: () => void }) {
  // Si viene un monto sugerido (flujo "cobrar saldo y facturar todo"), se precarga
  // el saldo restante; si no, la sugerencia por defecto es el 50%.
  const [monto, setMonto] = useState(montoSugerido && montoSugerido > 0 ? Math.min(montoSugerido, saldo) : Math.round(saldo / 2));
  const [metodo, setMetodo] = useState("efectivo");
  const [referencia, setReferencia] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!(monto > 0)) { setError("Ingresá un monto válido."); return; }
    if (monto > saldo + 0.01) { setError(`El monto supera el saldo (${fmtGs(saldo)}).`); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/reservas/${reservaId}/pago`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto, metodo_pago: metodo, referencia: referencia.trim() || null }),
      });
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? `Error ${r.status}`);
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo registrar el pago."); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-4">
          <h3 className="text-base font-bold text-slate-800">Registrar pago / anticipo</h3>
          <p className="mt-1 text-xs text-slate-500">Saldo pendiente: {fmtGs(saldo)}. Entra a caja (si hay una abierta).</p>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Monto</span>
            <MontoInput value={monto} onChange={setMonto} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm outline-none focus:border-[#4FAEB2]" />
            <span className="mt-1 block text-[11px] text-slate-500">
              {montoSugerido && montoSugerido > 0
                ? `Saldo restante para facturar todo: ${fmtGs(Math.min(montoSugerido, saldo))}. Podés ajustarlo.`
                : `Sugerencia: 50% = ${fmtGs(saldo / 2)}. Podés poner el monto que sea.`}
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Método</span>
            <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white outline-none focus:border-[#4FAEB2]">
              <option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Referencia <span className="text-slate-400 font-normal">(opcional)</span></span>
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2]" />
          </label>
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} disabled={loading} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
            <button onClick={submit} disabled={loading} className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-bold text-white hover:bg-[#3F8E91] disabled:opacity-50">{loading ? "Guardando…" : "Registrar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
