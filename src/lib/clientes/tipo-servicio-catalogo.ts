import type { AppSupabaseClient } from "@/lib/supabase/schema";

export interface ClienteTipoServicioRow {
  id: string;
  empresa_id: string;
  slug: string;
  nombre: string;
  activo: boolean;
  orden: number;
  es_sistema: boolean;
  created_at: string;
  updated_at: string;
  /** Conteo de clientes con este slug; solo con ?with_usos=1 (config). */
  usos?: number;
}

/** Slugs fijos; la lógica (marketing) depende de estos códigos. */
export const SLUGS_TIPOS_CLIENTE_SISTEMA = [
  "marketing",
  "saas",
  "branding",
  "web",
  "otro",
] as const;
export type SlugTipoClienteSistema = (typeof SLUGS_TIPOS_CLIENTE_SISTEMA)[number];

export const LABEL_FALLBACK_POR_SLUG: Record<SlugTipoClienteSistema, string> = {
  marketing: "Marketing",
  saas: "SaaS",
  branding: "Branding",
  web: "Web",
  otro: "Otro",
};

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG = 64;

/**
 * Nombre amigable para un slug: primero el mapa `porSlug` (nombres desde
 * `cliente_tipos_servicio_catalogo.nombre` en UI/API). Si no hay mapa, fallback
 * a etiquetas fijas; no sustituye el valor en base de datos.
 */
export function etiquetaVisibleTipoServicio(
  slug: string | null | undefined,
  porSlug?: Readonly<Record<string, string>>
): string {
  if (!slug || !String(slug).trim()) return "—";
  const t = String(slug).trim().toLowerCase();
  if (porSlug && porSlug[t]) return porSlug[t]!;
  if (t in LABEL_FALLBACK_POR_SLUG) return LABEL_FALLBACK_POR_SLUG[t as SlugTipoClienteSistema];
  return t
    .split("-")
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : ""))
    .filter(Boolean)
    .join(" ");
}

export function generarSlugDesdeNombre(
  nombre: string,
  existentes: Set<string> | string[]
): string {
  const sset = existentes instanceof Set ? existentes : new Set(existentes);
  const n =
    typeof nombre === "string"
      ? nombre
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, MAX_SLUG)
      : "";
  let b = n || "segmento";
  if (!SLUG_RE.test(b)) b = "segmento";
  let c = b;
  let k = 2;
  for (let i = 0; i < 5_000 && sset.has(c); i += 1) {
    c = `${b}-${k++}`.slice(0, MAX_SLUG);
  }
  return c;
}

export function normalizeSlug(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

const SEED_ROWS: { slug: SlugTipoClienteSistema; nombre: string; orden: number }[] = [
  { slug: "marketing", nombre: "Marketing", orden: 10 },
  { slug: "saas", nombre: "SaaS", orden: 20 },
  { slug: "branding", nombre: "Branding", orden: 30 },
  { slug: "web", nombre: "Web", orden: 40 },
  { slug: "otro", nombre: "Otro", orden: 50 },
];

const SLUGS_SISTEMA_LIST = SEED_ROWS.map((r) => r.slug) as string[];

/**
 * Asegura que existan los 5 slugs de sistema (una fila por `empresa_id` + `slug`).
 * **Solo inserta** si falta; no hace `upsert` con nombre por defecto, porque eso
 * pisa en cada GET/PUT el `nombre` visible que el admin editó en DB.
 */
export async function ensureSemillasCatalogoTipos(
  supabase: AppSupabaseClient,
  empresaId: string
): Promise<void> {
  const { data: present, error: e0 } = await supabase
    .from("cliente_tipos_servicio_catalogo")
    .select("slug")
    .eq("empresa_id", empresaId)
    .in("slug", SLUGS_SISTEMA_LIST);
  if (e0) {
    console.error("[cliente_tipos_catalogo] ensureSemillas", e0.message);
    return;
  }
  const have = new Set((present ?? []).map((r: { slug: string }) => r.slug));
  for (const r of SEED_ROWS) {
    if (have.has(r.slug)) continue;
    const { error: e1 } = await supabase.from("cliente_tipos_servicio_catalogo").insert({
      empresa_id: empresaId,
      slug: r.slug,
      nombre: r.nombre,
      activo: true,
      es_sistema: true,
      orden: r.orden,
    });
    if (e1) {
      const m = e1.message.toLowerCase();
      if (m.includes("unique") || m.includes("duplicate")) {
        have.add(r.slug);
        continue;
      }
      console.error("[cliente_tipos_catalogo] ensureSemillas insert", r.slug, e1.message);
    } else {
      have.add(r.slug);
    }
  }
}

export async function tipoServicioSlugValido(
  supabase: AppSupabaseClient,
  empresaId: string,
  slug: string
): Promise<boolean> {
  const t = normalizeSlug(slug);
  if (!t) return false;
  const { data, error } = await supabase
    .from("cliente_tipos_servicio_catalogo")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("slug", t)
    .maybeSingle();
  if (error) {
    console.error("[cliente_tipos_catalogo] tipoServicioSlugValido", error.message);
    return false;
  }
  return data != null;
}

export async function contarClientesPorSlug(
  supabase: AppSupabaseClient,
  empresaId: string,
  slug: string
): Promise<number> {
  const t = normalizeSlug(slug);
  if (!t) return 0;
  const { count, error } = await supabase
    .from("clientes")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .is("deleted_at", null)
    .eq("tipo_servicio_cliente", t);
  if (error) {
    console.error("[cliente_tipos_catalogo] contarClientesPorSlug", error.message);
    return 0;
  }
  return count ?? 0;
}
