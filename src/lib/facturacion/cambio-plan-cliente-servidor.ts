import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type { UsuarioConEmpresa } from "@/lib/middleware/auth";
import { hoyYmdLocal, toCalendarDateStr } from "@/lib/fechas/calendario";
import { montosFacturaItemParaInsert } from "./factura-item-montos";
import { buildSifenCancelacionPreview, normalizePlazoCancelacionHoras } from "@/lib/sifen/sifen-cancelacion-rules";
import { aplicarPlanPendienteSiVencido } from "./suscripcion-plan-pendiente";
import { emitEvent, EVENT_TYPES } from "@/lib/integrations/events";
import { registrarClienteHistorialCambioPlan } from "@/lib/auditoria/cliente-historial-servidor";
import type { CasoCambioPlan, CambioPlanContexto, ModoCambioPlan } from "./cambio-plan-cliente-types";

export type { CasoCambioPlan, CambioPlanContexto, ModoCambioPlan } from "./cambio-plan-cliente-types";

type RowFe = {
  id: string;
  estado_sifen: string | null;
  sifen_aprobado_at: string | null;
  sifen_cancelado_at: string | null;
};

function primerDiaSiguienteMesYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m0 = d.getMonth();
  const n = new Date(y, m0 + 1, 1);
  return hoyYmdLocal(n);
}

function rangoMesStrLocal(d: Date = new Date()): { mesStr: string; mesSig: string } {
  const y = d.getFullYear();
  const m0 = d.getMonth();
  const m = m0 + 1;
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  const mesStr = `${y}-${String(m).padStart(2, "0")}`;
  const mesSig = `${nextY}-${String(nextM).padStart(2, "0")}`;
  return { mesStr, mesSig };
}

