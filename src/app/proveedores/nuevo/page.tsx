"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ProveedorForm, { emptyProveedorForm, type ProveedorFormValues } from "@/app/proveedores/ProveedorForm";
import { createProveedor, getCategoriasProveedor } from "@/lib/proveedores/storage";
import type { ProveedorCategoria } from "@/lib/proveedores/types";

export default function NuevoProveedorPage() {
  const router = useRouter();
  const [form, setForm] = useState<ProveedorFormValues>(emptyProveedorForm);
  const [categorias, setCategorias] = useState<ProveedorCategoria[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCategoriasProveedor({ todas: true }).then(setCategorias);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.nombre.trim()) {
      setError("Completá el nombre.");
      return;
    }
    setSaving(true);
    const payload = {
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
    };
    const res = await createProveedor(payload);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push("/proveedores");
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/proveedores" className="text-sm text-sky-600 hover:underline">
          ← Proveedores
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-gray-800">Nuevo proveedor</h1>
        <p className="text-gray-600">Los datos se guardan en la base de tu empresa.</p>
      </div>

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
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <Link
            href="/proveedores"
            className="rounded-lg border border-slate-200 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
