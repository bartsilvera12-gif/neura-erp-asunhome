"use client";

/**
 * Selector de rango de fechas (desde / hasta) para reportes. Valor `YYYY-MM-DD`.
 * Base blanca, foco turquesa (estilo Zentra).
 */
export default function RangoFechasSelector({
  desde,
  hasta,
  onChange,
}: {
  desde: string;
  hasta: string;
  onChange: (r: { desde: string; hasta: string }) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-slate-400 whitespace-nowrap">Desde</label>
      <input
        type="date"
        value={desde}
        max={hasta || undefined}
        onChange={(e) => onChange({ desde: e.target.value, hasta })}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#4FAEB2]"
      />
      <label className="text-xs text-slate-400 whitespace-nowrap">Hasta</label>
      <input
        type="date"
        value={hasta}
        min={desde || undefined}
        onChange={(e) => onChange({ desde, hasta: e.target.value })}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#4FAEB2]"
      />
    </div>
  );
}
