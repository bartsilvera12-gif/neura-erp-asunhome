import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { evaluateNotaCreditoCreationGate } from "./evaluate-creation-gate";

/**
 * Bloquea pipeline SIFEN NC si aún aplica cancelación prioritaria del DE de la factura.
 */
export async function assertNcSifenSinVentanaCancelacionDe(
  supabase: AppSupabaseClient,
  empresaId: string,
  facturaId: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const g = await evaluateNotaCreditoCreationGate(supabase, empresaId, facturaId);
  const bloqueoCancel = (g.motivo_bloqueo ?? "").toLowerCase().includes("cancelar");
  if (!g.puede_crear && bloqueoCancel) {
    return {
      ok: false,
      status: 409,
      message:
        g.motivo_bloqueo ??
        "Todavía podés cancelar el documento electrónico; no corresponde enviar nota de crédito a SIFEN.",
    };
  }
  return { ok: true };
}
