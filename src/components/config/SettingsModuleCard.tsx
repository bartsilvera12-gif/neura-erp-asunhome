"use client";

import Link from "next/link";
import type { ComponentType } from "react";

export type SettingsModuleBadgeTone = "active" | "inactive" | "neutral";

function badgeClasses(tone: SettingsModuleBadgeTone): string {
  if (tone === "active") return "bg-emerald-50 text-emerald-900 border-emerald-200";
  if (tone === "inactive") return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

export type SettingsModuleCardProps = {
  title: string;
  /** Subtítulo tipo canal: línea superior en gris, uppercase */
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  /** Texto secundario bajo el subtítulo (como “Sin configurar” en canales) */
  description: string;
  badge?: { label: string; tone: SettingsModuleBadgeTone };
  href?: string;
  disabled?: boolean;
  onSelect?: () => void;
  /** Texto del botón inferior estilo “Editar” */
  actionLabel?: string;
};

/**
 * Misma jerarquía visual que {@link OmnichannelChannelCard}: cabecera con ícono en caja,
 * título, subtítulo, badge de estado y botón outline ancho completo abajo.
 */
export function SettingsModuleCard({
  title,
  subtitle,
  icon: Icon,
  description,
  badge,
  href,
  disabled,
  onSelect,
  actionLabel = "Editar",
}: SettingsModuleCardProps) {
  const shell =
    "flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-slate-300 hover:shadow-md";

  const footerClass =
    "inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors";

  const header = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-slate-900">{title}</h2>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">{subtitle}</p>
          </div>
        </div>
        {badge ? (
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badgeClasses(badge.tone)}`}
          >
            {badge.label}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">{description}</p>
    </>
  );

  const footer =
    href && !disabled ? (
      <Link href={href} className={footerClass}>
        {actionLabel}
      </Link>
    ) : (
      <button type="button" disabled={disabled} onClick={onSelect} className={`${footerClass} disabled:cursor-not-allowed disabled:opacity-50`}>
        {actionLabel}
      </button>
    );

  return (
    <article className={`${shell} ${disabled ? "opacity-[0.85]" : ""}`}>
      {header}
      <div className="mt-auto pt-5">{footer}</div>
    </article>
  );
}
