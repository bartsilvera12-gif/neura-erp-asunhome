import Link from "next/link";
import type { ComponentType } from "react";

/**
 * Card del hub de Reportes — ícono en caja, título, subtítulo uppercase,
 * descripción y botón inferior sólido turquesa con flecha.
 */
export function ReportCard({
  title,
  subtitle,
  icon: Icon,
  description,
  href,
  actionLabel = "Ver reporte",
}: {
  title: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  href: string;
  actionLabel?: string;
}) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-[#4FAEB2]/40 hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E5F4F4] text-[#3F8E91]">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-slate-900">{title}</h2>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{subtitle}</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">{description}</p>
      <div className="mt-auto pt-5">
        <Link
          href={href}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#4FAEB2] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
        >
          {actionLabel}
          <span aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}
