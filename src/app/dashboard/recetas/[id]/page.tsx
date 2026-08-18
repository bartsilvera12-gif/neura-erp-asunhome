"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ChefHat, ArrowLeft, Plus, Trash2, Save, Loader2 } from "lucide-react";

type Receta = {
  id: string;
  producto_id: string;
  nombre: string | null;
  rendimiento_cantidad: number;
  rendimiento_unidad: string | null;
  notas: string | null;
  activa: boolean;
};
type Item = {
  id: string;
  insumo_producto_id: string;
  cantidad: number;
  unidad_medida: string | null;
  merma_pct: number;
  orden: number;
};
type Costeo = {
  costo_total: number;
  costo_unitario: number | null;
  precio_venta: number;
  margen_abs: number;
  margen_pct: number | null;
  unidades_posibles: number | null;
  items: Array<{
    item_id: string;
    insumo_nombre: string;
    cantidad: number;
    unidad_medida: string | null;
    merma_pct: number;
    costo_promedio: number;
    stock_actual: number;
    subcosto: number;
    unidades_aporte: number | null;
  }>;
};
type Producto = {
  id: string;
  nombre: string;
  sku: string;
  costo_promedio: number;
  stock_actual: number;
  unidad_medida: string | null;
};

function fmtGs(n: number | null | undefined) {
  if (n == null) return "—";
  return "Gs. " + Number(n).toLocaleString("es-PY", { maximumFractionDigits: 0 });
}

