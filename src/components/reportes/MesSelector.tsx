"use client";

import { mesesRecientesAsuncion } from "@/lib/fechas/asuncion-bounds";

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Etiqueta amigable "YYYY-MM · Mes Año". */
function etiqueta(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const nombre = MESES_ES[m - 1] ?? "";
  return `${mes} · ${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${y}`;
}

/** Selector de mes (últimos 12 meses, Asunción). Valor `YYYY-MM`. */
export default function MesSelector({
  mes,
  onChange,
  meses = 12,
}: {
  mes: string;
  onChange: (m: string) => void;
  meses?: number;
}) {
  const opciones = mesesRecientesAsuncion(meses);
  // Garantiza que el mes seleccionado esté en la lista aunque sea más viejo.
  if (!opciones.includes(mes)) opciones.push(mes);

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-slate-400 whitespace-nowrap">Mes</label>
      <select
        value={mes}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#0EA5E9]"
      >
        {opciones.map((m) => (
          <option key={m} value={m}>{etiqueta(m)}</option>
        ))}
      </select>
    </div>
  );
}
