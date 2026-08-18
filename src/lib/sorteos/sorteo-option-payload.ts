/**
 * Helpers puros para UI / cliente — sin `pg` ni Supabase server.
 * (Evita que `"use client"` importe `sorteo-order-from-chat` y bundlee `pg`.)
 */

/**
 * En el JSON `option_payload` del botón que cierra la compra (después de resumen/datos), incluir:
 * `{ "confirmar_orden_sorteo": true }` (o `finalize_sorteo_order` / `cerrar_compra_sorteo`).
 */
export function optionPayloadFinalizesSorteoOrder(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const o = payload as Record<string, unknown>;
  for (const k of ["confirmar_orden_sorteo", "finalize_sorteo_order", "cerrar_compra_sorteo"] as const) {
    const v = o[k];
    if (v === true || v === "true" || v === "1" || v === 1) return true;
  }
  return false;
}
