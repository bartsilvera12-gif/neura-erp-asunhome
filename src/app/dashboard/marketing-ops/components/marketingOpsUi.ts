import {
  MARKETING_OPS_ESTADOS_CLIENTE,
  MARKETING_OPS_ESTADOS_PRODUCCION,
  MARKETING_OPS_ESTADOS_PUBLICACION,
  MARKETING_OPS_PRIORIDADES,
} from "@/lib/marketing-ops/types";

export const PRIORIDAD_OPTIONS = MARKETING_OPS_PRIORIDADES.map((value) => ({
  value,
  label: value === "baja" ? "Baja" : value === "media" ? "Media" : value === "alta" ? "Alta" : "Urgente",
}));

export const ESTADO_PRODUCCION_OPTIONS = MARKETING_OPS_ESTADOS_PRODUCCION.map((value) => ({
  value,
  label:
    value === "por_hacer"
      ? "Por hacer"
      : value === "en_produccion"
        ? "En producción"
        : value === "revision_interna"
          ? "Revisión interna"
          : value === "correccion_interna"
            ? "Corrección interna"
            : "Listo para enviar",
}));

export const ESTADO_CLIENTE_OPTIONS = MARKETING_OPS_ESTADOS_CLIENTE.map((value) => ({
  value,
  label:
    value === "no_enviado"
      ? "No enviado"
      : value === "enviado"
        ? "Enviado"
        : value === "aprobado"
          ? "Aprobado"
          : value === "con_correcciones"
            ? "Con correcciones"
            : "Sin respuesta",
}));

export const ESTADO_PUBLICACION_OPTIONS = MARKETING_OPS_ESTADOS_PUBLICACION.map((value) => ({
  value,
  label:
    value === "pendiente"
      ? "Pendiente"
      : value === "programado"
        ? "Programado"
        : value === "publicado"
          ? "Publicado"
          : "Cancelado",
}));

export function labelFor(options: { value: string; label: string }[], value: string | null | undefined): string {
  return options.find((o) => o.value === value)?.label ?? value ?? "—";
}

export function prioridadBadgeClass(value: string): string {
  if (value === "baja") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "alta") return "border-red-200 bg-red-50 text-red-700";
  if (value === "urgente") return "border-rose-300 bg-rose-50 text-rose-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

export function estadoBadgeClass(value: string): string {
  if (["publicado", "aprobado", "listo_para_enviar"].includes(value)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (["en_produccion", "enviado", "programado", "revision_interna"].includes(value)) {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (["con_correcciones", "correccion_interna", "sin_respuesta"].includes(value)) {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }
  if (value === "cancelado") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-slate-200 bg-white text-slate-600";
}

export function clienteLabel(cliente?: { empresa?: string | null; nombre_contacto?: string | null; nombre?: string | null } | null): string {
  return (cliente?.empresa ?? cliente?.nombre_contacto ?? cliente?.nombre ?? "Sin cliente").trim() || "Sin cliente";
}

export function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(`${value}T12:00:00`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : "—";
}
