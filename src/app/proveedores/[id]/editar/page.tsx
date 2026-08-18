"use client";

import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import ProveedorForm, { emptyProveedorForm, type ProveedorFormValues } from "@/app/proveedores/ProveedorForm";
import { getProveedor, getCategoriasProveedor, updateProveedor } from "@/lib/proveedores/storage";
import type { ProveedorCategoria } from "@/lib/proveedores/types";

export default function EditarProveedorPage() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const [form, setForm] = useState<ProveedorFormValues>(emptyProveedorForm);
  const [categorias, setCategorias] = useState<ProveedorCategoria[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    setLoading(true);
    Promise.all([getProveedor(id), getCategoriasProveedor({ todas: true })]).then(([p, cats]) => {
      if (cancel) return;
      setCategorias(cats);
      if (!p) {
        setError("Proveedor no encontrado.");
        setLoading(false);
        return;
      }
      setForm({
        nombre: p.nombre,
        nombre_comercial: p.nombre_comercial ?? "",
        razon_social: p.razon_social ?? "",
        ruc: p.ruc ?? "",
        telefono: p.telefono ?? "",
        email: p.email ?? "",
        direccion: p.direccion ?? "",
        contacto: p.contacto ?? "",
        estado: p.estado,
        condicion_pago: p.condicion_pago ?? "",
        plazo_pago_dias: p.plazo_pago_dias != null ? String(p.plazo_pago_dias) : "",
        moneda_preferida: p.moneda_preferida ?? "",
        observaciones: p.observaciones ?? "",
        categoria_ids: (p.categorias ?? []).map((c) => c.id),
      });
      setLoading(false);
    });
    return () => {
      cancel = true;
    };
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.nombre.trim()) {
      setError("Completá el nombre.");
      return;
    }
    setSaving(true);
    const res = await updateProveedor(id, {
      nombre: form.nombre.trim(),
      nombre_comercial: form.nombre_comercial.trim() || null,
      razon_social: form.razon_social.trim() || null,
      ruc: form.ruc.trim() || null,
      telefono: form.telefono.trim() || null,
      email: form.email.trim() || null,
      direccion: form.direccion.trim() || null,
      contacto: form.contacto.trim() || null,
      estado: form.estado,
      condicion_pago: form.condicion_pago === "" ? null : form.condicion_pago,
      plazo_pago_dias:
        form.plazo_pago_dias.trim() === "" ? null : parseInt(form.plazo_pago_dias, 10),
      moneda_preferida: form.moneda_preferida === "" ? null : form.moneda_preferida,
      observaciones: form.observaciones.trim() || null,
      categoria_ids: form.categoria_ids,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push("/proveedores");
  }

  if (!id) {
    return <p className="text-red-600">ID inválido.</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/proveedores" className="text-sm text-sky-600 hover:underline">
          ← Proveedores
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-gray-800">Editar proveedor</h1>
      </div>

      {loading ? (
        <p className="text-slate-500">Cargando…</p>
      ) : (
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
          <ProveedorForm values={form} onChange={setForm} categorias={categorias} disabled={saving} />
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#0EA5E9] px-5 py-2 text-sm font-medium text-white hover:bg-[#0284C7] disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
            <Link
              href="/proveedores"
              className="rounded-lg border border-slate-200 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
