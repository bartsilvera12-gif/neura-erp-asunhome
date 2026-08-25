"use client";

/**
 * Facturas provisorias de compra: se cargan productos durante el mes y, cuando
 * llega la factura real, se convierten en definitiva (genera cuotas por pagar).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Provisoria = {
  numero_control: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  moneda: string;
  total: number;
  items: number;
  fecha: string | null;
};

function fmtGs(n: number) {
  return `Gs. ${Math.round(n || 0).toLocaleString("es-PY")}`;
}
function hoyYmd() {
  return new Date().toISOString().slice(0, 10);
}

export default function ProvisoriasPage() {
  const [rows, setRows] = useState<Provisoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [convertir, setConvertir] = useState<Provisoria | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErr(null);
    try {
      const r = await fetchWithSupabaseSession("/api/compras/provisorias", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? `Error ${r.status}`);
      setRows((j.data?.provisorias ?? []) as Provisoria[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Facturas provisorias</h1>
          <p className="mt-1 text-sm text-slate-500">Compras en curso sin factura definitiva. Al convertir se generan las cuotas por pagar.</p>
        </div>
        <Link href="/compras/nueva" className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">
          Nueva compra
        </Link>
      </div>

      {err && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">N° control</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Proveedor</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Ítems</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Total</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Fecha</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-400">{cargando ? "Cargando…" : "No hay facturas provisorias."}</td></tr>
            ) : (
              rows.map((p) => (
                <tr key={p.numero_control} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-mono font-medium text-slate-800">{p.numero_control}</td>
                  <td className="px-4 py-3 text-slate-700">{p.proveedor_nombre ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{p.items}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800">{fmtGs(p.total)}</td>
                  <td className="px-4 py-3 text-slate-500">{p.fecha ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/compras/nueva?provisoria=${encodeURIComponent(p.numero_control)}`}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Agregar productos
                      </Link>
                      <button
                        onClick={() => setConvertir(p)}
                        className="rounded-md bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91]"
                      >
                        Convertir en definitiva
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {convertir && (
        <ConvertirModal
          provisoria={convertir}
          onClose={() => setConvertir(null)}
          onDone={() => { setConvertir(null); void cargar(); }}
        />
      )}
    </div>
  );
}

function ConvertirModal({
  provisoria,
  onClose,
  onDone,
}: {
  provisoria: Provisoria;
  onClose: () => void;
  onDone: () => void;
}) {
  const [numeroFactura, setNumeroFactura] = useState("");
  const [nroTimbrado, setNroTimbrado] = useState("");
  const [fechaFactura, setFechaFactura] = useState(hoyYmd());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!numeroFactura.trim()) { setError("Ingresá el N° de factura."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaFactura)) { setError("Ingresá la fecha de la factura."); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/compras/convertir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero_control: provisoria.numero_control,
          numero_factura: numeroFactura.trim(),
          nro_timbrado: nroTimbrado.trim() || null,
          fecha_factura: fechaFactura,
        }),
      });
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.error ?? `Error ${r.status}`);
      const c = j.data?.cuenta;
      alert(`Factura definitiva creada. Se generaron ${c?.cuotas ?? 0} cuota(s) por un total de ${fmtGs(Number(c?.total) || 0)}.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo convertir.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-4">
          <h3 className="text-base font-bold text-slate-800">Convertir {provisoria.numero_control} en definitiva</h3>
          <p className="mt-1 text-xs text-slate-500">
            Proveedor: {provisoria.proveedor_nombre ?? "—"} · Total: {fmtGs(provisoria.total)}. Se generarán las cuotas según la gracia y los plazos del proveedor.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">N° de factura</span>
            <input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} placeholder="Ej: 001-001-0000123"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">N° de timbrado <span className="text-slate-400 font-normal">(opcional)</span></span>
            <input value={nroTimbrado} onChange={(e) => setNroTimbrado(e.target.value)} placeholder="Ej: 12345678"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Fecha de la factura</span>
            <input type="date" value={fechaFactura} onChange={(e) => setFechaFactura(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 outline-none" />
            <span className="mt-1 block text-[11px] text-slate-500">Desde esta fecha se cuentan la gracia y los vencimientos de las cuotas.</span>
          </label>
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} disabled={loading} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
            <button onClick={submit} disabled={loading} className="rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-bold text-white hover:bg-[#3F8E91] disabled:opacity-50">
              {loading ? "Convirtiendo…" : "Convertir y generar cuotas"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
