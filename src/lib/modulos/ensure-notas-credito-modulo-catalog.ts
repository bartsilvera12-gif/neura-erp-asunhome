import type { AppSupabaseClient } from "@/lib/supabase/schema";

const SLUG = "notas_credito";
const NOMBRE = "Notas de crédito";

/**
 * Garantiza que el catálogo `modulos` (esquema del cliente Supabase, p. ej. zentra_erp)
 * tenga la fila de Notas de crédito. Así el admin puede habilitarla sin depender de
 * migraciones SQL aplicadas a mano.
 */
export async function ensureNotasCreditoModuloInCatalog(
  supabase: AppSupabaseClient
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: existing, error: selErr } = await supabase
    .from("modulos")
    .select("id")
    .eq("slug", SLUG)
    .maybeSingle();

  if (selErr) {
    return { ok: false, message: selErr.message };
  }
  if (existing && typeof (existing as { id?: unknown }).id === "string") {
    return { ok: true };
  }

  const { error: insErr } = await supabase.from("modulos").insert({
    nombre: NOMBRE,
    slug: SLUG,
  });

  if (insErr) {
    if (insErr.code === "23505") {
      return { ok: true };
    }
    return { ok: false, message: insErr.message };
  }

  return { ok: true };
}
