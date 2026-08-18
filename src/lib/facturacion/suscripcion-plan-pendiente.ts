import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { hoyYmdLocal, toCalendarDateStr } from "@/lib/fechas/calendario";

/**
 * Aplica en la fila de suscripción el plan/precio pendiente si `hoy >= plan_pendiente_vigente_desde`.
 */
export async function aplicarPlanPendienteSiVencido(opts: {
  supabase: AppSupabaseClient;
  empresaId: string;
  suscripcionId: string;
}): Promise<{ applied: boolean }> {
  const { supabase, empresaId, suscripcionId } = opts;
  const hoy = hoyYmdLocal();

  const { data: s, error: errRead } = await supabase
    .from("suscripciones")
    .select("id, plan_pendiente_id, precio_pendiente, moneda_pendiente, plan_pendiente_vigente_desde")
    .eq("id", suscripcionId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (errRead || !s?.plan_pendiente_id) return { applied: false };
  const desde = toCalendarDateStr(
    s.plan_pendiente_vigente_desde as string | null
  );
  if (!desde) return { applied: false };
  if (hoy < desde) return { applied: false };

  const prec = Number(s.precio_pendiente);
  if (!Number.isFinite(prec) || prec <= 0) return { applied: false };
  const mon = s.moneda_pendiente === "USD" ? "USD" : "GS";

  const { error: errUpd } = await supabase
    .from("suscripciones")
    .update({
      plan_id: s.plan_pendiente_id,
      precio: prec,
      moneda: mon,
      plan_pendiente_id: null,
      precio_pendiente: null,
      moneda_pendiente: null,
      plan_pendiente_vigente_desde: null,
    })
    .eq("id", suscripcionId)
    .eq("empresa_id", empresaId);

  if (errUpd) {
    console.error("[aplicarPlanPendienteSiVencido]", errUpd.message);
    return { applied: false };
  }
  return { applied: true };
}
