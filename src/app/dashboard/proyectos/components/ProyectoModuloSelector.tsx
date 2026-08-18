"use client";

import { useMemo, useState } from "react";

export type ProyectoModuloCatalogo = { id: string; nombre: string; slug: string };

type ProyectoModuloSelectorProps = {
  modulos: ProyectoModuloCatalogo[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  variant?: "light" | "dark";
};

export function ProyectoModuloSelector({
  modulos,
  selectedIds,
  onChange,
  variant = "light",
}: ProyectoModuloSelectorProps) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedModules = useMemo(
    () => modulos.filter((modulo) => selectedSet.has(modulo.id)),
    [modulos, selectedSet]
  );
  const filteredModules = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return modulos;
    return modulos.filter((modulo) =>
      [modulo.nombre, modulo.slug].some((value) => value.toLowerCase().includes(q))
    );
  }, [modulos, query]);

  const isDark = variant === "dark";
  const inputClass = isDark
    ? "w-full rounded-lg border border-slate-600 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
    : "w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
  const panelClass = isDark
    ? "rounded-xl border border-slate-700 bg-slate-900/40"
    : "rounded-xl border border-emerald-100 bg-white/70";
  const rowClass = isDark
    ? "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
    : "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-emerald-50";
  const chipClass = isDark
    ? "inline-flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100"
    : "inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-900";
  const mutedClass = isDark ? "text-slate-500" : "text-slate-500";

  function toggle(id: string) {
    if (selectedSet.has(id)) onChange(selectedIds.filter((current) => current !== id));
    else onChange([...selectedIds, id]);
  }

  function remove(id: string) {
    onChange(selectedIds.filter((current) => current !== id));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs font-medium ${mutedClass}`}>
          {selectedIds.length === 1 ? "1 módulo seleccionado" : `${selectedIds.length} módulos seleccionados`}
        </p>
      </div>

      {selectedModules.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedModules.map((modulo) => (
            <span key={modulo.id} className={chipClass}>
              {modulo.nombre}
              <button
                type="button"
                className="rounded-full px-1 font-bold hover:bg-black/10"
                onClick={() => remove(modulo.id)}
                aria-label={`Quitar ${modulo.nombre}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className={`text-xs ${mutedClass}`}>Todavía no seleccionaste módulos.</p>
      )}

      <input
        className={inputClass}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar módulo..."
      />

      <div className={`${panelClass} max-h-56 overflow-y-auto p-2`}>
        {modulos.length === 0 ? (
          <p className={`px-3 py-4 text-sm ${mutedClass}`}>No hay módulos disponibles en el catálogo.</p>
        ) : filteredModules.length === 0 ? (
          <p className={`px-3 py-4 text-sm ${mutedClass}`}>No hay módulos que coincidan con la búsqueda.</p>
        ) : (
          filteredModules.map((modulo) => (
            <label key={modulo.id} className={rowClass}>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={selectedSet.has(modulo.id)}
                onChange={() => toggle(modulo.id)}
              />
              <span className="flex-1">{modulo.nombre}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
