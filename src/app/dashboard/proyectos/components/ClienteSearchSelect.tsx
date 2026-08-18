"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type ClienteOpt = { id: string; empresa?: string | null; nombre_contacto?: string | null };

export function clienteLabel(c: ClienteOpt): string {
  return (c.empresa || "").trim() || (c.nombre_contacto || "").trim() || c.id.slice(0, 8);
}

type Props = {
  clientes: ClienteOpt[];
  value: string;
  onChange: (id: string) => void;
};

export function ClienteSearchSelect({ clientes, value, onChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => clientes.find((c) => c.id === value), [clientes, value]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return clientes;
    return clientes.filter((c) => clienteLabel(c).toLowerCase().includes(t));
  }, [clientes, q]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={wrapRef} className="relative sm:col-span-2">
      <span className="font-medium text-slate-700">Cliente</span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          type="text"
          className="min-w-[200px] flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
          placeholder="Buscar por nombre o empresa…"
          value={open ? q : selected ? clienteLabel(selected) : q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            if (value) onChange("");
          }}
          onFocus={() => setOpen(true)}
          aria-label="Buscar cliente"
        />
        <button
          type="button"
          className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          onClick={() => {
            onChange("");
            setQ("");
            setOpen(false);
          }}
        >
          Sin cliente / definir luego
        </button>
      </div>

      {open && q.trim() && filtered.length === 0 ? (
        <div className="absolute left-0 right-0 z-20 mt-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-lg">
          Sin coincidencias
        </div>
      ) : null}
      {open && filtered.length > 0 ? (
        <ul
          className="absolute left-0 right-0 z-20 mt-1 max-h-52 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          role="listbox"
        >
          {filtered.slice(0, 100).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-indigo-50"
                onClick={() => {
                  onChange(c.id);
                  setQ("");
                  setOpen(false);
                }}
              >
                {clienteLabel(c)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {value && selected ? (
        <p className="mt-2 text-xs text-slate-600">
          Seleccionado: <strong>{clienteLabel(selected)}</strong>
        </p>
      ) : null}
    </div>
  );
}
