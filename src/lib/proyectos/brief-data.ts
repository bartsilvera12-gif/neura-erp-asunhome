/**
 * Datos de proyecto almacenados en `proyectos.brief_data` (JSON) + columnas propias.
 * Reutilizable en formularios (alta, detalle) sin acoplar a un solo componente.
 */

export type BriefFieldDef =
  | { kind: "checkbox"; key: string; label: string }
  | { kind: "text"; key: string; label: string; placeholder?: string };

export type ProyectoModuloSnapshot = {
  id: string | null;
  slug: string | null;
  nombre: string;
};

export type ProyectoSaasBriefForm = {
  empresa_nombre: string;
  whatsapp_contacto: string;
  observaciones: string;
  modulos_necesarios: ProyectoModuloSnapshot[];
};

/** Campos editables en la pestaña "Datos" (proyecto web y compat. con JSON previo). */
export const PROYECTO_DATOS_BRIEF_FIELDS: BriefFieldDef[] = [
  { kind: "text", key: "marca", label: "Nombre de la marca" },
  { kind: "text", key: "dominio_usar", label: "Dominio a usar", placeholder: "ej. midominio.com.py" },
  { kind: "text", key: "tipo_web", label: "Tipo de web" },
  { kind: "text", key: "rubro", label: "Rubro" },
  { kind: "text", key: "objetivo", label: "Objetivo de la web" },
  { kind: "text", key: "secciones", label: "Secciones necesarias" },
  { kind: "text", key: "estilo_colores", label: "Colores o estilo deseado" },
  { kind: "text", key: "logo_cliente", label: "Logo del cliente", placeholder: "https://..." },
  { kind: "text", key: "redes_sociales", label: "Redes sociales" },
  { kind: "text", key: "whatsapp_contacto", label: "WhatsApp de contacto" },
  { kind: "checkbox", key: "hosting_existente", label: "Hosting existente" },
  { kind: "text", key: "referencias_urls", label: "Referencias de páginas" },
];

export const PROYECTO_SAAS_BRIEF_KEYS = {
  empresaNombre: "saas_empresa_nombre",
  whatsappContacto: "saas_whatsapp_contacto",
  observaciones: "saas_observaciones",
  modulosNecesarios: "saas_modulos_necesarios",
} as const;

/** Claves que pueden existir con nombres antiguos; al leer se unifican. */
const BRIEF_ALIASES: Record<string, string> = {
  dominio: "dominio_usar",
  domain: "dominio_usar",
  tipo: "tipo_web",
  tipoweb: "tipo_web",
  brand: "marca",
};

export function normalizeBriefKey(k: string): string {
  const t = k.trim();
  return BRIEF_ALIASES[t.toLowerCase()] ?? t;
}

export function coalesceBriefData(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k0, v] of Object.entries(raw as Record<string, unknown>)) {
    const k = normalizeBriefKey(k0);
    if (typeof v === "boolean") out[k] = v ? "1" : "";
    else if (v == null) out[k] = "";
    else out[k] = String(v);
  }
  return out;
}

function readRawBriefObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function normalizeModuloSnapshot(value: unknown): ProyectoModuloSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const nombre = typeof r.nombre === "string" ? r.nombre.trim() : "";
  if (!nombre) return null;
  return {
    id: typeof r.id === "string" && r.id.trim() ? r.id.trim() : null,
    slug: typeof r.slug === "string" && r.slug.trim() ? r.slug.trim() : null,
    nombre,
  };
}

export function readSaasBriefData(raw: unknown): ProyectoSaasBriefForm {
  const brief = readRawBriefObject(raw);
  const modulosRaw = brief[PROYECTO_SAAS_BRIEF_KEYS.modulosNecesarios];
  const modulos = Array.isArray(modulosRaw)
    ? modulosRaw.map(normalizeModuloSnapshot).filter((m): m is ProyectoModuloSnapshot => m != null)
    : [];
  return {
    empresa_nombre:
      typeof brief[PROYECTO_SAAS_BRIEF_KEYS.empresaNombre] === "string"
        ? String(brief[PROYECTO_SAAS_BRIEF_KEYS.empresaNombre])
        : "",
    whatsapp_contacto:
      typeof brief[PROYECTO_SAAS_BRIEF_KEYS.whatsappContacto] === "string"
        ? String(brief[PROYECTO_SAAS_BRIEF_KEYS.whatsappContacto])
        : "",
    observaciones:
      typeof brief[PROYECTO_SAAS_BRIEF_KEYS.observaciones] === "string"
        ? String(brief[PROYECTO_SAAS_BRIEF_KEYS.observaciones])
        : "",
    modulos_necesarios: modulos,
  };
}

/** Merge superficial: nuevas claves pisan las existentes; no elimina claves no enviadas. */
export function mergeBriefDataPatch(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...existing }
      : {};
  for (const [k0, v] of Object.entries(patch)) {
    const k = normalizeBriefKey(k0);
    if (v === undefined) continue;
    if (v === null) {
      delete base[k];
      continue;
    }
    base[k] = v;
  }
  return base;
}

export function formatMontoPyg(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("es-PY", {
      style: "currency",
      currency: "PYG",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return String(n);
  }
}

export function formatFechaPyFull(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

export function formatDurationHuman(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h} h ${mm} min`;
}

export function slaTipoSnapshotLabel(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    interno: "SLA interno",
    cliente: "SLA cliente",
    pausado: "Pausado",
    final: "Final (sin acumular SLA)",
  };
  return map[t] ?? (t ? t : "—");
}

/**
 * Preserva claves extra del JSON y actualiza solo los campos del formulario de Datos.
 */
export function applyBriefFormToExisting(
  existingRaw: unknown,
  form: Record<string, string>
): Record<string, unknown> {
  const base =
    existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
      ? { ...(existingRaw as Record<string, unknown>) }
      : {};
  for (const f of PROYECTO_DATOS_BRIEF_FIELDS) {
    const v = form[f.key] ?? "";
    if (f.kind === "checkbox") {
      if (v === "1") base[f.key] = true;
      else delete base[f.key];
    } else {
      const t = v.trim();
      if (!t) delete base[f.key];
      else base[f.key] = t;
    }
  }
  return base;
}

export function applySaasFormToExisting(
  existingRaw: unknown,
  form: ProyectoSaasBriefForm
): Record<string, unknown> {
  const base = readRawBriefObject(existingRaw);
  const next = { ...base };
  const empresa = form.empresa_nombre.trim();
  const whatsapp = form.whatsapp_contacto.trim();
  const observaciones = form.observaciones.trim();
  const modulos = form.modulos_necesarios
    .map(normalizeModuloSnapshot)
    .filter((m): m is ProyectoModuloSnapshot => m != null);

  if (empresa) next[PROYECTO_SAAS_BRIEF_KEYS.empresaNombre] = empresa;
  else delete next[PROYECTO_SAAS_BRIEF_KEYS.empresaNombre];
  if (whatsapp) next[PROYECTO_SAAS_BRIEF_KEYS.whatsappContacto] = whatsapp;
  else delete next[PROYECTO_SAAS_BRIEF_KEYS.whatsappContacto];
  if (observaciones) next[PROYECTO_SAAS_BRIEF_KEYS.observaciones] = observaciones;
  else delete next[PROYECTO_SAAS_BRIEF_KEYS.observaciones];
  if (modulos.length > 0) next[PROYECTO_SAAS_BRIEF_KEYS.modulosNecesarios] = modulos;
  else delete next[PROYECTO_SAAS_BRIEF_KEYS.modulosNecesarios];

  return next;
}
