"use client";

import type {
  CondicionPagoProveedor,
  EstadoProveedor,
  ProveedorCategoria,
} from "@/lib/proveedores/types";

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white text-sm";
const labelClass = "block text-sm font-medium text-slate-700 mb-1";

export interface ProveedorFormValues {
  nombre: string;
  nombre_comercial: string;
  razon_social: string;
  ruc: string;
  telefono: string;
  email: string;
  direccion: string;
  contacto: string;
  estado: EstadoProveedor;
  condicion_pago: CondicionPagoProveedor | "";
  plazo_pago_dias: string;
  moneda_preferida: "" | "GS" | "USD";
  observaciones: string;
  categoria_ids: string[];
}

export function emptyProveedorForm(): ProveedorFormValues {
  return {
    nombre: "",
    nombre_comercial: "",
    razon_social: "",
    ruc: "",
    telefono: "",
    email: "",
    direccion: "",
    contacto: "",
    estado: "activo",
    condicion_pago: "",
    plazo_pago_dias: "",
    moneda_preferida: "",
    observaciones: "",
    categoria_ids: [],
  };
}

export default function ProveedorForm({
  values,
  onChange,
  categorias,
  disabled,
}: {
  values: ProveedorFormValues;
  onChange: (next: ProveedorFormValues) => void;
  categorias: ProveedorCategoria[];
  disabled?: boolean;
}) {
  function patch<K extends keyof ProveedorFormValues>(key: K, v: ProveedorFormValues[K]) {
    onChange({ ...values, [key]: v });
  }

  function toggleCat(id: string) {
    const set = new Set(values.categoria_ids);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    patch("categoria_ids", [...set]);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Razón social / Nombre del proveedor *</label>
          <input
            className={`${inputClass} uppercase`}
            value={values.nombre}
            onChange={(e) => patch("nombre", e.target.value)}
            placeholder="Ej: DISTRIBUIDORA EJEMPLO S.A."
            disabled={disabled}
            required
          />
          <p className="mt-1 text-xs text-slate-400">
            Se guarda en mayúsculas para unificar reportes.
          </p>
        </div>
        <div>
          <label className={labelClass}>RUC</label>
          <input
            className={`${inputClass} uppercase`}
            value={values.ruc}
            onChange={(e) => patch("ruc", e.target.value)}
            placeholder="Opcional"
            disabled={disabled}
          />
        </div>
        <div>
          <label className={labelClass}>Nombre comercial (opcional)</label>
          <input
            className={`${inputClass} uppercase`}
            value={values.nombre_comercial}
            onChange={(e) => patch("nombre_comercial", e.target.value)}
            placeholder="Si difiere del razón social"
            disabled={disabled}
          />
        </div>
        <div>
          <label className={labelClass}>Teléfono</label>
          <input
            className={inputClass}
            value={values.telefono}
            onChange={(e) => patch("telefono", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div>
          <label className={labelClass}>Email</label>
          <input
            type="email"
            className={inputClass}
            value={values.email}
            onChange={(e) => patch("email", e.target.value.toLowerCase())}
            disabled={disabled}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Dirección</label>
          <input
            className={`${inputClass} uppercase`}
            value={values.direccion}
            onChange={(e) => patch("direccion", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div>
          <label className={labelClass}>Contacto principal</label>
          <input
            className={`${inputClass} uppercase`}
            value={values.contacto}
            onChange={(e) => patch("contacto", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div>
          <label className={labelClass}>Estado</label>
          <select
            className={inputClass}
            value={values.estado}
            onChange={(e) => patch("estado", e.target.value as EstadoProveedor)}
            disabled={disabled}
          >
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Condición de pago habitual</label>
          <select
            className={inputClass}
            value={values.condicion_pago}
            onChange={(e) => patch("condicion_pago", e.target.value as ProveedorFormValues["condicion_pago"])}
            disabled={disabled}
          >
            <option value="">— Sin definir —</option>
            <option value="contado">Contado</option>
            <option value="credito">Crédito</option>
            <option value="mixto">Mixto</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Plazo (días)</label>
          <input
            type="number"
            min={0}
            className={inputClass}
            value={values.plazo_pago_dias}
            onChange={(e) => patch("plazo_pago_dias", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div>
          <label className={labelClass}>Moneda preferida</label>
          <select
            className={inputClass}
            value={values.moneda_preferida}
            onChange={(e) => patch("moneda_preferida", e.target.value as ProveedorFormValues["moneda_preferida"])}
            disabled={disabled}
          >
            <option value="">—</option>
            <option value="GS">Guaraníes (GS)</option>
            <option value="USD">Dólares (USD)</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Observaciones</label>
          <textarea
            className={`${inputClass} min-h-[88px]`}
            value={values.observaciones}
            onChange={(e) => patch("observaciones", e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Categorías</p>
        {categorias.length === 0 ? (
          <p className="text-sm text-slate-500">
            No hay categorías aún.{" "}
            <a href="/proveedores/categorias" className="text-sky-600 underline">
              Crear en gestión de categorías
            </a>
            .
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categorias.filter((c) => c.activo || values.categoria_ids.includes(c.id)).map((c) => {
              const on = values.categoria_ids.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleCat(c.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    on
                      ? "bg-sky-500 border-sky-500 text-white"
                      : "bg-white border-slate-200 text-slate-600 hover:border-sky-300"
                  }`}
                >
                  {c.nombre}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
