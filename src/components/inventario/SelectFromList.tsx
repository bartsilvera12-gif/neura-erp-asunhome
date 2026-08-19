"use client";

/**
 * Selector con buscador (combobox) + opción "Sin asignar".
 *
 * Drop-in replacement de la version anterior basada en <select> nativo:
 * mantiene la misma API (value, onChange, options, placeholder, emptyShort,
 * emptyText, className) pero con buscador filtrado al tipear. Ideal para
 * listas largas (cientos de categorias o proveedores).
 *
 * UX:
 * - Click en el trigger -> abre el panel con input + lista filtrada.
 * - Tipeo en el input -> filtra por nombre/sublabel (case-insensitive).
 * - Flechas arriba/abajo -> mueve highlight, Enter -> selecciona.
 * - Escape -> cierra sin cambios.
 * - Click fuera -> cierra.
 * - 'Sin asignar' siempre en el tope para poder limpiar la seleccion.
 * - Si options.length === 0 -> trigger deshabilitado (igual que antes).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check, X } from "lucide-react";
import { productoMatchesQuery } from "@/lib/productos/token-search";

interface Option {
  id: string;
  label: string;
  sublabel?: string;
}

interface Props {
  value: string | null;
  onChange: (v: string | null) => void;
  options: Option[];
  placeholder?: string;
  /** Texto corto dentro del select cuando options.length === 0. */
  emptyShort?: string;
  /** Compat: si se pasa, se usa como emptyShort. */
  emptyText?: string;
  className?: string;
}

export default function SelectFromList({
  value,
  onChange,
  options,
  placeholder = "Sin asignar",
  emptyShort,
  emptyText,
  className = "",
}: Props) {
  const isEmpty = options.length === 0;
  const empty = emptyShort ?? emptyText ?? "Sin opciones";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedOption = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value]
  );

  // Lista filtrada por tokens (cada palabra en cualquier orden, sin acentos),
  // sobre label + sublabel. Misma inteligencia que el buscador de Caja.
  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    return options.filter((o) => productoMatchesQuery(query, o.label, o.sublabel));
  }, [options, query]);

  // Reset highlight cuando cambia el filtro.
  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  // Focus al input al abrir.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Click fuera -> cerrar.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Scroll del item highlighted a la vista.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-idx="${highlight}"]`
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function pick(id: string | null) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      // total = 1 (la opcion "Sin asignar") + filtered.length
      setHighlight((h) => Math.min(h + 1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight === 0) {
        pick(null);
      } else {
        const op = filtered[highlight - 1];
        if (op) pick(op.id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={containerRef} className={`relative min-w-0 ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        disabled={isEmpty}
        onClick={() => setOpen((v) => !v)}
        className={
          "flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm outline-none transition-all hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        }
      >
        <span className="min-w-0 truncate">
          {isEmpty ? (
            <span className="text-slate-400">{empty}</span>
          ) : selectedOption ? (
            <>
              {selectedOption.label}
              {selectedOption.sublabel ? (
                <span className="text-slate-400"> — {selectedOption.sublabel}</span>
              ) : null}
            </>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Panel */}
      {open && !isEmpty && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5">
          {/* Buscador */}
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Buscar..."
                className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-7 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Lista */}
          <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
            {/* "Sin asignar" siempre en el tope */}
            <button
              type="button"
              data-idx={0}
              onMouseEnter={() => setHighlight(0)}
              onClick={() => pick(null)}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                highlight === 0 ? "bg-[#4FAEB2]/8 text-slate-800" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <span className="italic">{placeholder}</span>
              {value === null && <Check className="h-3.5 w-3.5 text-[#4FAEB2]" />}
            </button>

            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-400">
                Sin resultados para &quot;{query}&quot;
              </p>
            ) : (
              filtered.map((o, i) => {
                const idx = i + 1;
                const isSelected = o.id === value;
                const isHi = highlight === idx;
                return (
                  <button
                    key={o.id}
                    type="button"
                    data-idx={idx}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => pick(o.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                      isHi
                        ? "bg-[#4FAEB2]/10 text-slate-800"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="min-w-0 truncate">
                      <span className={isSelected ? "font-semibold" : ""}>{o.label}</span>
                      {o.sublabel && (
                        <span className="text-slate-400"> — {o.sublabel}</span>
                      )}
                    </span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-[#4FAEB2]" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
