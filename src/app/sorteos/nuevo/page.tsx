"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSorteo } from "@/lib/sorteos/actions";
import type { SorteoCouponNumberMode, SorteoEstado } from "@/lib/sorteos/types";

export default function NuevoSorteoPage() {
  const router = useRouter();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [precio, setPrecio] = useState(0);
  const [maxBoletos, setMaxBoletos] = useState(100);
  const [fechaSorteo, setFechaSorteo] = useState("");
  const [estado, setEstado] = useState<SorteoEstado>("activo");
  const [imagenUrl, setImagenUrl] = useState("");
  const [datosBancarios, setDatosBancarios] = useState("{}");
  const [couponNumberingEnabled, setCouponNumberingEnabled] = useState(false);
  const [couponStart, setCouponStart] = useState(0);
  const [couponMode, setCouponMode] = useState<SorteoCouponNumberMode>("correlative");
  const [couponLimit, setCouponLimit] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const nombreTrim = nombre.trim();
    if (!nombreTrim) {
      setError("El nombre del sorteo es obligatorio.");
      return;
    }
    if (!Number.isFinite(precio) || precio < 0) {
      setError("El precio por boleto debe ser un número válido mayor o igual a 0.");
      return;
    }
    if (!Number.isFinite(maxBoletos) || maxBoletos < 1) {
      setError("El máximo de boletos debe ser al menos 1.");
      return;
    }
    if (couponNumberingEnabled) {
      if (!Number.isFinite(couponStart) || couponStart < 0) {
        setError("El número inicial de cupón debe ser un entero mayor o igual a 0.");
        return;
      }
      if (couponMode === "random") {
        const lim = couponLimit.trim() === "" ? NaN : Number(couponLimit);
        if (!Number.isFinite(lim)) {
          setError("En modo aleatorio el límite máximo es obligatorio.");
          return;
        }
        if (lim < couponStart) {
          setError("El límite máximo debe ser mayor o igual al número inicial.");
          return;
        }
      }
      if (couponMode === "correlative" && couponLimit.trim() !== "") {
        const lim = Number(couponLimit);
        if (!Number.isFinite(lim) || lim < couponStart) {
          setError("El límite máximo debe ser mayor o igual al número inicial.");
          return;
        }
      }
    }

    let json: Record<string, unknown> = {};
    try {
      json = datosBancarios.trim() ? (JSON.parse(datosBancarios) as Record<string, unknown>) : {};
    } catch {
      setError("Datos bancarios: el JSON no es válido.");
      return;
    }

    let fechaIso: string | null = null;
    if (fechaSorteo.trim()) {
      const d = new Date(fechaSorteo);
      if (Number.isNaN(d.getTime())) {
        setError("La fecha del sorteo no es válida.");
        return;
      }
      fechaIso = d.toISOString();
    }

    setGuardando(true);
    try {
      const row = await createSorteo({
        nombre: nombreTrim,
        descripcion,
        precio_por_boleto: precio,
        max_boletos: maxBoletos,
        fecha_sorteo: fechaIso,
        estado,
        datos_bancarios: json,
        imagen_url: imagenUrl.trim() || null,
        coupon_numbering_enabled: couponNumberingEnabled,
        coupon_number_start: couponNumberingEnabled ? Math.trunc(couponStart) : null,
        coupon_number_mode: couponNumberingEnabled ? couponMode : null,
        coupon_number_limit:
          couponNumberingEnabled && couponLimit.trim() !== ""
            ? Math.trunc(Number(couponLimit))
            : null,
      });
      setSuccess("Sorteo creado. Redirigiendo al editor…");
      router.push(`/sorteos/${row.id}/editar`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
      console.error("[nuevo sorteo]", err);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/sorteos" className="hover:text-slate-800">
          Sorteos
        </Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">Nuevo</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-800">Nuevo sorteo</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-2" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm rounded-lg px-4 py-2" role="status">
          {success}
        </div>
      )}

      <form noValidate onSubmit={handleSubmit} className="space-y-4 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Nombre</label>
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Descripción</label>
          <textarea
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[80px]"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Precio por boleto (₲)</label>
            <input
              type="number"
              min={0}
              step={1}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={Number.isFinite(precio) ? precio : ""}
              onChange={(e) => {
                const v = e.target.value;
                setPrecio(v === "" ? 0 : Number(v));
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Máx. boletos</label>
            <input
              type="number"
              min={1}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={Number.isFinite(maxBoletos) ? maxBoletos : ""}
              onChange={(e) => {
                const v = e.target.value;
                setMaxBoletos(v === "" ? 0 : Number(v));
              }}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fecha del sorteo</label>
            <input
              type="datetime-local"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={fechaSorteo}
              onChange={(e) => setFechaSorteo(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Estado</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={estado}
              onChange={(e) => setEstado(e.target.value as SorteoEstado)}
            >
              <option value="activo">activo</option>
              <option value="pausado">pausado</option>
              <option value="cerrado">cerrado</option>
              <option value="finalizado">finalizado</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">URL imagen</label>
          <input
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            value={imagenUrl}
            onChange={(e) => setImagenUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>

        <div className="border border-slate-200 rounded-lg p-4 space-y-3 bg-slate-50/50">
          <h2 className="text-sm font-semibold text-slate-800">Numeración de cupones</h2>
          <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={couponNumberingEnabled}
              onChange={(e) => setCouponNumberingEnabled(e.target.checked)}
              className="rounded border-slate-300"
            />
            Personalizar numeración de cupones
          </label>
          <p className="text-xs text-slate-500">
            Esta configuración solo afecta nuevos cupones generados desde este sorteo. No modifica cupones ya emitidos.
          </p>
          {couponNumberingEnabled ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Número inicial</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="0"
                  className="w-full max-w-xs border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={Number.isFinite(couponStart) ? couponStart : 0}
                  onChange={(e) => setCouponStart(e.target.value === "" ? 0 : Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Modo de generación</label>
                <select
                  className="w-full max-w-xs border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={couponMode}
                  onChange={(e) => setCouponMode(e.target.value as SorteoCouponNumberMode)}
                >
                  <option value="correlative">Correlativo</option>
                  <option value="random">Aleatorio</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Límite máximo
                  {couponMode === "random" ? (
                    <span className="text-amber-700"> (obligatorio en aleatorio)</span>
                  ) : (
                    <span className="text-slate-400"> (opcional en correlativo)</span>
                  )}
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="w-full max-w-xs border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={couponLimit}
                  onChange={(e) => setCouponLimit(e.target.value)}
                  placeholder={couponMode === "random" ? "Ej. 9999" : "Sin tope (vacío)"}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Datos bancarios (JSON)</label>
          <textarea
            className="w-full font-mono text-xs border border-slate-200 rounded-lg px-3 py-2 min-h-[100px]"
            value={datosBancarios}
            onChange={(e) => setDatosBancarios(e.target.value)}
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={guardando}
            className="bg-[#0EA5E9] hover:bg-[#0284C7] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
          >
            {guardando ? "Guardando…" : "Crear sorteo"}
          </button>
          <Link href="/sorteos" className="px-5 py-2.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