export async function cargarContextoCambioPlanCliente(
  supabase: AppSupabaseClient,
  auth: UsuarioConEmpresa,
  clienteId: string
): Promise<CambioPlanContexto> {
  const hoy = hoyYmdLocal();
  const vigenciaProximoMes = primerDiaSiguienteMesYmd();
  const { mesStr, mesSig } = rangoMesStrLocal();
  const empresaId = auth.empresa_id;

  const { data: planes, error: errP } = await supabase
    .from("planes")
    .select("id, nombre, precio, moneda")
    .eq("empresa_id", empresaId)
    .eq("estado", "activo")
    .order("nombre", { ascending: true });

  if (errP) {
    throw new Error(errP.message);
  }

  const planesDto =
    (planes as { id: string; nombre: string; precio: number; moneda: string }[] | null)?.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precio: Number(p.precio) || 0,
      moneda: p.moneda === "USD" ? "USD" : "GS",
    })) ?? [];

  const empty: CambioPlanContexto = {
    caso: "sin_suscripcion",
    aviso: "Este cliente no tiene suscripción activa. El cambio de plan aplica a clientes con suscripción mensual.",
    avisoBloqueo: null,
    hoy,
    vigenciaProximoMes,
    modos_permitidos: [],
    factura_id_periodo: null,
    factura_monto: null,
    factura_saldo: null,
    factura_moneda: null,
    factura_estado: null,
    sifen: {
      tiene_de: false,
      estado: null,
      aprobado: false,
      plazo_cancelacion_horas: 48,
      cancelacion: null,
    },
    tieneFacturaComercialPeriodo: false,
    puedeActualizarFacturaPendiente: false,
    suscripcion: null,
    planes: planesDto,
  };

  const { data: susAntes } = await supabase
    .from("suscripciones")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("empresa_id", empresaId)
    .eq("estado", "activa")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (susAntes?.id) {
    await aplicarPlanPendienteSiVencido({
      supabase,
      empresaId,
      suscripcionId: String(susAntes.id),
    });
  }

  const { data: suscripcion, error: errS } = await supabase
    .from("suscripciones")
    .select(
      "id, plan_id, precio, moneda, plan_pendiente_id, precio_pendiente, moneda_pendiente, plan_pendiente_vigente_desde"
    )
    .eq("cliente_id", clienteId)
    .eq("empresa_id", empresaId)
    .eq("estado", "activa")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (errS) throw new Error(errS.message);
  if (!suscripcion) return empty;

  const planVigId = (suscripcion as { plan_id: string | null }).plan_id;
  let planNombre = "—";
  if (planVigId) {
    const { data: pCur } = await supabase
      .from("planes")
      .select("nombre")
      .eq("id", planVigId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    planNombre = pCur?.nombre ? String(pCur.nombre) : "—";
  }

  const planPendId = (suscripcion as { plan_pendiente_id: string | null }).plan_pendiente_id;
  let planPendienteNombre: string | null = null;
  if (planPendId) {
    const { data: pnp } = await supabase
      .from("planes")
      .select("nombre")
      .eq("id", planPendId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    planPendienteNombre = pnp?.nombre ? String(pnp.nombre) : null;
  }

  const suscId = String(suscripcion.id);
  const planPendVig = (suscripcion as { plan_pendiente_vigente_desde?: string | null })
    .plan_pendiente_vigente_desde
    ? toCalendarDateStr(
        (suscripcion as { plan_pendiente_vigente_desde: string | null }).plan_pendiente_vigente_desde
      )
    : null;

  const susResumen = {
    id: suscId,
    plan_id: (suscripcion as { plan_id: string | null }).plan_id,
    plan_nombre: planNombre,
    precio: Number((suscripcion as { precio: number }).precio) || 0,
    moneda: (suscripcion as { moneda: string }).moneda === "USD" ? "USD" : "GS",
    plan_pendiente_id: planPendId,
    plan_pendiente_nombre: planPendId ? planPendienteNombre : null,
    plan_pendiente_vigente_desde: planPendVig,
  };

  const { data: sifenCfg } = await supabase
    .from("empresa_sifen_config")
    .select("sifen_plazo_cancelacion_horas, activo")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  const plazoH = normalizePlazoCancelacionHoras(
    sifenCfg && typeof sifenCfg === "object" ? (sifenCfg as { sifen_plazo_cancelacion_horas?: unknown })
        .sifen_plazo_cancelacion_horas : 48
  );

  const { data: facturas } = await supabase
    .from("facturas")
    .select("id, monto, saldo, estado, tipo, fecha, moneda")
    .eq("empresa_id", empresaId)
    .eq("cliente_id", clienteId)
    .eq("suscripcion_id", suscId)
    .eq("tipo", "suscripcion")
    .neq("estado", "Anulado")
    .gte("fecha", `${mesStr}-01`)
    .lt("fecha", `${mesSig}-01`)
    .order("fecha", { ascending: false });

  const fact = facturas && facturas.length > 0 ? (facturas[0] as Record<string, unknown>) : null;
  const facturaId = fact ? String(fact.id) : null;
  const montoF = fact ? Number(fact.monto) : null;
  const saldoF = fact ? Number(fact.saldo) : null;
  const fMon = fact && fact.moneda != null ? String(fact.moneda) : null;
  const estF = fact ? String(fact.estado) : null;

  let fe: RowFe | null = null;
  if (facturaId) {
    const { data: dfe } = await supabase
      .from("factura_electronica")
      .select("id, estado_sifen, sifen_aprobado_at, sifen_cancelado_at")
      .eq("empresa_id", empresaId)
      .eq("factura_id", facturaId)
      .limit(1)
      .maybeSingle();
    if (dfe) fe = dfe as RowFe;
  }

  let pagosCount = 0;
  if (facturaId) {
    const { count } = await supabase
      .from("pagos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("factura_id", facturaId);
    pagosCount = count ?? 0;
  }

  const estadoS = fe?.estado_sifen == null ? "" : String(fe.estado_sifen).trim();
  const aprobadoSifen = estadoS === "aprobado";

  const cancelacion = fe
    ? buildSifenCancelacionPreview({
        estadoSifen: estadoS,
        sifenAprobadoAtIso: fe.sifen_aprobado_at,
        sifenCanceladoAtIso: fe.sifen_cancelado_at,
        plazoHoras: plazoH,
        pagosCount,
        nowMs: Date.now(),
      })
    : null;

  const tieneFacturaComercialPeriodo = Boolean(fact);
  const puedeActualizarFacturaPendiente =
    Boolean(fact) &&
    !aprobadoSifen &&
    estF !== "Pagado" &&
    (estF === "Pendiente" || estF === "Vencido") &&
    pagosCount === 0;

  let caso: CasoCambioPlan;
  let aviso: string | null = null;
  let avisoBloqueo: string | null = null;
  const modos: ModoCambioPlan[] = ["proximo_mes"];

  if (!tieneFacturaComercialPeriodo) {
    caso = "A";
    modos.push("inmediato");
  } else if (aprobadoSifen) {
    if (cancelacion?.puede_cancelar) {
      caso = "C";
      aviso =
        "Esta factura del período tiene DE aprobado por SIFEN. No se modifica el documento electrónico automáticamente. Puede programar el cambio desde el próximo mes, o anular el DE en el plazo permitido (sin pagos) desde la pantalla de la factura y luego reintentar.";
    } else {
      caso = "D";
      avisoBloqueo =
        "No se puede modificar el plan del período actual: el DE está aprobado y superó el plazo de cancelación, o la factura tiene abonos. El ajuste debe respetar el flujo SIFEN (nota de crédito y normativa).";
      aviso =
        "Puede dejar un cambio de plan programado para el 1° del mes siguiente. Luego, regularice con nota de crédito aprobada si aún corresponde ajuste fiscal del documento del período.";
    }
  } else {
    caso = "B";
    aviso =
      "Existe factura de suscripción del mes actual. Puede recalcular el asiento comercial mientras el DE no esté aprobado, o dejar el cambio para el próximo mes sin tocar este mes.";
    if (puedeActualizarFacturaPendiente) {
      modos.push("actualizar_factura_pendiente");
    }
  }

  if (caso === "B" && tieneFacturaComercialPeriodo && !puedeActualizarFacturaPendiente) {
    const extra = aprobadoSifen
      ? ""
      : "La factura del mes tiene pago o un estado que impide ajustar el monto automáticamente. ";
    aviso = extra + "Puede programar el cambio desde el próximo mes.";
  }

  if (susResumen.plan_pendiente_id && susResumen.plan_pendiente_vigente_desde) {
    aviso =
      (aviso ? `${aviso} ` : "") +
      `Cambio programado: aplica desde el ${susResumen.plan_pendiente_vigente_desde}.`;
  }

  if (susResumen.precio <= 0) {
    aviso = (aviso ? `${aviso} ` : "") + "Verifique el precio de la suscripción actual (debe ser > 0).";
  }

  return {
    caso,
    aviso,
    avisoBloqueo,
    hoy,
    vigenciaProximoMes,
    modos_permitidos: modos,
    factura_id_periodo: facturaId,
    factura_monto: montoF,
    factura_saldo: saldoF,
    factura_moneda: fMon,
    factura_estado: estF,
    sifen: {
      tiene_de: fe != null,
      estado: fe ? estadoS : null,
      aprobado: aprobadoSifen,
      plazo_cancelacion_horas: plazoH,
      cancelacion,
    },
    tieneFacturaComercialPeriodo,
    puedeActualizarFacturaPendiente,
    suscripcion: susResumen,
    planes: planesDto,
  };
}

export async function ejecutarCambioPlanCliente(
  supabase: AppSupabaseClient,
  auth: UsuarioConEmpresa,
  input: { clienteId: string; planId: string; modo: ModoCambioPlan }
): Promise<CambioPlanContexto> {
  const empresaId = auth.empresa_id;
  const { planId, modo, clienteId } = input;
  if (!clienteId || !planId) {
    throw new Error("cliente y plan son obligatorios");
  }

  const ctx0 = await cargarContextoCambioPlanCliente(supabase, auth, clienteId);
  if (!ctx0.suscripcion) {
    throw new Error("No hay suscripción activa");
  }
  if (!ctx0.modos_permitidos.includes(modo)) {
    throw new Error("Esta acción no está permitida con las reglas fiscales actuales");
  }

  const { data: plan, error: errPl } = await supabase
    .from("planes")
    .select("id, nombre, precio, moneda, empresa_id, estado")
    .eq("id", planId)
    .eq("empresa_id", empresaId)
    .eq("estado", "activo")
    .maybeSingle();
  if (errPl) throw new Error(errPl.message);
  if (!plan) throw new Error("Plan no disponible o inactivo");

  const pRow = plan as { id: string; nombre: string; precio: number; moneda: string };
  const nuevoPrecio = Number(pRow.precio);
  if (!Number.isFinite(nuevoPrecio) || nuevoPrecio <= 0) {
    throw new Error("El plan seleccionado no tiene un precio válido");
  }
  const monedaNueva = pRow.moneda === "USD" ? "USD" : "GS";
  const suscId = ctx0.suscripcion.id;

  const { data: sus0 } = await supabase
    .from("suscripciones")
    .select("id, plan_id, precio, moneda, dia_facturacion, dia_vencimiento, cliente_id")
    .eq("id", suscId)
    .eq("empresa_id", empresaId)
    .single();
  if (!sus0) throw new Error("Suscripción no encontrada");
  const planIdAntes = (sus0 as { plan_id: string | null }).plan_id;

  const facturacionRefresh = () => cargarContextoCambioPlanCliente(supabase, auth, clienteId);

  if (modo === "proximo_mes") {
    const vig = primerDiaSiguienteMesYmd();
    const { error: e2 } = await supabase
      .from("suscripciones")
      .update({
        plan_pendiente_id: pRow.id,
        precio_pendiente: nuevoPrecio,
        moneda_pendiente: monedaNueva,
        plan_pendiente_vigente_desde: vig,
      })
      .eq("id", suscId)
      .eq("empresa_id", empresaId);
    if (e2) throw new Error(e2.message);

    await registrarClienteHistorialCambioPlan(supabase, {
      auth,
      empresaId,
      clienteId,
      suscripcionId: suscId,
      planAnteriorId: planIdAntes,
      planNuevoId: pRow.id,
      modo: "proximo_mes",
      facturaId: null,
      planPendienteVigenteDesde: vig,
      detalle: {
        empresa_id: empresaId,
        plan_pendiente_vigente_desde: vig,
        factura_id_periodo: ctx0.factura_id_periodo,
        precio_nuevo: nuevoPrecio,
        moneda_nueva: monedaNueva,
      },
    });
    await emitEvent(EVENT_TYPES.suscripcion_plan_cambiada, {
      empresa_id: empresaId,
      at: new Date().toISOString(),
      suscripcion_id: suscId,
      cliente_id: clienteId,
      plan_anterior_id: planIdAntes,
      plan_nuevo_id: pRow.id,
      modo: "proximo_mes",
      plan_pendiente_vigente_desde: vig,
      factura_id_periodo: ctx0.factura_id_periodo,
      usuario: auth.user?.email ?? null,
    });
    return facturacionRefresh();
  }

  if (modo === "inmediato") {
    if (ctx0.caso !== "A") {
      throw new Error("Cambio inmediato solo aplica sin factura del mes calendario. Use otra modalidad de aplicación.");
    }
    const { error: e1 } = await supabase
      .from("suscripciones")
      .update({
        plan_id: pRow.id,
        precio: nuevoPrecio,
        moneda: monedaNueva,
        plan_pendiente_id: null,
        precio_pendiente: null,
        moneda_pendiente: null,
        plan_pendiente_vigente_desde: null,
      })
      .eq("id", suscId)
      .eq("empresa_id", empresaId);
    if (e1) throw new Error(e1.message);

    await registrarClienteHistorialCambioPlan(supabase, {
      auth,
      empresaId,
      clienteId,
      suscripcionId: suscId,
      planAnteriorId: planIdAntes,
      planNuevoId: pRow.id,
      modo: "inmediato",
      facturaId: null,
      planPendienteVigenteDesde: null,
      detalle: {
        empresa_id: empresaId,
        factura_id_periodo: null,
        precio_nuevo: nuevoPrecio,
        moneda_nueva: monedaNueva,
      },
    });
    await emitEvent(EVENT_TYPES.suscripcion_plan_cambiada, {
      empresa_id: empresaId,
      at: new Date().toISOString(),
      suscripcion_id: suscId,
      cliente_id: clienteId,
      plan_anterior_id: planIdAntes,
      plan_nuevo_id: pRow.id,
      modo: "inmediato",
      factura_id_periodo: null,
      usuario: auth.user?.email ?? null,
    });
    return facturacionRefresh();
  }

  if (modo === "actualizar_factura_pendiente") {
    if (!ctx0.puedeActualizarFacturaPendiente || !ctx0.factura_id_periodo) {
      throw new Error("No se puede actualizar la factura: estado, pagos o DE no lo permiten");
    }
    await actualizarFacturaSuscripcionAlPlan({
      supabase,
      empresaId,
      facturaId: ctx0.factura_id_periodo,
      monto: nuevoPrecio,
      moneda: monedaNueva,
      descripcionLinea: pRow.nombre,
      suscripcionId: suscId,
      planId: pRow.id,
    });

    await registrarClienteHistorialCambioPlan(supabase, {
      auth,
      empresaId,
      clienteId,
      suscripcionId: suscId,
      planAnteriorId: planIdAntes,
      planNuevoId: pRow.id,
      modo: "actualizar_factura_pendiente",
      facturaId: ctx0.factura_id_periodo,
      planPendienteVigenteDesde: null,
      detalle: {
        empresa_id: empresaId,
        precio_nuevo: nuevoPrecio,
        moneda_nueva: monedaNueva,
        factura_afectada_id: ctx0.factura_id_periodo,
      },
    });
    await emitEvent(EVENT_TYPES.suscripcion_plan_cambiada, {
      empresa_id: empresaId,
      at: new Date().toISOString(),
      suscripcion_id: suscId,
      cliente_id: clienteId,
      plan_anterior_id: planIdAntes,
      plan_nuevo_id: pRow.id,
      modo: "actualizar_factura_pendiente",
      factura_id: ctx0.factura_id_periodo,
      usuario: auth.user?.email ?? null,
    });
  }

  return facturacionRefresh();
}

export async function actualizarFacturaSuscripcionAlPlan(opts: {
  supabase: AppSupabaseClient;
  empresaId: string;
  facturaId: string;
  monto: number;
  moneda: "GS" | "USD";
  descripcionLinea: string;
  suscripcionId: string;
  planId: string;
}): Promise<void> {
  const { supabase, empresaId, facturaId, monto, moneda, descripcionLinea, suscripcionId, planId } = opts;

  const { data: fe, error: feE } = await supabase
    .from("factura_electronica")
    .select("id, estado_sifen")
    .eq("empresa_id", empresaId)
    .eq("factura_id", facturaId)
    .limit(1)
    .maybeSingle();
  if (feE) throw new Error(feE.message);
  if (fe && String((fe as { estado_sifen: string }).estado_sifen) === "aprobado") {
    throw new Error("No se modifica la factura: el documento electrónico está aprobado en SIFEN");
  }

  const { data: f, error: fE } = await supabase
    .from("facturas")
    .select("id, monto, saldo, tipo, suscripcion_id")
    .eq("id", facturaId)
    .eq("empresa_id", empresaId)
    .single();
  if (fE) throw new Error(fE.message);
  if (!f) throw new Error("Factura no encontrada");
  if (String((f as { suscripcion_id?: string | null }).suscripcion_id) !== suscripcionId) {
    throw new Error("La factura no corresponde a la suscripción");
  }

  const { data: pagos } = await supabase
    .from("pagos")
    .select("monto")
    .eq("empresa_id", empresaId)
    .eq("factura_id", facturaId);
  const totalPag = (pagos ?? []).reduce(
    (acc, r) => acc + (Number((r as { monto: number }).monto) || 0),
    0
  );
  if (monto < totalPag) {
    throw new Error("El nuevo monto no puede ser menor a los pagos acumulados de la factura");
  }
  const nuevoSaldo = monto - totalPag;
  const linea = montosFacturaItemParaInsert({
    totalLinea: monto,
    moneda,
    cantidad: 1,
    precioUnitario: monto,
  });

  const { data: it } = await supabase
    .from("factura_items")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("factura_id", facturaId)
    .order("created_at", { ascending: true })
    .limit(1);
  const itemId = it && it[0] ? (it[0] as { id: string }).id : null;
  if (!itemId) {
    const { error: iE } = await supabase.from("factura_items").insert({
      factura_id: facturaId,
      empresa_id: empresaId,
      descripcion: descripcionLinea,
      cantidad: 1,
      precio_unitario: linea.precio_unitario,
      subtotal: linea.subtotal,
      iva: linea.iva,
      total: linea.total,
    });
    if (iE) throw new Error(iE.message);
  } else {
    const { error: uI } = await supabase
      .from("factura_items")
      .update({
        descripcion: descripcionLinea,
        cantidad: 1,
        precio_unitario: linea.precio_unitario,
        subtotal: linea.subtotal,
        iva: linea.iva,
        total: linea.total,
      })
      .eq("id", itemId)
      .eq("empresa_id", empresaId);
    if (uI) throw new Error(uI.message);
  }

  const { error: uF } = await supabase
    .from("facturas")
    .update({ monto, saldo: nuevoSaldo, moneda })
    .eq("id", facturaId)
    .eq("empresa_id", empresaId);
  if (uF) throw new Error(uF.message);

  const { error: uS } = await supabase
    .from("suscripciones")
    .update({
      plan_id: planId,
      precio: monto,
      moneda,
      plan_pendiente_id: null,
      precio_pendiente: null,
      moneda_pendiente: null,
      plan_pendiente_vigente_desde: null,
    })
    .eq("id", suscripcionId)
    .eq("empresa_id", empresaId);
  if (uS) throw new Error(uS.message);
}
