"use client";

/**
 * Panel de Cuentas por pagar (proveedores): cuotas vencidas, próximas a vencer,
 * pendientes y pagadas, con registro de pagos (parciales o totales).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Cuota = {
  id: string;
  cuenta_por_pagar_id: string;
  numero_cuota: number;
  fecha_vencimiento: string;
  monto: number;
  saldo: number;
  estado: string;
  proveedor_nombre: string | null;
  compra_numero_control: string | null;
  moneda: string;
};

function fmtGs(n: number) {
  return `Gs. ${Math.round(n || 0).toLocaleString("es-PY")}`;
}
function hoyYmd() {
  return new Date().toISOString().slice(0, 10);
}
function diasHasta(ymd: string): number {
  const hoy = new Date(hoyYmd() + "T00:00:00Z").getTime();
  const v = new Date(ymd + "T00:00:00Z").getTime();
  return Math.round((v - hoy) / 86400000);
}

type Grupo = "vencidas" | "proximas" | "pendientes" | "pagadas";

function clasificar(c: Cuota): Grupo {
  if (c.saldo <= 0.01 || c.estado === "pagada") return "pagadas";
  const d = diasHasta(c.fecha_vencimiento);
  if (d < 0) return "vencidas";
  if (d <= 7) return "proximas";
  return "pendientes";
}

const GRUPO_META: Record<Grupo, { label: string; badge: string; row: string }> = {
  vencidas: { label: "Vencidas", badge: "bg-red-100 text-red-700", row: "bg-red-50/40" },
  proximas: { label: "Próximas a vencer (7 días)", badge: "bg-amber-100 text-amber-700", row: "bg-amber-50/40" },
  pendientes: { label: "Pendientes", badge: "bg-slate-100 text-slate-600", row: "" },
  pagadas: { label: "Pagadas", badge: "bg-emerald-100 text-emerald-700", row: "" },
};

export default function CuentasPorPagarPage() {
  const [cuotas, setCuotas] = useState<Cuota[]>([]);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pagar, setPagar] = useState<Cuota | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErr(null);
    try {
      const r = await fetchWithSupabaseSession("/api/cuentas-por-pagar", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? `Error ${r.status}`);
      setCuotas((j.data?.cuotas ?? []) as Cuota[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const grupos = useMemo(() => {
    const g: Record<Grupo, Cuota[]> = { vencidas: [], proximas: [], pendientes: [], pagadas: [] };
    for (const c of cuotas) g[clasificar(c)].push(c);
    return g;
  }, [cuotas]);

  const totalVencido = grupos.vencidas.reduce((s, c) => s + c.saldo, 0);
  const totalProximo = grupos.proximas.reduce((s, c) => s + c.saldo, 0);
  const totalPendiente = [...grupos.vencidas, ...grupos.proximas, ...grupos.pendientes].reduce((s, c) => s + c.saldo, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cuentas por pagar</h1>
          <p className="mt-1 text-sm text-slate-500">Cuotas de compras a crédito por proveedor: vencidas, próximas, pendientes y pagadas.</p>
        </div>
        <button onClick={() => void cargar()} disabled={cargando} className="inline-flex items-center gap-1 rounded-md bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91] disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>

      {err && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Vencido" value={fmtGs(totalVencido)} tone={totalVencido > 0 ? "red" : "muted"} sub={`${grupos.vencidas.length} cuota(s)`} />
        <Stat label="Próximo a vencer (7 días)" value={fmtGs(totalProximo)} tone={totalProximo > 0 ? "amber" : "muted"} sub={`${grupos.proximas.length} cuota(s)`} />
        <Stat label="Total pendiente" value={fmtGs(totalPendiente)} tone="teal" />
      </div>

      {(["vencidas", "proximas", "pendientes", "pagadas"] as Grupo[]).map((g) => (
        <GrupoTabla key={g} grupo={g} cuotas={grupos[g]} onPagar={setPagar} cargando={cargando} />
      ))}

      {pagar && (
        <PagarModal
          cuota={pagar}
          onClose={() => setPagar(null)}
          onDone={() => { setPagar(null); void cargar(); }}
        />
      )}
    </div>
  );
}

function GrupoTabla({ grupo, cuotas, onPagar, cargando }: { grupo: Grupo; cuotas: Cuota[]; onPagar: (c: Cuota) => void; cargando: boolean }) {
  const meta = GRUPO_META[grupo];
  if (!cargando && cuotas.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.badge}`}>{meta.label}</span>
        <span className="text-xs text-slate-400">{cuotas.length}</span>
      </div>
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Proveedor</th>
            <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Compra</th>
            <th className="px-4 py-2.5 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">Cuota</th>
            <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Vence</th>
            <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Monto</th>
            <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Saldo</th>
            <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {cuotas.map((c) => {
            const d = diasHasta(c.fecha_vencimiento);
            const venceLabel = grupo === "pagadas" ? c.fecha_vencimiento
              : d < 0 ? `${c.fecha_vencimiento} (${Math.abs(d)}d vencida)`
              : d === 0 ? `${c.fecha_vencimiento} (hoy)`
              : `${c.fecha_vencimiento} (en ${d}d)`;
            return (
              <tr key={c.id} className={`hover:bg-slate-50/50 ${meta.row}`}>
                <td className="px-4 py-2.5 font-medium text-slate-800">{c.proveedor_nombre ?? "—"}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{c.compra_numero_control ?? "—"}</td>
                <td className="px-4 py-2.5 text-center tabular-nums text-slate-600">#{c.numero_cuota}</td>
                <td className="px-4 py-2.5 text-slate-600">{venceLabel}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtGs(c.monto)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">{fmtGs(c.saldo)}</td>
                <td className="px-4 py-2.5 text-right">
                  {grupo !== "pagadas" && (
                    <button onClick={() => onPagar(c)} className="rounded-md bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91]">
                      Registrar pago
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "red" | "amber" | "teal" | "muted" }) {
  const tones: Record<string, string> = {
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    teal: "border-[#4FAEB2]/30 bg-[#4FAEB2]/[0.06] text-[#3F8E91]",
    muted: "border-slate-200 bg-white text-slate-800",
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] opacity-70">{sub}</p>}
    </div>
  );
}

function PagarModal({ cuota, onClose, onDone }: { cuota: Cuota; onClose: () => void; onDone: () => void }) {
  const [monto, setMonto] = useState(String(Math.round(cuota.saldo)));
  const [fecha, setFecha] = useState(hoyYmd());
  const [metodo, setMetodo] = useState("efectivo");
  const [referencia, setReferencia] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const m = Number(monto);
    if (!Number.isFinite(m) || m <= 0) { setError("Ingresá un monto válido."); return; }
    if (m > cuota.saldo + 0.01) { setError(`El monto supera el saldo (${fmtGs(cuota.saldo)}).`); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/cuentas-por-pagar/pagos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuota_id: cuota.id, monto: m, fecha_pago: fecha, metodo_pago: metodo, referencia: referencia.trim() || null }),
      });
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? `Error ${r.status}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el pago.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-4">
          <h3 className="text-base font-bold text-slate-800">Registrar pago — cuota #{cuota.numero_cuota}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {cuota.proveedor_nombre ?? "—"} · Compra {cuota.compra_numero_control ?? "—"} · Saldo: {fmtGs(cuota.saldo)}
          </p>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Monto a pagar</span>
            <input type="number" min={0} value={monto} onChange={(e) => setMonto(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-right tabular-nums focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none" />
            <span className="mt-1 block text-[11px] text-slate-500">Podés pagar el total o una parte (queda saldo pendiente).</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Fecha</span>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Método</span>
              <select value={metodo} onChange={(e) => setMetodo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none">
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="cheque">Cheque</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="otro">Otro</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Referencia <span className="text-slate-400 font-normal">(opcional)</span></span>
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="N° de comprobante / nota"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none" />
          </label>
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} disabled={loading} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
            <button onClick={submit} disabled={loading} className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-bold text-white hover:bg-[#3F8E91] disabled:opacity-50">
              {loading ? "Guardando…" : "Registrar pago"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
