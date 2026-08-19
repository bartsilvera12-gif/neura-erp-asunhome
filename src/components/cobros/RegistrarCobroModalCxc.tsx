"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { generarYAbrirRecibo } from "@/lib/recibos/client";

/** Cuenta por cobrar mínima para registrar un pago. */
export type CxcRef = {
  id: string;
  numero_venta: string | null;
  saldo: number;
  moneda?: string;
  cliente_nombre?: string | null;
};

type Entidad = { id: string; codigo: string | null; nombre: string; tipo: string | null };

const METODOS = ["efectivo", "transferencia", "tarjeta", "otro"] as const;
const METODO_LABEL: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", otro: "Otro",
};

function fmtGs(n: number, moneda = "PYG") {
  return (moneda === "USD" ? "USD " : "Gs. ") + Math.round(Number(n) || 0).toLocaleString("es-PY");
}

/**
 * Modal reutilizable para registrar un cobro contra una cuenta por cobrar (CxC).
 * Posts a `/api/cobros` (misma lógica que /pagos). Sin duplicar lógica de cobranza.
 */
export function RegistrarCobroModalCxc({
  open,
  cuenta,
  onClose,
  onExito,
}: {
  open: boolean;
  cuenta: CxcRef | null;
  onClose: () => void;
  onExito: () => void | Promise<void>;
}) {
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState<(typeof METODOS)[number]>("efectivo");
  const [referencia, setReferencia] = useState("");
  const [titular, setTitular] = useState("");
  const [entidadId, setEntidadId] = useState("");
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tras un cobro exitoso, se ofrece generar el recibo (paso opcional).
  const [cobroOk, setCobroOk] = useState<{ cobroId: string; monto: number } | null>(null);

  useEffect(() => {
    if (open && cuenta) {
      setMonto(String(cuenta.saldo));
      setMetodo("efectivo");
      setReferencia("");
      setTitular("");
      setEntidadId("");
      setError(null);
      setCobroOk(null);
    }
  }, [open, cuenta]);

  // Entidades bancarias (mismo origen que Caja) para Transferencia/Tarjeta.
  useEffect(() => {
    if (!open) return;
    fetchWithSupabaseSession("/api/entidades-bancarias", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j?.success && Array.isArray(j.data?.entidades)) setEntidades(j.data.entidades as Entidad[]); })
      .catch(() => {});
  }, [open]);

  if (!open || !cuenta) return null;

  const pideBanco = metodo === "transferencia" || metodo === "tarjeta";
  // Para transferencia: banco/billetera. Para tarjeta: procesadora/tarjeta/banco.
  const entidadesFiltradas = entidades.filter((e) => {
    if (metodo === "transferencia") return e.tipo === "banco" || e.tipo === "billetera" || e.tipo == null;
    if (metodo === "tarjeta") return e.tipo === "tarjeta" || e.tipo === "banco" || e.tipo == null;
    return true;
  });

  async function registrar() {
    if (!cuenta || guardando) return;
    const m = Number(monto);
    if (!(m > 0)) { setError("El monto debe ser mayor a cero."); return; }
    if (m > cuenta.saldo + 0.001) { setError("El monto supera el saldo pendiente."); return; }
    if (pideBanco && !entidadId) { setError("Seleccioná la entidad bancaria."); return; }
    if (pideBanco && !referencia.trim()) { setError("Ingresá la referencia / nº de operación."); return; }
    setGuardando(true);
    setError(null);
    try {
      const entidadNombre = entidades.find((e) => e.id === entidadId)?.nombre ?? null;
      const res = await fetchWithSupabaseSession("/api/cobros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cuenta_por_cobrar_id: cuenta.id,
          monto: m,
          metodo_pago: metodo,
          referencia: referencia.trim() || null,
          entidad_bancaria_id: pideBanco ? (entidadId || null) : null,
          titular: pideBanco ? (titular.trim() || null) : null,
          observaciones: !pideBanco && metodo === "otro" ? (referencia.trim() || null) : null,
          entidad_nombre_snapshot: pideBanco ? entidadNombre : null,
        }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo registrar el pago.");
        return;
      }
      // Refrescar datos del padre; pasar a paso "generar recibo" (opcional).
      await onExito();
      const cobroId = body?.data?.cobro_id ? String(body.data.cobro_id) : null;
      if (cobroId) setCobroOk({ cobroId, monto: m });
      else onClose();
    } catch {
      setError("Error de red al registrar el pago.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">{cobroOk ? "Pago registrado" : "Registrar pago"}</h3>
          <p className="text-xs text-gray-500">
            {cuenta.numero_venta ?? "Cuenta"}{cuenta.cliente_nombre ? ` · ${cuenta.cliente_nombre}` : ""} · Saldo {fmtGs(cuenta.saldo, cuenta.moneda)}
          </p>
        </div>

        {cobroOk ? (
          <>
            <div className="px-5 py-5 text-center space-y-2">
              <div className="text-3xl">✅</div>
              <p className="text-sm text-slate-700">Cobro de {fmtGs(cobroOk.monto, cuenta.moneda)} registrado.</p>
              <p className="text-xs text-slate-500">¿Querés generar el recibo de dinero de este cobro?</p>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button onClick={onClose} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Listo</button>
              <button
                onClick={async () => {
                  const r = await generarYAbrirRecibo({ origen: "cobro_cxc", cobro_cliente_id: cobroOk.cobroId });
                  if (!r.ok) setError(r.error ?? "No se pudo generar el recibo.");
                  else onClose();
                }}
                className="inline-flex items-center justify-center rounded-md bg-[#4FAEB2] px-5 py-2 text-sm font-medium text-white hover:bg-[#3F8E91]"
              >
                Generar recibo de dinero
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-5 py-4 space-y-3">
              {error && <div className="rounded-md bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{error}</div>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Monto a cobrar</label>
                <input type="number" min="0" step="1" value={monto} onChange={(e) => setMonto(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                <button type="button" onClick={() => setMonto(String(cuenta.saldo))} className="mt-1 text-xs text-[#4FAEB2] hover:underline">Cobrar saldo total</button>
                <p className="mt-1 text-[11px] text-slate-500">Si cobrás menos que el saldo, la cuenta sigue pendiente con la diferencia.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Método de pago</label>
                <select value={metodo} onChange={(e) => setMetodo(e.target.value as (typeof METODOS)[number])} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white">
                  {METODOS.map((m) => <option key={m} value={m}>{METODO_LABEL[m]}</option>)}
                </select>
              </div>
              {pideBanco && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {metodo === "tarjeta" ? "Procesadora / Banco" : "Entidad bancaria"} *
                  </label>
                  <select value={entidadId} onChange={(e) => setEntidadId(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white">
                    <option value="">— Elegí —</option>
                    {entidadesFiltradas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {metodo === "tarjeta" ? "Autorización / referencia" : metodo === "transferencia" ? "Referencia / Nº operación" : "Referencia"}{pideBanco ? " *" : " (opcional)"}
                </label>
                <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="Nº comprobante, transferencia…" />
              </div>
              {pideBanco && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Titular (opcional)</label>
                  <input value={titular} onChange={(e) => setTitular(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="Titular de la cuenta/tarjeta" />
                </div>
              )}
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button onClick={onClose} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={registrar} disabled={guardando} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#4FAEB2] px-5 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
                {guardando ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : "Confirmar pago"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
