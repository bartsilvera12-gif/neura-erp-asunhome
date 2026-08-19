"use client";

import { useEffect, useState } from "react";

type HistorialItem = {
  compra_id: string;
  numero_control: string;
  fecha: string;
  cantidad: number;
  costo_unitario: number;
  costo_unitario_original: number;
  moneda: string;
  tipo_cambio: number;
  total: number;
  origen: "compra";
  tiene_comprobante: boolean;
};
type ProveedorCosto = {
  proveedor_id: string;
  proveedor_nombre: string;
  marca: string | null;
  ultimo_costo: number;
  ultima_fecha: string;
  moneda_ultimo_costo: string;
  costo_unitario_original_ultimo: number;
  tipo_cambio_ultimo: number;
  costo_minimo: number;
  costo_promedio: number;
  cantidad_compras: number;
  historial: HistorialItem[];
};

function gs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function fecha(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}

export default function ProveedoresCostos({ productoId }: { productoId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proveedores, setProveedores] = useState<ProveedorCosto[]>([]);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [editando, setEditando] = useState<string | null>(null); // proveedor_id en edición
  const [marcaInput, setMarcaInput] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorMarca, setErrorMarca] = useState<string | null>(null);

  useEffect(() => {
    if (!productoId) return;
    let cancel = false;
    setLoading(true);
    setError(null);
    fetch(`/api/productos/${productoId}/proveedores-costos`, { credentials: "include", cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (cancel) return;
        if (!r.ok || !j?.success) {
          setError((j as { error?: string })?.error ?? "No se pudo cargar el historial.");
          setProveedores([]);
        } else {
          setProveedores(((j.data as { proveedores?: ProveedorCosto[] }).proveedores ?? []) as ProveedorCosto[]);
        }
      })
      .catch((e) => { if (!cancel) setError(e instanceof Error ? e.message : "Error de red"); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [productoId]);

  function toggle(id: string) {
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function abrirEdicion(proveedorId: string, marcaActual: string | null) {
    setEditando(proveedorId);
    setMarcaInput(marcaActual ?? "");
    setErrorMarca(null);
  }

  function cancelarEdicion() {
    setEditando(null);
    setMarcaInput("");
    setErrorMarca(null);
  }

  async function guardarMarca(proveedorId: string) {
    if (!proveedorId) return;
    setGuardando(true);
    setErrorMarca(null);
    const nueva = marcaInput.trim() === "" ? null : marcaInput.trim();
    try {
      const r = await fetch(
        `/api/productos/${productoId}/proveedores-costos/${proveedorId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ marca: nueva }),
        }
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) {
        setErrorMarca((j as { error?: string })?.error ?? "No se pudo guardar la marca.");
        return;
      }
      const marcaGuardada = (j.data as { marca?: string | null })?.marca ?? null;
      setProveedores((prev) =>
        prev.map((p) => (p.proveedor_id === proveedorId ? { ...p, marca: marcaGuardada } : p))
      );
      setEditando(null);
      setMarcaInput("");
    } catch (e) {
      setErrorMarca(e instanceof Error ? e.message : "Error de red");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]" style={{ boxShadow: "0 0 0 3px rgba(79,174,178,0.18)" }} />
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Zentra · Abastecimiento</p>
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-slate-900">Proveedores y costos</h2>
      <p className="mt-0.5 text-xs text-slate-500">Costos históricos derivados de compras reales registradas.</p>

      <div className="mt-4">
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-400">Cargando historial…</p>
        ) : error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {error}
          </div>
        ) : proveedores.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400">
            Todavía no hay compras registradas para este producto.
          </div>
        ) : (
          <div className="space-y-3">
            {proveedores.map((p) => {
              const key = p.proveedor_id || p.proveedor_nombre;
              const abierto = abiertos.has(key);
              return (
                <div key={key} className="rounded-xl border border-slate-200 overflow-hidden">
                  {/* Cabecera del proveedor */}
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/60 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-800">{p.proveedor_nombre || "Sin proveedor"}</p>
                      <p className="text-xs text-slate-500">
                        {p.cantidad_compras} {p.cantidad_compras === 1 ? "compra" : "compras"} · última {fecha(p.ultima_fecha)}
                      </p>
                      {/* Marca por proveedor */}
                      {p.proveedor_id && (
                        editando === p.proveedor_id ? (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Marca</span>
                            <input
                              type="text"
                              value={marcaInput}
                              onChange={(e) => setMarcaInput(e.target.value)}
                              placeholder="Ej: Natural Life"
                              maxLength={120}
                              autoFocus
                              disabled={guardando}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); guardarMarca(p.proveedor_id); }
                                if (e.key === "Escape") { e.preventDefault(); cancelarEdicion(); }
                              }}
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 focus:border-[#4FAEB2] focus:outline-none focus:ring-1 focus:ring-[#4FAEB2]/40"
                            />
                            <button
                              type="button"
                              onClick={() => guardarMarca(p.proveedor_id)}
                              disabled={guardando}
                              className="rounded-md bg-[#4FAEB2] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#3F8E91] disabled:opacity-60"
                            >
                              {guardando ? "Guardando…" : "Guardar"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelarEdicion}
                              disabled={guardando}
                              className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-60"
                            >
                              Cancelar
                            </button>
                            {errorMarca && <span className="text-xs text-red-600">{errorMarca}</span>}
                          </div>
                        ) : (
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Marca</span>
                            {p.marca ? (
                              <span className="rounded-full bg-[#4FAEB2]/10 px-2 py-0.5 text-xs font-medium text-[#3F8E91]">{p.marca}</span>
                            ) : (
                              <span className="text-xs text-slate-400">Sin marca</span>
                            )}
                            <button
                              type="button"
                              onClick={() => abrirEdicion(p.proveedor_id, p.marca)}
                              className="text-xs font-medium text-[#4FAEB2] hover:text-[#3F8E91] hover:underline"
                            >
                              {p.marca ? "Editar" : "Agregar marca"}
                            </button>
                          </div>
                        )
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-[#3F8E91] transition-colors hover:border-[#4FAEB2]/60 hover:bg-[#4FAEB2]/5"
                    >
                      {abierto ? "Ocultar historial" : "Ver historial"}
                    </button>
                  </div>

                  {/* Métricas */}
                  <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
                    <Metric label="Último costo" value={gs(p.ultimo_costo)} accent
                      sub={p.moneda_ultimo_costo === "USD" ? `USD ${p.costo_unitario_original_ultimo.toLocaleString("es-PY")}` : undefined} />
                    <Metric label="Costo mínimo" value={gs(p.costo_minimo)} />
                    <Metric label="Costo promedio" value={gs(p.costo_promedio)} />
                    <Metric label="Compras" value={String(p.cantidad_compras)} />
                  </div>

                  {/* Historial */}
                  {abierto && (
                    <div className="overflow-x-auto border-t border-slate-200">
                      <table className="w-full min-w-[560px] text-left text-sm">
                        <thead className="bg-white text-gray-500">
                          <tr>
                            <th className="py-2 px-4 font-medium">Fecha</th>
                            <th className="py-2 px-4 font-medium">N° Control</th>
                            <th className="py-2 px-4 font-medium text-right">Cant.</th>
                            <th className="py-2 px-4 font-medium text-right">Costo unit.</th>
                            <th className="py-2 px-4 font-medium text-right">Total</th>
                            <th className="py-2 px-4 font-medium">Origen</th>
                            <th className="py-2 px-4 font-medium">Comprobante</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.historial.map((h) => (
                            <tr key={h.compra_id} className="border-t border-slate-100">
                              <td className="py-2 px-4 tabular-nums text-gray-600">{fecha(h.fecha)}</td>
                              <td className="py-2 px-4 font-mono text-xs text-gray-500">{h.numero_control}</td>
                              <td className="py-2 px-4 text-right tabular-nums text-gray-700">{h.cantidad}</td>
                              <td className="py-2 px-4 text-right tabular-nums text-gray-700">
                                {gs(h.costo_unitario)}
                                {h.moneda === "USD" && (
                                  <span className="block text-[11px] text-gray-400">USD {h.costo_unitario_original.toLocaleString("es-PY")}</span>
                                )}
                              </td>
                              <td className="py-2 px-4 text-right tabular-nums font-medium text-gray-800">{gs(h.total)}</td>
                              <td className="py-2 px-4">
                                <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Compra real</span>
                              </td>
                              <td className="py-2 px-4">
                                {h.tiene_comprobante ? (
                                  <a
                                    href={`/api/compras/comprobante?numero_control=${encodeURIComponent(h.numero_control)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-medium text-[#4FAEB2] hover:text-[#3F8E91] hover:underline"
                                  >
                                    📎 Ver comprobante
                                  </a>
                                ) : (
                                  <span className="text-xs text-gray-300">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums ${accent ? "text-[#3F8E91]" : "text-slate-700"}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}
