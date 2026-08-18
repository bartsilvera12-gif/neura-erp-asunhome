import type { AppSupabaseClient } from "@/lib/supabase/schema";

const OMNICANAL_CATALOGO: readonly { nombre: string; slug: string }[] = [
  { nombre: "Historial omnicanal", slug: "historial-omnicanal" },
  { nombre: "Conversaciones finalizadas", slug: "conversaciones-finalizadas" },
  { nombre: "Monitoreo", slug: "monitoreo" },
  { nombre: "Omnicanal (paquete)", slug: "omnicanal" },
];

/**
 * Garantiza filas en `modulos` del esquema PostgREST del cliente (p. ej. zentra_erp).
 * Sin esto, migraciones que solo tocan `public.modulos` no aparecen en /api/admin/modulos.
 */
export async function ensureOmnicanalModulosInCatalog(
  supabase: AppSupabaseClient
): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const row of OMNICANAL_CATALOGO) {
    const { data: existing, error: selErr } = await supabase
      .from("modulos")
      .select("id")
      .eq("slug", row.slug)
      .maybeSingle();

    if (selErr) {
      return { ok: false, message: selErr.message };
    }
    if (existing && typeof (existing as { id?: unknown }).id === "string") {
      continue;
    }

    const { error: insErr } = await supabase.from("modulos").insert({
      nombre: row.nombre,
      slug: row.slug,
    });

    if (insErr) {
      if (insErr.code === "23505") {
        continue;
      }
      return { ok: false, message: insErr.message };
    }
  }

  return { ok: true };
}
