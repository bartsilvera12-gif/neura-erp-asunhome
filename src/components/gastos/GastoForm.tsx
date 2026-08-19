"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createGasto, updateGasto, getGastos } from "@/lib/gastos/actions";
import MontoInput from "@/components/ui/MontoInput";
import type { Gasto, GastoInput } from "@/lib/gastos/actions";
import { hoyAsuncionYmd } from "@/lib/fecha/asuncion";
import { Repeat, Search } from "lucide-react";

const fLabel = "block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1";
const fInput =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white";

type Props = {
  gasto?: Gasto | null;
  onSuccess?: () => void;
};

export default function GastoForm({ gasto, onSuccess }: Props) {
  const router = useRouter();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<GastoInput>({
    categoria: gasto?.categoria ?? "",
    descripcion: gasto?.descripcion ?? "",
    monto: gasto?.monto ?? 0,
    tipo: gasto?.tipo ?? "variable",
    recurrente: gasto?.recurrente ?? false,
    frecuencia: gasto?.frecuencia ?? "",
    fecha: gasto?.fecha ?? hoyAsuncionYmd(),
    descuenta_caja: gasto?.descuenta_caja ?? false,
  });

  // Historico de gastos: para permitir reutilizar (recurrentes y frecuentes)
  const [historial, setHistorial] = useState<Gasto[]>([]);
  const [buscaHist, setBuscaHist] = useState("");

  useEffect(() => {
    if (gasto) return; // en modo edicion, no cargamos historial
    getGastos().then((list) => setHistorial(list)).catch(() => setHistorial([]));
  }, [gasto]);

  // Dedup: agrupar por (categoria + descripcion + monto) — quedarse con la mas reciente.
  // Priorizar recurrentes primero.
  const plantillas = useMemo(() => {
    if (!historial.length) return [] as Gasto[];
    const seen = new Map<string, Gasto>();
    for (const g of historial) {
      const key = `${g.categoria}||${g.descripcion}||${g.monto}`;
      const prev = seen.get(key);
      if (!prev || new Date(g.fecha) > new Date(prev.fecha)) seen.set(key, g);
    }
    const arr = [...seen.values()];
    arr.sort((a, b) => {
      if (a.recurrente !== b.recurrente) return a.recurrente ? -1 : 1;
      return new Date(b.fecha).getTime() - new Date(a.fecha).getTime();
    });
    return arr;
  }, [historial]);

  const plantillasFiltradas = useMemo(() => {
    const q = buscaHist.trim().toLowerCase();
    const base = q === ""
      ? plantillas
      : plantillas.filter((g) =>
          `${g.categoria} ${g.descripcion} ${g.frecuencia ?? ""}`.toLowerCase().includes(q)
        );
    return base.slice(0, 30);
  }, [plantillas, buscaHist]);

  function usarPlantilla(g: Gasto) {
    setForm({
      categoria: g.categoria,
      descripcion: g.descripcion,
      monto: g.monto,
      tipo: g.tipo,
      recurrente: g.recurrente,
      frecuencia: g.frecuencia ?? "",
      fecha: hoyAsuncionYmd(), // siempre hoy al reutilizar
      descuenta_caja: g.descuenta_caja ?? false,
    });
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setForm((prev) => ({ ...prev, recurrente: (e.target as HTMLInputElement).checked }));
    } else if (name !== "monto") {
      const normalized = ["categoria", "descripcion", "frecuencia"].includes(name) ? value.toUpperCase() : value;
      setForm((prev) => ({ ...prev, [name]: normalized }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.monto <= 0) {
      return setError("El monto debe ser mayor a 0.");
    }

    setGuardando(true);

    try {
      if (gasto) {
        await updateGasto(gasto.id, form);
      } else {
        await createGasto(form);
      }
      onSuccess?.();
      router.push("/gastos");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {!gasto && plantillas.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4 text-[#0EA5E9]" />
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
                Gastos previos ({plantillas.length})
              </h3>
            </div>
            <div className="relative flex-1 max-w-[220px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={buscaHist}
                onChange={(e) => setBuscaHist(e.target.value)}
                placeholder="Filtrar…"
                className="w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[#0EA5E9]/30"
              />
            </div>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Clickeá uno para reutilizarlo. Se copian categoría, descripción, monto y tipo — la fecha se pone en hoy.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 max-h-64 overflow-auto">
            {plantillasFiltradas.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => usarPlantilla(g)}
                className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-left transition-colors hover:border-[#0EA5E9] hover:bg-[#0EA5E9]/[0.06]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-800">{g.descripcion || g.categoria || "Sin descripción"}</div>
                    {g.categoria && g.descripcion && (
                      <div className="truncate text-[11px] text-slate-500">{g.categoria}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold text-slate-800 tabular-nums">Gs. {Math.round(g.monto).toLocaleString("es-PY")}</div>
                    {g.recurrente && (
                      <div className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <Repeat className="h-2.5 w-2.5" /> {g.frecuencia || "recurrente"}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
            {plantillasFiltradas.length === 0 && (
              <p className="col-span-full py-3 text-center text-xs text-slate-400">Ningún gasto coincide con &quot;{buscaHist}&quot;.</p>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-5 pb-2 border-b border-slate-200">
          <span className="text-base">📋</span>
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">
            Datos del gasto
          </h3>
        </div>
        <div className="space-y-4">
          <div>
            <label className={fLabel}>Categoría</label>
            <input
              type="text"
              name="categoria"
              value={form.categoria}
              onChange={handleChange}
              placeholder="Ej: Servicios, Alquiler, Salarios"
              className={fInput}
            />
          </div>
          <div>
            <label className={fLabel}>Descripción</label>
            <textarea
              name="descripcion"
              value={form.descripcion}
              onChange={handleChange}
              placeholder="Descripción del gasto"
              className={fInput}
              rows={2}
            />
          </div>
          <div>
            <label className={fLabel}>Monto (Gs.) *</label>
            <MontoInput
              value={form.monto}
              onChange={(n) => setForm((prev) => ({ ...prev, monto: n }))}
              placeholder="0"
              className={fInput}
              required
            />
          </div>
          <div>
            <label className={fLabel}>Tipo</label>
            <select
              name="tipo"
              value={form.tipo}
              onChange={handleChange}
              className={fInput}
            >
              <option value="variable">Variable</option>
              <option value="fijo">Fijo</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="recurrente"
              name="recurrente"
              checked={form.recurrente}
              onChange={handleChange}
              className="rounded border-slate-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
            />
            <label htmlFor="recurrente" className="text-sm text-slate-700">
              Gasto recurrente
            </label>
          </div>
          {form.recurrente && (
            <div>
              <label className={fLabel}>Frecuencia</label>
              <input
                type="text"
                name="frecuencia"
                value={form.frecuencia ?? ""}
                onChange={handleChange}
                placeholder="Ej: Mensual, Semanal"
                className={fInput}
              />
            </div>
          )}
          <div>
            <label className={fLabel}>Fecha *</label>
            <input
              type="date"
              name="fecha"
              value={form.fecha}
              onChange={handleChange}
              className={fInput}
              required
            />
          </div>
        </div>

        {!gasto && (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.descuenta_caja ?? false}
                onChange={(e) => setForm((p) => ({ ...p, descuenta_caja: e.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-amber-600"
              />
              <span className="flex-1">
                <span className="block text-sm font-semibold text-amber-900">Descontar de caja</span>
                <span className="mt-0.5 block text-xs text-amber-700">
                  Activá si pagaste este gasto en efectivo desde la caja. Se registra como egreso automático y se resta del cierre. Si pagaste con banco / tarjeta / transferencia, dejalo desactivado.
                </span>
              </span>
            </label>
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <button
          type="submit"
          disabled={guardando}
          className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {guardando ? "Guardando…" : gasto ? "Guardar cambios" : "Crear gasto"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/gastos")}
          className="border border-slate-200 text-sm px-6 py-2.5 rounded-lg hover:bg-slate-50 transition-colors"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
