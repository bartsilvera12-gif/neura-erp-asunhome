"use client";

/**
 * Editor de presentaciones de venta de un producto.
 *
 * Se monta en la pagina de editar producto. Lista todas las presentaciones
 * (activas e inactivas), permite crear/editar/desactivar y marcar default.
 *
 * Convencion clave:
 * - cantidad_base se interpreta en la unidad base del producto (la unidad_medida
 *   actual, que ya existia y default 'Unidad').
 * - precio_venta es opcional. Si null, la UI/POS computa precio sugerido como
 *   producto.precio_venta * cantidad_base.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Star,
  StarOff,
  Pencil,
  Trash2,
  Plus,
  X,
  Loader2,
  Check,
  AlertCircle,
} from "lucide-react";

interface Presentacion {
  id: string;
  nombre: string;
  cantidad_base: number;
  precio_venta: number | null;
  es_default: boolean;
  activo: boolean;
}

interface PresentacionesEditorProps {
  productoId: string;
  unidadBase: string;
  precioBase: number;
}

function fmtGs(n: number): string {
  return "Gs. " + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export default function PresentacionesEditor({
  productoId,
  unidadBase,
  precioBase,
}: PresentacionesEditorProps) {
  const [items, setItems] = useState<Presentacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Modal nuevo/editar
  const [editing, setEditing] = useState<Presentacion | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [fNombre, setFNombre] = useState("");
  const [fCantBase, setFCantBase] = useState("");
  const [fPrecio, setFPrecio] = useState("");
  const [fEsDefault, setFEsDefault] = useState(false);
  const [fActivo, setFActivo] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fError, setFError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/productos/${productoId}/presentaciones`, {
        credentials: "include",
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar.");
      setItems((j.data?.presentaciones ?? []) as Presentacion[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, [productoId]);

  useEffect(() => {
    if (productoId) load();
  }, [productoId, load]);

  function openCreate() {
    setIsCreating(true);
    setEditing(null);
    setFNombre("");
    setFCantBase("");
    setFPrecio("");
    setFEsDefault(items.length === 0);
    setFActivo(true);
    setFError(null);
  }
  function openEdit(p: Presentacion) {
    setIsCreating(false);
    setEditing(p);
    setFNombre(p.nombre);
    setFCantBase(String(p.cantidad_base));
    setFPrecio(p.precio_venta != null ? String(p.precio_venta) : "");
    setFEsDefault(p.es_default);
    setFActivo(p.activo);
    setFError(null);
  }
  function closeModal() {
    if (saving) return;
    setEditing(null);
    setIsCreating(false);
    setFError(null);
  }

  async function save() {
    setSaving(true);
    setFError(null);
    try {
      const body: Record<string, unknown> = {
        nombre: fNombre.trim(),
        cantidad_base: Number(fCantBase),
        precio_venta: fPrecio.trim() === "" ? null : Number(fPrecio),
        es_default: fEsDefault,
        activo: fActivo,
      };
      const url = isCreating
        ? `/api/productos/${productoId}/presentaciones`
        : `/api/productos/${productoId}/presentaciones/${editing!.id}`;
      const r = await fetch(url, {
        method: isCreating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setFError(j?.error ?? "No se pudo guardar.");
        return;
      }
      closeModal();
      setOkMsg(isCreating ? "Presentación creada" : "Cambios guardados");
      setTimeout(() => setOkMsg(null), 2500);
      await load();
    } catch (e) {
      setFError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setSaving(false);
    }
  }

  async function desactivar(p: Presentacion) {
    if (p.es_default) {
      setError("No podés desactivar la presentación por defecto. Marcá otra primero.");
      return;
    }
    const ok = window.confirm(`¿Desactivar la presentación "${p.nombre}"?`);
    if (!ok) return;
    try {
      const r = await fetch(
        `/api/productos/${productoId}/presentaciones/${p.id}`,
        { method: "DELETE", credentials: "include" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? "No se pudo desactivar.");
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    }
  }

  async function setDefault(p: Presentacion) {
    if (p.es_default) return;
    try {
      const r = await fetch(
        `/api/productos/${productoId}/presentaciones/${p.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ es_default: true }),
        }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setError(j?.error ?? "No se pudo marcar como default.");
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    }
  }

  const precioSugerido = useMemo(() => {
    const cb = Number(fCantBase);
    if (!Number.isFinite(cb) || cb <= 0) return null;
    return Math.round(precioBase * cb);
  }, [fCantBase, precioBase]);

  return (
    <div className="mt-5 pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 flex items-center gap-1.5">
            <Box className="w-3.5 h-3.5" />
            Presentaciones de venta
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Cómo se vende este producto. Unidad base:{" "}
            <span className="font-semibold text-slate-700">{unidadBase || "Unidad"}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-white hover:bg-sky-600 border border-sky-200 hover:border-sky-600 px-2.5 py-1.5 rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Nueva
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {okMsg && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          <Check className="w-3.5 h-3.5" />
          {okMsg}
        </div>
      )}

      {loading ? (
        <div className="py-6 text-center">
          <Loader2 className="w-4 h-4 animate-spin text-slate-400 mx-auto" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-500 bg-slate-50 rounded-lg">
          Sin presentaciones todavía. Creá al menos una para vender este producto.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((p) => {
            const precioMostrar =
              p.precio_venta != null
                ? p.precio_venta
                : Math.round(precioBase * p.cantidad_base);
            return (
              <li
                key={p.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                  p.activo
                    ? "border-slate-200 bg-white"
                    : "border-slate-200 bg-slate-50 opacity-60"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setDefault(p)}
                  disabled={!p.activo || p.es_default}
                  className={`flex-none ${
                    p.es_default
                      ? "text-amber-500"
                      : "text-slate-300 hover:text-amber-500 disabled:hover:text-slate-300"
                  }`}
                  title={p.es_default ? "Default" : "Marcar como default"}
                >
                  {p.es_default ? (
                    <Star className="w-4 h-4 fill-current" />
                  ) : (
                    <StarOff className="w-4 h-4" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800">
                      {p.nombre}
                    </span>
                    {p.es_default && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                        Default
                      </span>
                    )}
                    {!p.activo && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
                        Inactiva
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    1 {p.nombre} ={" "}
                    <span className="font-mono font-semibold text-slate-700">
                      {p.cantidad_base}
                    </span>{" "}
                    {unidadBase || "Unidad"}
                    {" · "}
                    <span className="font-semibold text-slate-700">
                      {fmtGs(precioMostrar)}
                    </span>
                    {p.precio_venta == null && (
                      <span className="text-slate-400"> (sugerido)</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="text-slate-500 hover:text-sky-700 p-1.5 rounded hover:bg-sky-50"
                    title="Editar"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {p.activo && (
                    <button
                      type="button"
                      onClick={() => desactivar(p)}
                      disabled={p.es_default}
                      className="text-slate-500 hover:text-red-600 disabled:opacity-40 disabled:hover:text-slate-500 p-1.5 rounded hover:bg-red-50 disabled:hover:bg-transparent"
                      title={p.es_default ? "No se puede desactivar el default" : "Desactivar"}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Modal de alta/edicion */}
      {(isCreating || editing) && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-5 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {isCreating ? "Nueva presentación" : "Editar presentación"}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Unidad base: {unidadBase || "Unidad"}
                </p>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                  Nombre
                </label>
                <input
                  type="text"
                  value={fNombre}
                  onChange={(e) => setFNombre(e.target.value)}
                  placeholder="Ej: Caja, Paquete, Blister"
                  maxLength={60}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                  Equivalencia
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">1 {fNombre.trim() || "presentación"} =</span>
                  <input
                    type="number"
                    min={0.0001}
                    step="any"
                    value={fCantBase}
                    onChange={(e) => setFCantBase(e.target.value)}
                    className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent text-right tabular-nums"
                  />
                  <span className="text-sm text-slate-600">{unidadBase || "Unidad"}</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Cuántas unidades base equivale 1 unidad de esta presentación.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
                  Precio (opcional)
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={fPrecio}
                  onChange={(e) => setFPrecio(e.target.value)}
                  placeholder={
                    precioSugerido != null ? `Sugerido: ${fmtGs(precioSugerido)}` : "Sugerido"
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Si dejás vacío, la caja usará el precio sugerido (precio base × equivalencia).
                </p>
              </div>

              <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fEsDefault}
                    onChange={(e) => setFEsDefault(e.target.checked)}
                    className="rounded"
                  />
                  Presentación por defecto
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fActivo}
                    onChange={(e) => setFActivo(e.target.checked)}
                    disabled={editing?.es_default && fEsDefault}
                    className="rounded"
                  />
                  Activa
                </label>
              </div>

              {fError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
                  {fError}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 p-5 pt-3 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
              <button
                onClick={closeModal}
                disabled={saving}
                className="text-sm font-semibold text-slate-600 hover:text-slate-900 px-4 py-2"
              >
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving || !fNombre.trim() || !fCantBase}
                className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
