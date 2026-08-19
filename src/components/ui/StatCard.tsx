import type { ReactNode } from "react";

/**
 * Tarjeta KPI del ERP: etiqueta, valor grande, ícono opcional y subtítulo /
 * variación opcional. Blanca, borde suave, acento turquesa.
 */
export default function StatCard({
  label,
  value,
  icon,
  hint,
  accent = false,
  compact = false,
  className,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  /** Texto secundario debajo del valor (ej. "0 transacciones"). */
  hint?: ReactNode;
  /** Resalta el valor en turquesa (para la métrica principal). */
  accent?: boolean;
  /** Versión sobria: menos padding, valor más chico y truncado (1 línea). */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-[#4FAEB2]/10 ${compact ? "p-3.5" : "p-5"} ${className ?? ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 truncate">
          {label}
        </p>
        {icon ? <span className="text-base leading-none text-[#4FAEB2]">{icon}</span> : null}
      </div>
      <p
        className={`mt-1 font-bold tracking-tight ${compact ? "text-base truncate" : "mt-2 text-2xl"} ${accent ? "text-[#3F8E91]" : "text-slate-900"}`}
        title={compact && typeof value === "string" ? value : undefined}
      >
        {value}
      </p>
      {hint ? (
        <p className={`mt-1 text-xs text-slate-400 ${compact ? "truncate" : ""}`} title={compact && typeof hint === "string" ? hint : undefined}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
