"use client";

/**
 * Buscador de producto con lista filtrable. Reemplaza al <select> plano cuando
 * hay muchos productos (el catálogo real tiene cientos). Devuelve el id elegido.
 */
import { useEffect, useMemo, useRef, useState } from "react";

export interface ProductoBuscable {
  id: string;
  nombre: string;
  sku?: string | null;
}

export default function BuscadorProducto({
  productos,
  value,
  onChange,
  placeholder = "Buscar producto por nombre o SKU…",
  className = "",
}: {
  productos: ProductoBuscable[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const elegido = useMemo(() => productos.find((p) => p.id === value) ?? null, [productos, value]);

  // Cuando ya hay uno elegido, mostrar su nombre en el input.
  useEffect(() => {
    if (elegido && !abierto) setQ(elegido.nombre);
  }, [elegido, abierto]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return productos.slice(0, 50);
    return productos
      .filter((p) => p.nombre.toLowerCase().includes(t) || (p.sku ?? "").toLowerCase().includes(t))
      .slice(0, 50);
  }, [q, productos]);

  const inputClass =
    "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0EA5E9] outline-none";

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        className={inputClass}
        value={q}
        onChange={(e) => { setQ(e.target.value); setAbierto(true); if (value) onChange(""); }}
        onFocus={() => { setAbierto(true); if (elegido) setQ(""); }}
        placeholder={placeholder}
      />
      {abierto && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {filtradas.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-400">Sin resultados.</p>
          ) : (
            filtradas.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onChange(p.id); setQ(p.nombre); setAbierto(false); }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                  p.id === value ? "bg-sky-50 text-sky-700" : "text-slate-700"
                }`}
              >
                <span className="truncate">{p.nombre}</span>
                {p.sku && <span className="shrink-0 font-mono text-xs text-slate-400">{p.sku}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
