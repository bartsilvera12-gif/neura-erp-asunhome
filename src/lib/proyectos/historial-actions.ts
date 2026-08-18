import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/schema";

export async function cerrarSegmentoHistorialAbierto(
  sb: AppSupabaseClient,
  empresaId: string,
  proyectoId: string
): Promise<void> {
  const { data: open, error } = await sb
    .from("proyecto_estado_historial")
    .select("id, entered_at")
    .eq("empresa_id", empresaId)
    .eq("proyecto_id", proyectoId)
    .is("exited_at", null)
    .order("entered_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !open || typeof open !== "object") return;
  const o = open as { id: string; entered_at: string };
  const entered = Date.parse(o.entered_at);
  const duration = Number.isFinite(entered) ? Math.floor((Date.now() - entered) / 1000) : 0;

  await sb
    .from("proyecto_estado_historial")
    .update({ exited_at: new Date().toISOString(), duration_seconds: duration })
    .eq("id", o.id)
    .eq("empresa_id", empresaId);
}

export async function insertHistorialCambioEstado(input: {
  sb: AppSupabaseClient;
  empresaId: string;
  proyectoId: string;
  estadoAnteriorId: string | null;
  estadoNuevoId: string;
  tipoSlaSnapshot: string;
  changedBy: string | null;
}): Promise<void> {
  const { sb, empresaId, proyectoId, estadoAnteriorId, estadoNuevoId, tipoSlaSnapshot, changedBy } = input;
  const { error } = await sb.from("proyecto_estado_historial").insert({
    empresa_id: empresaId,
    proyecto_id: proyectoId,
    estado_anterior_id: estadoAnteriorId,
    estado_nuevo_id: estadoNuevoId,
    changed_by: changedBy,
    tipo_sla_snapshot: tipoSlaSnapshot,
  });
  if (error) throw new Error(error.message);
}
