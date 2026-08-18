/** Primitivas visuales compartidas entre subpáginas de configuración global (misma línea que Omnichannel cards). */

export const F_LABEL =
  "block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1";
export const F_INPUT =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white";
export const F_SELECT =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] bg-white";

export function ConfigFormCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{children}</div>;
}

export function ConfigSectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-500">{children}</h4>;
}

export function ConfigHelpText({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{children}</p>;
}

export function ConfigMetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
      <p className="mb-0.5 text-xs text-slate-400">{label}</p>
      <p className="text-sm font-bold tabular-nums text-slate-800">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
