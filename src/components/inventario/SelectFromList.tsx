"use client";

/**
 * Selector simple tipo dropdown con opcion "Sin asignar".
 * - `emptyShort` se muestra DENTRO del select cuando no hay opciones (texto corto
 *   para que no se corte). Para textos largos usa `helpText` debajo del campo.
 */

interface Option { id: string; label: string; sublabel?: string }

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
  return (
    <div className="min-w-0">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={isEmpty}
        className={
          "block w-full min-w-0 border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white text-sm truncate disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed " +
          className
        }
      >
        <option value="">{isEmpty ? empty : placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}{o.sublabel ? ` — ${o.sublabel}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
