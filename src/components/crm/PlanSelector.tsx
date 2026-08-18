"use client";

import { useRef, useEffect, useState } from "react";
import type { Plan } from "@/lib/planes/types";

type Props = {
  planes: Plan[];
  selectedIds: string[];
  onToggle: (planId: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export default function PlanSelector({
  planes,
  selectedIds,
  onToggle,
  placeholder = "Buscar plan por nombre…",
  disabled = false,
}: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const planesActivos = planes.filter((p) => p.estado === "activo");
  const filtrados = busqueda.trim()
    ? planesActivos.filter((p) =>
        p.nombre.toLowerCase().includes(busqueda.toLowerCase().trim())
      )
    : planesActivos;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {/* Chips de planes seleccionados */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedIds.map((id) => {
            const plan = planesActivos.find((p) => p.id === id);
            if (!plan) return null;
            return (
              <span
                key={plan.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0EA5E9]/10 text-[#0284C7] text-sm font-medium"
              >
                {plan.nombre}
                <span className="text-xs text-gray-500">
                  {plan.precio.toLocaleString("es-PY")} ₲
                </span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onToggle(plan.id)}
                    className="ml-0.5 text-gray-400 hover:text-red-600"
                    aria-label="Quitar"
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Input buscador */}
      <div className="relative">
        <input
          type="text"
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 pr-9 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm disabled:bg-slate-50 disabled:cursor-not-allowed"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          ▼
        </span>
      </div>

      {/* Lista desplegable */}
      {abierto && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-56 overflow-y-auto">
          {filtrados.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500">
              {busqueda.trim() ? "Sin coincidencias" : "No hay planes"}
            </div>
          ) : (
            <ul className="py-1">
              {filtrados.map((plan) => {
                const yaSeleccionado = selectedIds.includes(plan.id);
                return (
                  <li key={plan.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onToggle(plan.id);
                        setBusqueda("");
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors ${
                        yaSeleccionado ? "bg-[#0EA5E9]/5 text-[#0284C7]" : "text-gray-800"
                      }`}
                    >
                      <span className="truncate">{plan.nombre}</span>
                      <span className="text-xs font-mono text-gray-500 shrink-0">
                        {plan.precio.toLocaleString("es-PY")} ₲
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