export default function EditarRecetaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [receta, setReceta] = useState<Receta | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [costeo, setCosteo] = useState<Costeo | null>(null);
  const [insumos, setInsumos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form add item
  const [newInsumoId, setNewInsumoId] = useState("");
  const [newCantidad, setNewCantidad] = useState<number>(1);
  const [newUnidad, setNewUnidad] = useState("");
  const [newMerma, setNewMerma] = useState<number>(0);
  const [addingItem, setAddingItem] = useState(false);

  const refresh = useCallback(async () => {
    const [recRes, prodRes] = await Promise.all([
      fetchWithSupabaseSession(`/api/recetas/${id}`, { cache: "no-store" }),
      fetchWithSupabaseSession(`/api/recetas/productos?filtro=insumos`, { cache: "no-store" }),
    ]);
    const recBody = await recRes.json();
    const prodBody = await prodRes.json();
    if (!recRes.ok || recBody?.success === false) {
      setError(recBody?.error ?? "Error al cargar receta");
      return;
    }
    setReceta(recBody.data.receta);
    setItems(recBody.data.items ?? []);
    setCosteo(recBody.data.costeo ?? null);
    if (prodRes.ok && prodBody?.success) {
      setInsumos((prodBody.data.productos ?? []) as Producto[]);
    }
  }, [id]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await refresh();
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  const insumosDisponibles = useMemo(() => {
    const usados = new Set(items.map((i) => i.insumo_producto_id));
    return insumos.filter((p) => !usados.has(p.id));
  }, [insumos, items]);

  useEffect(() => {
    if (insumosDisponibles.length > 0 && !newInsumoId) {
      setNewInsumoId(insumosDisponibles[0].id);
      setNewUnidad(insumosDisponibles[0].unidad_medida ?? "");
    }
  }, [insumosDisponibles, newInsumoId]);

  async function saveHeader() {
    if (!receta) return;
    setError(null);
    const res = await fetchWithSupabaseSession(`/api/recetas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: receta.nombre,
        rendimiento_cantidad: receta.rendimiento_cantidad,
        rendimiento_unidad: receta.rendimiento_unidad,
        notas: receta.notas,
        activa: receta.activa,
      }),
    });
    const body = await res.json();
    if (!res.ok || body?.success === false) {
      setError(body?.error ?? "Error al guardar");
      return;
    }
    await refresh();
  }

  async function addItem() {
    if (!newInsumoId || newCantidad <= 0) return;
    setAddingItem(true);
    try {
      const res = await fetchWithSupabaseSession(`/api/recetas/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insumo_producto_id: newInsumoId,
          cantidad: Number(newCantidad),
          unidad_medida: newUnidad.trim() || null,
          merma_pct: Number(newMerma) || 0,
        }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "Error al agregar item");
        return;
      }
      setNewInsumoId("");
      setNewCantidad(1);
      setNewUnidad("");
      setNewMerma(0);
      await refresh();
    } finally {
      setAddingItem(false);
    }
  }

  async function removeItem(itemId: string) {
    if (!confirm("¿Eliminar este insumo de la receta?")) return;
    const res = await fetchWithSupabaseSession(`/api/recetas/${id}/items/${itemId}`, {
      method: "DELETE",
    });
    const body = await res.json();
    if (!res.ok || body?.success === false) {
      setError(body?.error ?? "Error al eliminar");
      return;
    }
    await refresh();
  }

  async function deleteReceta() {
    if (!confirm("¿Eliminar receta completa? Esta acción no se puede deshacer.")) return;
    const res = await fetchWithSupabaseSession(`/api/recetas/${id}`, { method: "DELETE" });
    const body = await res.json();
    if (!res.ok || body?.success === false) {
      setError(body?.error ?? "Error al eliminar");
      return;
    }
    router.push("/dashboard/recetas");
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }
  if (!receta) {
    return (
      <div className="p-6">
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error ?? "Receta no encontrada"}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link
        href="/dashboard/recetas"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Volver
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ChefHat className="h-7 w-7 text-amber-600" />
          <h1 className="text-2xl font-semibold">
            {receta.nombre ?? "Receta"}
          </h1>
        </div>
        <button
          onClick={deleteReceta}
          className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700"
        >
          <Trash2 className="h-4 w-4" /> Eliminar receta
        </button>
      </div>

      {/* Costeo summary */}
      {costeo && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="rounded-md bg-white border border-gray-200 p-4">
            <div className="text-xs text-gray-500 uppercase">Costo total receta</div>
            <div className="text-lg font-semibold text-gray-900">{fmtGs(costeo.costo_total)}</div>
          </div>
          <div className="rounded-md bg-white border border-gray-200 p-4">
            <div className="text-xs text-gray-500 uppercase">Costo unitario</div>
            <div className="text-lg font-semibold text-gray-900">{fmtGs(costeo.costo_unitario)}</div>
          </div>
          <div className="rounded-md bg-white border border-gray-200 p-4">
            <div className="text-xs text-gray-500 uppercase">Margen</div>
            <div className={`text-lg font-semibold ${(costeo.margen_pct ?? 0) >= 0 ? "text-green-700" : "text-red-700"}`}>
              {costeo.margen_pct == null ? "—" : `${costeo.margen_pct}%`}
            </div>
            <div className="text-xs text-gray-500">{fmtGs(costeo.margen_abs)} / unidad</div>
          </div>
          <div className="rounded-md bg-white border border-gray-200 p-4">
            <div className="text-xs text-gray-500 uppercase">Unidades posibles</div>
            <div className="text-lg font-semibold text-gray-900">
              {costeo.unidades_posibles == null ? "—" : costeo.unidades_posibles}
            </div>
            <div className="text-xs text-gray-500">según stock de insumos</div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {/* Header form */}
      <div className="bg-white p-5 rounded-md border border-gray-200 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Datos de la receta</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre</label>
            <input
              type="text"
              value={receta.nombre ?? ""}
              onChange={(e) => setReceta({ ...receta, nombre: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rendimiento</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={receta.rendimiento_cantidad}
              onChange={(e) => setReceta({ ...receta, rendimiento_cantidad: Number(e.target.value) || 1 })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Unidad</label>
            <input
              type="text"
              value={receta.rendimiento_unidad ?? ""}
              onChange={(e) => setReceta({ ...receta, rendimiento_unidad: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={receta.activa}
                onChange={(e) => setReceta({ ...receta, activa: e.target.checked })}
                className="rounded"
              />
              Activa
            </label>
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Notas</label>
            <textarea
              value={receta.notas ?? ""}
              onChange={(e) => setReceta({ ...receta, notas: e.target.value })}
              rows={2}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <button
            onClick={saveHeader}
            className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          >
            <Save className="h-4 w-4" /> Guardar cambios
          </button>
        </div>
      </div>

      {/* Items */}
      <div className="bg-white p-5 rounded-md border border-gray-200">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Insumos</h2>

        {items.length === 0 && (
          <div className="text-sm text-gray-500 mb-3">
            Sin insumos todavía. Agregá insumos del inventario para calcular costo y disponibilidad.
          </div>
        )}

        {items.length > 0 && costeo && (
          <table className="w-full text-sm mb-4">
            <thead className="text-left text-xs text-gray-500 uppercase">
              <tr>
                <th className="py-2">Insumo</th>
                <th className="py-2">Cantidad</th>
                <th className="py-2">Unidad</th>
                <th className="py-2">Merma</th>
                <th className="py-2">Costo unit.</th>
                <th className="py-2">Subcosto</th>
                <th className="py-2">Stock</th>
                <th className="py-2">Unid. posibles</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {costeo.items.map((row) => (
                <tr key={row.item_id}>
                  <td className="py-2 font-medium text-gray-800">{row.insumo_nombre}</td>
                  <td className="py-2">{row.cantidad}</td>
                  <td className="py-2 text-gray-600">{row.unidad_medida ?? "—"}</td>
                  <td className="py-2 text-gray-600">{(row.merma_pct * 100).toFixed(0)}%</td>
                  <td className="py-2">{fmtGs(row.costo_promedio)}</td>
                  <td className="py-2">{fmtGs(row.subcosto)}</td>
                  <td className="py-2 text-gray-600">{row.stock_actual}</td>
                  <td className="py-2">{row.unidades_aporte ?? "—"}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => removeItem(row.item_id)}
                      className="text-red-600 hover:text-red-700"
                      aria-label="Eliminar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Add item */}
        <div className="border-t border-gray-200 pt-4">
          <div className="text-xs font-medium text-gray-600 mb-2">Agregar insumo</div>
          {insumosDisponibles.length === 0 ? (
            <div className="text-sm text-gray-500">
              No hay más insumos disponibles. Marcá productos como insumo (<code>es_insumo=true</code>) desde Inventario.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <select
                value={newInsumoId}
                onChange={(e) => {
                  setNewInsumoId(e.target.value);
                  const p = insumosDisponibles.find((x) => x.id === e.target.value);
                  if (p) setNewUnidad(p.unidad_medida ?? "");
                }}
                className="md:col-span-2 rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {insumosDisponibles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} — {fmtGs(p.costo_promedio)}/{p.unidad_medida ?? ""} (stock {p.stock_actual})
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={newCantidad}
                onChange={(e) => setNewCantidad(Number(e.target.value))}
                placeholder="Cantidad"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={newUnidad}
                onChange={(e) => setNewUnidad(e.target.value)}
                placeholder="Unidad"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                max="0.99"
                value={newMerma}
                onChange={(e) => setNewMerma(Number(e.target.value))}
                placeholder="Merma (0-0.99)"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                onClick={addItem}
                disabled={addingItem || !newInsumoId || newCantidad <= 0}
                className="md:col-span-5 inline-flex items-center justify-center gap-1 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> {addingItem ? "Agregando…" : "Agregar insumo"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
