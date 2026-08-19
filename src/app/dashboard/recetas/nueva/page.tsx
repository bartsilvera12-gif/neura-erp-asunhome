"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ChefHat, ArrowLeft, Loader2 } from "lucide-react";
import { NEURA_CLIENT_SCHEMA } from "@/lib/supabase/schema";

/** Reserva monocliente: la receta pertenece al producto; el nombre se autogenera. */
const RECETA_SIMPLE = NEURA_CLIENT_SCHEMA === "reservacaacupe";

type Producto = {
  id: string;
  nombre: string;
  sku: string;
  precio_venta: number;
  unidad_medida: string | null;
};

export default function NuevaRecetaPage() {
  const router = useRouter();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [productoId, setProductoId] = useState("");
  const [nombre, setNombre] = useState("");
  const [rendCantidad, setRendCantidad] = useState(1);
  const [rendUnidad, setRendUnidad] = useState("");
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithSupabaseSession(
          "/api/recetas/productos?filtro=vendibles-sin-receta",
          { cache: "no-store" }
        );
        const body = await res.json();
        if (cancelled) return;
        if (res.ok && body?.success) {
          const list = (body.data?.productos ?? []) as Producto[];
          setProductos(list);
          if (list.length > 0) {
            setProductoId(list[0].id);
            setRendUnidad(list[0].unidad_medida ?? "");
          }
        } else {
          setError(body?.error ?? "Error al cargar productos");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productoId) {
      setError("Elegí un producto.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/recetas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          producto_id: productoId,
          nombre: nombre.trim() || null,
          rendimiento_cantidad: Number(rendCantidad) || 1,
          rendimiento_unidad: rendUnidad.trim() || null,
          notas: notas.trim() || null,
          activa: true,
        }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error ?? "Error al crear");
      }
      router.push(`/dashboard/recetas/${body.data.receta.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear");
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link
        href="/dashboard/recetas"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Volver
      </Link>
      <div className="flex items-center gap-3 mb-6">
        <ChefHat className="h-7 w-7 text-amber-600" />
        <h1 className="text-2xl font-semibold">Nueva receta</h1>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando productos…
        </div>
      )}

      {!loading && productos.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <ChefHat className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-700">
            Todos los productos del Menú ya tienen una receta.
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Para crear una nueva receta, primero creá un producto de tipo Menú sin receta, o editá una receta existente.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link
              href="/inventario/nuevo"
              className="inline-flex items-center rounded-lg bg-[#4FAEB2] px-4 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] transition-colors"
            >
              Ir a Inventario
            </Link>
            <Link
              href="/dashboard/recetas"
              className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Ver recetas existentes
            </Link>
          </div>
        </div>
      )}

      {!loading && productos.length > 0 && (
        <form onSubmit={handleSubmit} className="space-y-4 bg-white p-6 rounded-md border border-gray-200">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Producto del menú <span className="text-red-500">*</span>
            </label>
            <select
              value={productoId}
              onChange={(e) => {
                setProductoId(e.target.value);
                const p = productos.find((x) => x.id === e.target.value);
                if (p) setRendUnidad(p.unidad_medida ?? "");
              }}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            >
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} ({p.sku})
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-gray-400">
              Solo productos elaborados / de menú. Los de reventa y la materia prima no llevan receta.
            </p>
          </div>

          {!RECETA_SIMPLE && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre (opcional, override)
            </label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Pizza muzzarella grande"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Rendimiento cantidad
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={rendCantidad}
                onChange={(e) => setRendCantidad(Number(e.target.value))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Unidad
              </label>
              <input
                type="text"
                value={rendUnidad}
                onChange={(e) => setRendUnidad(e.target.value)}
                placeholder="Unidad"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notas
            </label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Link
              href="/dashboard/recetas"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              disabled={saving || !productoId}
              className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {saving ? "Creando…" : "Crear y editar insumos"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
