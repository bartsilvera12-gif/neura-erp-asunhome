import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type { UsuarioConEmpresa } from "@/lib/middleware/auth";
import type { ModoCambioPlan } from "@/lib/facturacion/cambio-plan-cliente-types";

const TIPO_CAMBIO_PLAN = "suscripcion_cambio_plan";

/**
 * Registro persistente (tabla `cliente_historial` en el schema de datos) complementario a `emitEvent`.
 */
export async function registrarClienteHistorialCambioPlan(
  supabase: AppSupabaseClient,
  opts: {
    auth: UsuarioConEmpresa;
    empresaId: string;
    clienteId: string;
    suscripcionId: string;
    planAnteriorId: string | null;
    planNuevoId: string;
    modo: ModoCambioPlan;
    facturaId: string | null;
    planPendienteVigenteDesde: string | null;
    detalle: Record<string, unknown>;
  }
): Promise<void> {
  const {
    auth,
    empresaId,
    clienteId,
    suscripcionId,
    planAnteriorId,
    planNuevoId,
    modo,
    facturaId,
    planPendienteVigenteDesde,
    detalle,
  } = opts;

  let planAnteriorNombre: string | null = null;
  if (planAnteriorId) {
    const { data: pa } = await supabase
      .from("planes")
      .select("nombre")
      .eq("id", planAnteriorId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    planAnteriorNombre = pa?.nombre ? String(pa.nombre) : null;
  }

  const { data: pn } = await supabase
    .from("planes")
    .select("nombre")
    .eq("id", planNuevoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const planNuevoNombre = pn?.nombre ? String(pn.nombre) : null;

  const { error } = await supabase.from("cliente_historial").insert({
    empresa_id: empresaId,
    cliente_id: clienteId,
    suscripcion_id: suscripcionId,
    tipo: TIPO_CAMBIO_PLAN,
    accion: "Cambio de plan (suscripción)",
    plan_anterior_id: planAnteriorId,
    plan_nuevo_id: planNuevoId,
    plan_anterior_nombre: planAnteriorNombre,
    plan_nuevo_nombre: planNuevoNombre,
    modo,
    factura_id: facturaId,
    plan_pendiente_vigente_desde: planPendienteVigenteDesde,
    creado_por_auth_user_id: auth.user?.id ?? null,
    creado_por_email: auth.user?.email ?? null,
    detalle: { ...detalle, evento: "suscripcion_plan_cambiada", at_iso: new Date().toISOString() },
  });
  if (error) {
    console.error("[registrarClienteHistorialCambioPlan]", error.message);
    throw new Error(`No se pudo guardar el historial del cliente: ${error.message}`);
  }
}

export type ClienteHistorialRow = {
  id: string;
  created_at: string;
  accion: string;
  tipo: string;
  plan_anterior_nombre: string | null;
  plan_nuevo_nombre: string | null;
  modo: string | null;
  factura_id: string | null;
  plan_pendiente_vigente_desde: string | null;
  creado_por_email: string | null;
  creado_por_auth_user_id: string | null;
  detalle: Record<string, unknown>;
};
