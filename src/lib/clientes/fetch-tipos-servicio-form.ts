import { apiFetch } from "@/lib/api/fetch-with-supabase-session";
import {
  LABEL_FALLBACK_POR_SLUG,
  type ClienteTipoServicioRow,
  SLUGS_TIPOS_CLIENTE_SISTEMA,
} from "@/lib/clientes/tipo-servicio-catalogo";

/** Opciones mínimas si el catálogo aún no responde. */
export function filasTiposDesdeSistemaEstatico(): ClienteTipoServicioRow[] {
  const now = new Date().toISOString();
  return SLUGS_TIPOS_CLIENTE_SISTEMA.map((slug, i) => ({
    id: `st-${slug}`,
    empresa_id: "",
    slug,
    nombre: LABEL_FALLBACK_POR_SLUG[slug],
    activo: true,
    orden: (i + 1) * 10,
    es_sistema: true,
    created_at: now,
    updated_at: now,
  }));
}

export async function fetchTiposFormCliente(includeSlug?: string | null): Promise<ClienteTipoServicioRow[]> {
  const p = new URLSearchParams();
  p.set("form", "1");
  const t = (includeSlug ?? "").trim();
  if (t) p.set("include_slug", t.toLowerCase());
  const res = await apiFetch("/api/cliente-tipos-servicio?" + p.toString());
  if (!res.ok) return filasTiposDesdeSistemaEstatico();
  const j = (await res.json().catch(() => ({}))) as { success?: boolean; data?: ClienteTipoServicioRow[] };
  if (j?.success && Array.isArray(j.data) && j.data.length > 0) return j.data;
  return filasTiposDesdeSistemaEstatico();
}
