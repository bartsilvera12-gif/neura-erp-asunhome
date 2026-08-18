"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

type ConfigCollapsibleSectionProps = {
  title: string;
  description?: string;
  /** Panel abierto al montar (modo no controlado). */
  defaultExpanded?: boolean;
  /** Switch “activo” al montar (modo no controlado). */
  defaultActive?: boolean;
  /** Modo controlado: `active` / `expanded` y sus callbacks deben ir juntos. */
  active?: boolean;
  expanded?: boolean;
  onActiveChange?: (next: boolean) => void;
  onExpandedChange?: (next: boolean) => void;
  children: React.ReactNode;
  /**
   * Si es true, no se renderiza el panel expandible mientras la sección está **inactiva**
   * (solo cabecera). Evita huecos/padding residual al desactivar el switch.
   */
  hideBodyWhenInactive?: boolean;
};

/**
 * Sección de configuración estilo SaaS:
 * - **Switch**: indica estado activo/inactivo (persistible vía modo controlado).
 * - **Cabecera** (título + chevron): expande/contrae el contenido.
 */
export function ConfigCollapsibleSection({
  title,
  description,
  defaultExpanded = false,
  defaultActive = true,
  active: activeProp,
  expanded: expandedProp,
  onActiveChange,
  onExpandedChange,
  children,
  hideBodyWhenInactive = false,
}: ConfigCollapsibleSectionProps) {
  const controlled =
    typeof activeProp === "boolean" &&
    typeof expandedProp === "boolean" &&
    typeof onActiveChange === "function" &&
    typeof onExpandedChange === "function";

  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const [internalActive, setInternalActive] = useState(defaultActive);

  const expanded = controlled ? (expandedProp as boolean) : internalExpanded;
  const isActive = controlled ? Boolean(activeProp) : internalActive;

  const setExpanded = (next: boolean) => {
    if (controlled) onExpandedChange(next);
    else setInternalExpanded(next);
  };

  const setActive = (next: boolean) => {
    if (controlled) onActiveChange(next);
    else setInternalActive(next);
  };

  const headingId = useId();
  const panelId = useId();
  const switchId = useId();

  const shellClass = isActive
    ? "border-emerald-200/90 bg-white shadow-md ring-1 ring-emerald-100/50"
    : "border-slate-300/90 bg-slate-100/60 shadow-sm ring-0";

  const showExpandablePanel = !(hideBodyWhenInactive && !isActive);

  return (
    <div
      className={`rounded-xl border shadow-sm overflow-hidden transition-[border-color,box-shadow,background-color,ring-color] duration-300 ease-out ${shellClass}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:justify-between sm:gap-4 px-4 py-4 sm:px-5 sm:py-4">
        <button
          type="button"
          id={headingId}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left outline-none transition-colors hover:bg-slate-50/80 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 sm:gap-3 sm:pr-1"
        >
          <span
            className={`mt-0.5 shrink-0 text-slate-400 transition-transform duration-300 ease-out ${
              expanded ? "rotate-180" : ""
            }`}
            aria-hidden
          >
            <ChevronDown className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <h3
              className={`text-sm font-semibold tracking-tight transition-colors duration-200 ${
                isActive ? "text-slate-900" : "text-slate-600"
              }`}
            >
              {title}
            </h3>
            {description ? (
              <p className="mt-1 text-xs text-slate-500 leading-relaxed max-w-4xl">{description}</p>
            ) : null}
            <p className="mt-1.5 hidden text-[10px] text-slate-400 sm:block">
              Clic para {expanded ? "contraer" : "expandir"}
            </p>
          </span>
        </button>

        <div className="flex shrink-0 flex-row items-center justify-end gap-3 border-t border-slate-200/60 pt-3 sm:flex-col sm:items-end sm:justify-start sm:border-t-0 sm:pt-0.5 sm:gap-1.5">
          <label htmlFor={switchId} className="inline-flex cursor-pointer items-center gap-2 select-none">
            <span className="sr-only">Activar o desactivar esta sección</span>
            <input
              id={switchId}
              type="checkbox"
              role="switch"
              aria-checked={isActive}
              checked={Boolean(isActive)}
              onChange={(e) => setActive(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="relative h-6 w-11 shrink-0 rounded-full bg-slate-300 transition-colors duration-300 ease-out peer-checked:bg-emerald-500 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-sky-400 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform after:duration-300 after:ease-out peer-checked:after:translate-x-5"
            />
          </label>
          <span
            className={`text-[10px] font-bold uppercase tracking-wide transition-colors duration-200 ${
              isActive ? "text-emerald-700" : "text-slate-500"
            }`}
          >
            {isActive ? "Activo" : "Inactivo"}
          </span>
        </div>
      </div>

      {showExpandablePanel ? (
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div id={panelId} role="region" aria-labelledby={headingId} className="min-h-0 overflow-hidden">
            <div className="border-t border-slate-100/90 bg-gradient-to-b from-slate-50/40 to-white px-4 py-5 sm:px-5 sm:py-6">
              <div className="w-full">{children}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
