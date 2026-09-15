"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";

/**
 * Selector de cliente con BÚSQUEDA server-side (nombre + cédula/RUC + teléfono).
 *
 * A diferencia de un <select> o de cargar toda la lista en memoria, consulta
 * `GET /api/clientes?q=…` con debounce y trae solo las coincidencias (máx 25).
 * Escala a miles de clientes sin traerlos todos al navegador.
 *
 * Es CONTROLADO: el padre maneja `value` (clienteId) y `label` (nombre a mostrar);
 * en `onChange` recibe el cliente elegido y actualiza ambos.
 */

export type ClienteHit = {
  id: string;
  nombre: string;
  ruc: string | null;
  documento: string | null;
  telefono: string | null;
  usa_nota_remision?: boolean;
};

type RawCliente = {
  id: string;
  empresa: string | null;
  nombre_contacto: string | null;
  nombre: string | null;
  ruc: string | null;
  documento: string | null;
  telefono: string | null;
  usa_nota_remision?: boolean;
};

function displayNombre(c: RawCliente): string {
  return (c.empresa || c.nombre_contacto || c.nombre || "").trim();
}

type Props = {
  /** clienteId seleccionado ("" si ninguno). */
  value: string;
  /** Nombre del cliente seleccionado, para mostrarlo sin tener que buscar. */
  label?: string;
  onChange: (id: string, cliente?: ClienteHit) => void;
  placeholder?: string;
  autoFocus?: boolean;
};

export default function ClienteSelectorBuscador({
  value,
  label = "",
  onChange,
  placeholder = "Buscar por nombre o cédula…",
  autoFocus,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClienteHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  // Cerrar el dropdown al hacer click afuera.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const buscar = useCallback((q: string) => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const myId = ++reqIdRef.current;
    fetch(`/api/clientes?q=${encodeURIComponent(term)}&limit=25`, { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (myId !== reqIdRef.current) return; // descartar respuestas fuera de orden
        const rows: RawCliente[] = Array.isArray(j?.data) ? j.data : [];
        setResults(
          rows.map((c) => ({
            id: c.id,
            nombre: displayNombre(c),
            ruc: c.ruc,
            documento: c.documento,
            telefono: c.telefono,
            usa_nota_remision: c.usa_nota_remision === true,
          }))
        );
      })
      .catch(() => {
        if (myId === reqIdRef.current) setResults([]);
      })
      .finally(() => {
        if (myId === reqIdRef.current) setLoading(false);
      });
  }, []);

  function onType(v: string) {
    // Al empezar a escribir se suelta la selección previa (se está buscando otra).
    if (value) onChange("");
    setQuery(v);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => buscar(v), 250);
  }

  function pick(c: ClienteHit) {
    onChange(c.id, c);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function clear() {
    onChange("");
    setQuery("");
    setResults([]);
  }

  const inputVal = value ? label : query;

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={inputVal}
          autoFocus={autoFocus}
          onChange={(e) => onType(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={`w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 py-2 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20 ${value ? "font-medium text-slate-800" : ""}`}
        />
        {(value || query) && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Quitar cliente"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-40 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl ring-1 ring-slate-100">
          <button
            type="button"
            onClick={clear}
            className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-50"
          >
            — Sin cliente —
          </button>
          {loading ? (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…
            </p>
          ) : query.trim().length < 2 ? (
            <p className="px-3 py-3 text-xs text-slate-400">Escribí al menos 2 letras del nombre o la cédula…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-400">Sin coincidencias con &ldquo;{query.trim()}&rdquo;.</p>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c)}
                className="flex w-full items-start gap-2 border-b border-slate-50 px-3 py-2 text-left text-sm hover:bg-[#4FAEB2]/8 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-slate-800">{c.nombre || "(sin nombre)"}</span>
                    {c.usa_nota_remision && (
                      <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">Nota remisión</span>
                    )}
                  </div>
                  {(c.ruc || c.documento || c.telefono) && (
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {(c.ruc || c.documento) && <span>CI/RUC {c.ruc || c.documento}</span>}
                      {(c.ruc || c.documento) && c.telefono && <span className="mx-1 text-slate-300">·</span>}
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
