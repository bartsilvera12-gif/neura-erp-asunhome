import type { ModulosSupabase } from "@/lib/modulos/resolve-effective-modules";

/** Si la empresa tiene cualquiera de estos módulos activos, deben existir también los slugs `SYNC_CHILD_SLUGS`. */
const PARENT_TRIGGER_SLUGS = new Set(["conversaciones", "omnicanal"]);

/** Submódulos dashboard omnicanal (slug en `modulos.slug`, alineado con `route-slug-map`). */
const SYNC_CHILD_SLUGS = ["historial-omnicanal", "conversaciones-finalizadas", "monitoreo"] as const;

export type EnsureOmnicanalEmpresaModulosResult =
  | { ok: true; added: number; reactivated: number }
  | { ok: false; error: string };

/**
 * Garantiza filas activas en `empresa_modulos` para historial / finalizadas / monitoreo
 * cuando la empresa tiene `conversaciones` u `omnicanal` habilitados.
 *
 * Idempotente: no duplica; reactiva `activo` si ya existía la fila apagada.
 */
export async function ensureOmnicanalDashboardEmpresaModulos(
  supabase: ModulosSupabase,
  empresaId: string
): Promise<EnsureOmnicanalEmpresaModulosResult> {
  const { data: emAll, error: errEm } = await supabase
    .from("empresa_modulos")
    .select("modulo_id, activo")
    .eq("empresa_id", empresaId);

  if (errEm) return { ok: false, error: errEm.message };

  type EmRow = { modulo_id?: unknown; activo?: unknown };
  const rows = (emAll ?? []) as EmRow[];
  const activeIds = rows.filter((r: EmRow) => r.activo).map((r: EmRow) => String(r.modulo_id ?? ""));
  if (activeIds.length === 0) {
    return { ok: true, added: 0, reactivated: 0 };
  }

  const { data: activeMods, error: errMods } = await supabase
    .from("modulos")
    .select("slug")
    .in("id", activeIds);

  if (errMods) return { ok: false, error: errMods.message };

  type ModSlug = { slug?: unknown };
  const hasTrigger = ((activeMods ?? []) as ModSlug[]).some((m: ModSlug) =>
    PARENT_TRIGGER_SLUGS.has(String(m.slug ?? "").trim().toLowerCase())
  );
  if (!hasTrigger) {
    return { ok: true, added: 0, reactivated: 0 };
  }

  const { data: childMods, error: errChild } = await supabase
    .from("modulos")
    .select("id")
    .in("slug", [...SYNC_CHILD_SLUGS]);

  if (errChild) return { ok: false, error: errChild.message };

  const children = childMods ?? [];
  if (children.length === 0) {
    return { ok: true, added: 0, reactivated: 0 };
  }

  const existing = new Map(rows.map((r: EmRow) => [String(r.modulo_id ?? ""), Boolean(r.activo)]));
  const toInsert: { empresa_id: string; modulo_id: string; activo: boolean }[] = [];
  const toReactivate: string[] = [];

  for (const c of children) {
    const mid = String((c as { id: string }).id ?? "");
    if (!mid) continue;
    const st = existing.get(mid);
    if (st === undefined) {
      toInsert.push({ empresa_id: empresaId, modulo_id: mid, activo: true });
    } else if (st === false) {
      toReactivate.push(mid);
    }
  }

  let added = 0;
  let reactivated = 0;

  if (toInsert.length > 0) {
    const { error: errIns } = await supabase.from("empresa_modulos").insert(toInsert);
    if (errIns) return { ok: false, error: errIns.message };
    added = toInsert.length;
  }

  for (const moduloId of toReactivate) {
    const { error: errUp } = await supabase
      .from("empresa_modulos")
      .update({ activo: true })
      .eq("empresa_id", empresaId)
      .eq("modulo_id", moduloId);
    if (errUp) return { ok: false, error: errUp.message };
    reactivated++;
  }

  return { ok: true, added, reactivated };
}
