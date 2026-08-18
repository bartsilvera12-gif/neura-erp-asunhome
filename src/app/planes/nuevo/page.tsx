"use client";

import Link from "next/link";
import { useState } from "react";
import MontoInput from "@/components/ui/MontoInput";
import { useRouter } from "next/navigation";
import { savePlan } from "@/lib/planes/storage";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fLabelClass = "block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1";
const fInputClass =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white";
const fSelectClass =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider border-b border-gray-100 pb-2 mb-4">
      {children}
    </h3>
  );
}

// ── Formulario ────────────────────────────────────────────────────────────────

export default function NuevoPlanPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    nombre:           "",
    descripcion:      "",
    precio:           "",
    moneda:           "GS" as "GS" | "USD",
    periodicidad:     "mensual" as "mensual" | "anual" | "unico",
    limite_usuarios:  "",
    limite_clientes:  "",
    limite_facturas:  "",
    estado:           "activo" as "activo" | "inactivo",
  });

  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    const upper = ["nombre"];
    setForm((prev) => ({
      ...prev,
      [name]: upper.includes(name) ? value.toUpperCase() : value,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.nombre.trim())  { setError("El nombre del plan es obligatorio."); return; }
    if (!form.precio || parseFloat(form.precio) <= 0) {
      setError("El precio debe ser mayor a 0."); return;
    }

    setGuardando(true);
    try {
      const guardado = await savePlan({
        nombre:          form.nombre.trim(),
        descripcion:     form.descripcion.trim() || undefined,
        precio:          parseFloat(form.precio),
        moneda:          form.moneda,
        periodicidad:    form.periodicidad,
        limite_usuarios: form.limite_usuarios ? parseInt(form.limite_usuarios, 10) : null,
        limite_clientes: form.limite_clientes ? parseInt(form.limite_clientes, 10) : null,
        limite_facturas: form.limite_facturas ? parseInt(form.limite_facturas, 10) : null,
        estado:          form.estado,
      });

      if (!guardado.ok) {
        setError(guardado.error);
        return;
      }
      router.push("/planes");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/planes" className="hover:text-gray-700 transition-colors">Planes</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Nuevo plan</span>
      </div>

      {/* Título */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nuevo plan</h1>
        <p className="text-sm text-gray-500 mt-1">
          El código se generará automáticamente al guardar.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">

        {/* Información general */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <SectionTitle>Información general</SectionTitle>
          <div className="space-y-4">

            <div>
              <label className={fLabelClass}>Nombre del plan *</label>
              <input
                type="text"
                name="nombre"
                value={form.nombre}
                onChange={handleChange}
                placeholder="Ej: BÁSICO, PROFESIONAL, ENTERPRISE"
                className={`${fInputClass} uppercase`}
                required
              />
            </div>

            <div>
              <label className={fLabelClass}>Descripción</label>
              <textarea
                name="descripcion"
                value={form.descripcion}
                onChange={handleChange}
                placeholder="Descripción breve del plan y sus beneficios…"
                rows={3}
                className={fInputClass}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={fLabelClass}>Estado</label>
                <select name="estado" value={form.estado} onChange={handleChange} className={fSelectClass}>
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Precios */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <SectionTitle>Precio y periodicidad</SectionTitle>
          <div className="grid grid-cols-3 gap-4">

            <div>
              <label className={fLabelClass}>Precio *</label>
              <MontoInput
                value={form.precio}
                onChange={(n) => setForm((p) => ({ ...p, precio: String(n) }))}
                placeholder="0"
                className={fInputClass}
                decimals={form.moneda === "USD"}
                required
              />
            </div>

            <div>
              <label className={fLabelClass}>Moneda</label>
              <select name="moneda" value={form.moneda} onChange={handleChange} className={fSelectClass}>
                <option value="GS">Guaraníes (GS)</option>
                <option value="USD">Dólares (USD)</option>
              </select>
            </div>

            <div>
              <label className={fLabelClass}>Periodicidad</label>
              <select name="periodicidad" value={form.periodicidad} onChange={handleChange} className={fSelectClass}>
                <option value="mensual">Mensual</option>
                <option value="anual">Anual</option>
                <option value="unico">Único (pago único)</option>
              </select>
            </div>
          </div>
        </section>

        {/* Límites */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <SectionTitle>Límites del plan</SectionTitle>
          <p className="text-xs text-gray-400 mb-4">
            Dejar en blanco para indicar que el límite es <strong>ilimitado</strong>.
          </p>
          <div className="grid grid-cols-3 gap-4">

            <div>
              <label className={fLabelClass}>Límite de usuarios</label>
              <input
                type="number"
                name="limite_usuarios"
                value={form.limite_usuarios}
                onChange={handleChange}
                min={1}
                step="1"
                placeholder="Ilimitado"
                className={fInputClass}
              />
            </div>

            <div>
              <label className={fLabelClass}>Límite de clientes</label>
              <input
                type="number"
                name="limite_clientes"
                value={form.limite_clientes}
                onChange={handleChange}
                min={1}
                step="1"
                placeholder="Ilimitado"
                className={fInputClass}
              />
            </div>

            <div>
              <label className={fLabelClass}>Límite de facturas</label>
              <input
                type="number"
                name="limite_facturas"
                value={form.limite_facturas}
                onChange={handleChange}
                min={1}
                step="1"
                placeholder="Ilimitado"
                className={fInputClass}
              />
            </div>
          </div>
        </section>

        {/* Acciones */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={guardando}
            className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {guardando ? "Guardando…" : "Guardar plan"}
          </button>
          <Link
            href="/planes"
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors px-4 py-2.5"
          >
            Cancelar
          </Link>
        </div>

      </form>
    </div>
  );
}
