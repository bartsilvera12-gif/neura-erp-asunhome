"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { productoMatchesQuery } from "@/lib/productos/token-search";

export type ClienteBuscadorItem = {
  id: string;
  nombre: string;
  ruc: string | null;
  telefono: string | null;
  direccion: string | null;
};

type Props = {
  clientes: ClienteBuscadorItem[];
  value: string; // clienteId seleccionado, "" si nada
  onSelect: (c: ClienteBuscadorItem) => void;
  onClear: () => void;
  placeholder?: string;
  label?: string;
  className?: string;
};

/**
 * Buscador de cliente con dropdown propio (no usa <select> nativo).
 * Al seleccionar, ejecuta onSelect(cliente completo); al quitar, onClear().
 */
export default function ClienteBuscador({
  clientes,
  value,
  onSelect,
  onClear,
  placeholder = "Buscar por nombre, RUC o teléfono…",
  label,
  className = "",
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const seleccionado = useMemo(() => clientes.find((c) => c.id === value) ?? null, [clientes, value]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const filtrados = useMemo(() => {
    const q = query.trim();
    const ordenados = [...clientes].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    if (q === "") return ordenados;
    return ordenados.filter((c) =>
      productoMatchesQuery(q, c.nombre, c.ruc ?? undefined)
      || (c.telefono ? c.telefono.replace(/\D/g, "").includes(q.replace(/\D/g, "")) && q.replace(/\D/g, "").length > 0 : false)
    );
  }, [clientes, query]);

  const inputC = "w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/30";

  return (
    <div ref={ref} className={`relative ${className}`}>
      {label && <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={seleccionado ? seleccionado.nombre : query}
          onChange={(e) => { if (seleccionado) onClear(); setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={`${inputC} ${seleccionado ? "font-medium text-slate-800" : ""}`}
        />
        {seleccionado && (
          <button
            type="button"
            onClick={() => { onClear(); setQuery(""); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Quitar cliente"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {seleccionado && (seleccionado.ruc || seleccionado.telefono) && (
        <p className="mt-1 text-[11px] text-slate-500">
          {seleccionado.ruc && <span className="font-medium">RUC {seleccionado.ruc}</span>}
          {seleccionado.ruc && seleccionado.telefono && <span className="mx-1.5 text-slate-300">·</span>}
          {seleccionado.telefono && <span>Tel {seleccionado.telefono}</span>}
        </p>
      )}
      {open && !seleccionado && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl ring-1 ring-slate-100">
          {filtrados.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-400">
              {query.trim() ? `Sin clientes que coincidan con "${query.trim()}"` : "No hay clientes cargados."}
            </p>
          ) : (
            filtrados.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onSelect(c); setQuery(""); setOpen(false); }}
                className="flex w-full items-start gap-2 border-b border-slate-50 px-3 py-2 text-left text-sm hover:bg-[#4FAEB2]/8 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-800">{c.nombre}</div>
                  {(c.ruc || c.telefono) && (
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {c.ruc && <span>RUC {c.ruc}</span>}
                      {c.ruc && c.telefono && <span className="mx-1 text-slate-300">·</span>}
                      {c.telefono && <span>Tel {c.telefono}</span>}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
