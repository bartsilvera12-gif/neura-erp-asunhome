import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { getCurrentUser } from "@/lib/auth";
import type { PlanMarketingItem, PlanMarketingPlantilla } from "@/lib/planes/types";
import { TIPOS_CONTENIDO } from "./types";

const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function slotKey(clienteId: string, fecha: string, tipo: string): string {
  return `${clienteId}|${fecha}|${tipo}`;
}

/** Obtiene todas las fechas de un mes en formato YYYY-MM-DD */
function fechasDelMes(ano: number, mes: number): string[] {
  const fechas: string[] = [];
  const ultimoDia = new Date(ano, mes, 0).getDate();
  for (let d = 1; d <= ultimoDia; d++) {
    fechas.push(`${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return fechas;
}

/**
 * Obtiene el día de la semana (0=dom, 1=lun, ..., 6=sáb) para una fecha YYYY-MM-DD.
 * Usa T12:00:00Z + getUTCDay() para evitar bugs de timezone: la hora noon UTC asegura
 * que el día de la semana sea correcto para la fecha calendario, independiente de
 * la zona horaria del usuario (ej. America/Asuncion UTC-4).
 */
function diaSemana(fecha: string): number {
  const d = new Date(fecha + "T12:00:00Z");
  return d.getUTCDay();
}

/** Obtiene la semana del mes (1-4 o 5) para una fecha. Semana 1 = días 1-7, etc. */
function semanaDelMes(fecha: string): number {
  const [, , dd] = fecha.split("-").map(Number);
  return Math.ceil(dd / 7);
}

/**
 * Genera fechas para item semanal.
 * REGLA: dias_semana es la ÚNICA fuente de verdad. Se genera 1 tarea por cada día marcado.
 * cantidad NO se usa para semanal (solo informativa en la plantilla).
 */
export function fechasParaItemSemanal(
  ano: number,
  mes: number,
  item: PlanMarketingItem
): string[] {
  const dias = item.dias_semana ?? [];
  if (dias.length === 0) return [];

  const fechas: string[] = [];
  const diasUsar = [...dias].sort((a, b) => a - b);

  const todasLasFechas = fechasDelMes(ano, mes);
  for (const fecha of todasLasFechas) {
    const dia = diaSemana(fecha);
    if (diasUsar.includes(dia)) {
      fechas.push(fecha);
    }
  }
  return fechas;
}

/** Genera fechas para item mensual: semana_del_mes (1-4), cantidad tareas */
function fechasParaItemMensual(
  ano: number,
  mes: number,
  item: PlanMarketingItem
): string[] {
  const semana = item.semana_del_mes ?? 1;
  const cantidad = Math.max(1, item.cantidad ?? 1);

  const fechas: string[] = [];
  const todasLasFechas = fechasDelMes(ano, mes);

  // Días de la semana objetivo: días (inicio-1)*7+1 a inicio*7
  const inicio = (semana - 1) * 7 + 1;
  const fin = Math.min(semana * 7, todasLasFechas.length);

  for (let i = inicio; i <= fin && fechas.length < cantidad; i++) {
    if (i <= todasLasFechas.length) {
      fechas.push(todasLasFechas[i - 1]);
    }
  }

  return fechas;
}

export interface GenerarResultado {
  generadas: number;
  omitidas: number;
  errores: string[];
}

export interface PreviewSync {
  preview: true;
  mes: string;
  clientes_a_marcar: { id: string; nombre: string; razon: string }[];
  tareas_a_generar: { cliente_id: string; cliente_nombre: string; fecha_entrega: string; tipo_contenido: string; plan_nombre: string }[];
  resumen: { clientes_a_marcar_count: number; tareas_a_generar_count: number };
}

/** Preview de sincronización: qué clientes se marcarían y qué tareas se generarían (sin ejecutar). */
export async function previewSyncMarketing(opts: {
  empresa_id: string;
  mes: string;
  /** Cliente service role en el schema de datos de la empresa */
  supabaseClient: AppSupabaseClient;
}): Promise<PreviewSync> {
  const [anoStr, mesStr] = opts.mes.split("-").map(Number);
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  const primerDia = `${opts.mes}-01`;
  const ultimoDia = new Date(ano, mes, 0);
  const ultimoDiaStr = `${opts.mes}-${String(ultimoDia.getDate()).padStart(2, "0")}`;

  const { data: suscripciones } = await opts.supabaseClient
    .from("suscripciones")
    .select("id, cliente_id, plan_id")
    .eq("empresa_id", opts.empresa_id)
    .eq("estado", "activa")
    .not("plan_id", "is", null);

  if (!suscripciones?.length) {
    return { preview: true, mes: opts.mes, clientes_a_marcar: [], tareas_a_generar: [], resumen: { clientes_a_marcar_count: 0, tareas_a_generar_count: 0 } };
  }

  const planIds = [...new Set(suscripciones.map((s) => s.plan_id).filter(Boolean))] as string[];

  const { data: planes } = await opts.supabaseClient
    .from("planes")
    .select("id, nombre, es_plan_marketing, plantilla_operativa")
    .in("id", planIds);

  const planesMarketing = (planes ?? []).filter(
    (p) => p.es_plan_marketing && (p.plantilla_operativa as { items?: unknown[] })?.items?.length
  );
  const planMap = new Map(planesMarketing.map((p) => [p.id, p]));

  const clienteIds = [...new Set(suscripciones.map((s) => s.cliente_id))];

  const { data: clientes } = await opts.supabaseClient
    .from("clientes")
    .select("id, empresa, nombre_contacto, tipo_servicio_cliente")
    .in("id", clienteIds)
    .eq("estado", "activo")
    .is("deleted_at", null);

  const clienteMap = new Map((clientes ?? []).map((c) => [c.id, c]));
  const clienteNombre = (cid: string) =>
    clienteMap.get(cid)?.empresa ?? clienteMap.get(cid)?.nombre_contacto ?? "Cliente";

  const { data: existentes } = await opts.supabaseClient
    .from("marketing_tasks")
    .select("cliente_id, fecha_entrega, tipo_contenido")
    .in("cliente_id", clienteIds)
    .gte("fecha_entrega", primerDia)
    .lte("fecha_entrega", ultimoDiaStr);

  const ocupados = new Set(
    (existentes ?? []).map((r) => slotKey(r.cliente_id, r.fecha_entrega, r.tipo_contenido))
  );

  const clientesAMarcar: { id: string; nombre: string; razon: string }[] = [];
  const tareasAGenerar: { cliente_id: string; cliente_nombre: string; fecha_entrega: string; tipo_contenido: string; plan_nombre: string }[] = [];

  for (const c of clientes ?? []) {
    if (c.tipo_servicio_cliente !== "marketing") {
      const tieneSuscMarketing = suscripciones.some((s) => s.cliente_id === c.id && planMap.has(s.plan_id as string));
      if (tieneSuscMarketing) {
        clientesAMarcar.push({
          id: c.id,
          nombre: clienteNombre(c.id),
          razon: "Suscripción activa a plan de marketing",
        });
      }
    }
  }

  for (const susc of suscripciones) {
    const plan = planMap.get(susc.plan_id as string);
    if (!plan) continue;

    const plantilla = plan.plantilla_operativa as PlanMarketingPlantilla | undefined;
    if (!plantilla?.items?.length) continue;

    const clienteId = susc.cliente_id;
    if (!clienteMap.has(clienteId)) continue;

    const nombreCliente = clienteNombre(clienteId);

    for (const item of plantilla.items) {
      if (!TIPOS_CONTENIDO.includes(item.tipo_contenido as (typeof TIPOS_CONTENIDO)[number])) continue;

      let fechas: string[];
      if (item.periodicidad === "semanal") {
        fechas = fechasParaItemSemanal(ano, mes, item);
      } else {
        fechas = fechasParaItemMensual(ano, mes, item);
      }

      for (const fecha of fechas) {
        const key = slotKey(clienteId, fecha, item.tipo_contenido);
        if (ocupados.has(key)) continue;

        tareasAGenerar.push({
          cliente_id: clienteId,
          cliente_nombre: nombreCliente,
          fecha_entrega: fecha,
          tipo_contenido: item.tipo_contenido,
          plan_nombre: plan.nombre ?? "",
        });
      }
    }
  }

  return {
    preview: true,
    mes: opts.mes,
    clientes_a_marcar: clientesAMarcar,
    tareas_a_generar: tareasAGenerar,
    resumen: { clientes_a_marcar_count: clientesAMarcar.length, tareas_a_generar_count: tareasAGenerar.length },
  };
}

export interface SincronizarClientesMarketingResultado {
  /** Filas actualizadas correctamente */
  actualizados: number;
  /** Mensajes por cliente cuando el UPDATE falla o no afecta filas */
  errores: string[];
}

/**
 * Marca clientes con suscripción activa a plan marketing como tipo_servicio_cliente = marketing.
 * En schemas tenant, `clientes.empresa_id` puede ser NULL o desalineado con el JWT; el UPDATE solo filtra por `id`
 * y filas no eliminadas (el aislamiento real es el schema de datos de la empresa).
 */
export async function sincronizarClientesMarketing(
  empresa_id: string,
  supabaseClient: AppSupabaseClient
): Promise<SincronizarClientesMarketingResultado> {
  const client = supabaseClient;
  const errores: string[] = [];

  const { data: suscripciones } = await client
    .from("suscripciones")
    .select("cliente_id, plan_id")
    .eq("empresa_id", empresa_id)
    .eq("estado", "activa")
    .not("plan_id", "is", null);

  if (!suscripciones?.length) return { actualizados: 0, errores: [] };

  const planIds = [...new Set(suscripciones.map((s) => s.plan_id).filter(Boolean))] as string[];
  const { data: planes } = await client
    .from("planes")
    .select("id, es_plan_marketing")
    .in("id", planIds);

  const planMarketingIds = new Set((planes ?? []).filter((p) => p.es_plan_marketing).map((p) => p.id));

  const clienteIdsAMarcar = new Set<string>();
  for (const s of suscripciones) {
    if (planMarketingIds.has(s.plan_id as string)) {
      clienteIdsAMarcar.add(s.cliente_id);
    }
  }

  let actualizados = 0;
  for (const cid of clienteIdsAMarcar) {
    const { data: updated, error } = await client
      .from("clientes")
      .update({ tipo_servicio_cliente: "marketing" })
      .eq("id", cid)
      .is("deleted_at", null)
      .select("id");

    if (error) {
      errores.push(`${cid}: ${error.message}`);
      continue;
    }
    if (!updated?.length) {
      errores.push(
        `${cid}: no se actualizó ninguna fila (¿cliente inactivo, eliminado o ID inexistente en este schema?)`
      );
      continue;
    }
    actualizados++;
  }
  return { actualizados, errores };
}

/** Genera tareas de marketing para un mes calendario. Respeta slots ya ocupados (manual o auto). */
export async function generarTareasMarketing(opts: {
  empresa_id: string;
  mes: string; // YYYY-MM
  /** Si true, omite validación getCurrentUser (para llamadas desde API con auth ya verificado) */
  skipAuthCheck?: boolean;
  /** Cliente service role en el schema de datos de la empresa */
  supabaseClient: AppSupabaseClient;
}): Promise<GenerarResultado> {
  const client = opts.supabaseClient;

  if (!opts.skipAuthCheck) {
    const usuario = await getCurrentUser();
    if (!usuario?.empresa_id || usuario.empresa_id !== opts.empresa_id) {
      return { generadas: 0, omitidas: 0, errores: ["Usuario no autorizado"] };
    }
  }

  const [anoStr, mesStr] = opts.mes.split("-").map(Number);
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  const primerDia = `${opts.mes}-01`;
  const ultimoDia = new Date(ano, mes, 0);
  const ultimoDiaStr = `${opts.mes}-${String(ultimoDia.getDate()).padStart(2, "0")}`;

  // 1. Suscripciones activas con plan de marketing
  const { data: suscripciones } = await client
    .from("suscripciones")
    .select("id, cliente_id, plan_id")
    .eq("empresa_id", opts.empresa_id)
    .eq("estado", "activa")
    .not("plan_id", "is", null);

  if (!suscripciones?.length) {
    return { generadas: 0, omitidas: 0, errores: [] };
  }

  const planIds = [...new Set(suscripciones.map((s) => s.plan_id).filter(Boolean))] as string[];

  const { data: planes } = await client
    .from("planes")
    .select("id, nombre, es_plan_marketing, plantilla_operativa")
    .in("id", planIds);

  const planesMarketing = (planes ?? []).filter(
    (p) => p.es_plan_marketing && (p.plantilla_operativa as { items?: unknown[] })?.items?.length
  );

  if (planesMarketing.length === 0) {
    return { generadas: 0, omitidas: 0, errores: [] };
  }

  const planMap = new Map(planesMarketing.map((p) => [p.id, p]));

  // 2. Clientes activos (no eliminados)
  const clienteIds = [...new Set(suscripciones.map((s) => s.cliente_id))];

  const { data: clientes } = await client
    .from("clientes")
    .select("id, empresa, nombre_contacto")
    .in("id", clienteIds)
    .eq("estado", "activo")
    .is("deleted_at", null);

  const clienteMap = new Map((clientes ?? []).map((c) => [c.id, c]));
  const clienteNombre = (cid: string) =>
    clienteMap.get(cid)?.empresa ?? clienteMap.get(cid)?.nombre_contacto ?? "Cliente";

  // 3. Tareas existentes del mes (batch para ocupados)
  const { data: existentes } = await client
    .from("marketing_tasks")
    .select("cliente_id, fecha_entrega, tipo_contenido")
    .in("cliente_id", clienteIds)
    .gte("fecha_entrega", primerDia)
    .lte("fecha_entrega", ultimoDiaStr);

  const ocupados = new Set(
    (existentes ?? []).map((r) => slotKey(r.cliente_id, r.fecha_entrega, r.tipo_contenido))
  );

  const errores: string[] = [];
  let generadas = 0;
  let omitidas = 0;

  // 4. Generar tareas por suscripción
  for (const susc of suscripciones) {
    const plan = planMap.get(susc.plan_id as string);
    if (!plan) continue;

    const plantilla = plan.plantilla_operativa as PlanMarketingPlantilla | undefined;
    if (!plantilla?.items?.length) continue;

    const clienteId = susc.cliente_id;
    if (!clienteMap.has(clienteId)) continue;

    const nombreCliente = clienteNombre(clienteId);

    for (const item of plantilla.items) {
      if (!TIPOS_CONTENIDO.includes(item.tipo_contenido as (typeof TIPOS_CONTENIDO)[number])) continue;

      let fechas: string[];
      if (item.periodicidad === "semanal") {
        fechas = fechasParaItemSemanal(ano, mes, item);
      } else {
        fechas = fechasParaItemMensual(ano, mes, item);
      }

      const tipoLabel = item.tipo_contenido.charAt(0).toUpperCase() + item.tipo_contenido.slice(1);

      for (const fecha of fechas) {
        const key = slotKey(clienteId, fecha, item.tipo_contenido);
        if (ocupados.has(key)) {
          omitidas++;
          continue;
        }

        const [, , dd] = fecha.split("-");
        const titulo = `${tipoLabel} - ${nombreCliente} - ${dd}/${String(mes).padStart(2, "0")}`;

        const { error } = await client.from("marketing_tasks").insert({
          empresa_id: opts.empresa_id,
          cliente_id: clienteId,
          suscripcion_id: susc.id,
          plan_id: plan.id,
          generada_automaticamente: true,
          titulo,
          tipo_contenido: item.tipo_contenido,
          fecha_entrega: fecha,
          estado: "pendiente",
        });

        if (error) {
          errores.push(`${clienteId}-${fecha}-${item.tipo_contenido}: ${error.message}`);
        } else {
          ocupados.add(key);
          generadas++;
        }
      }
    }
  }

  return { generadas, omitidas, errores };
}

export interface RegenerarResultado {
  eliminadas: number;
  generadas: number;
  errores: string[];
}

/** Regenera tareas automáticas de un cliente en un mes: elimina las auto existentes y genera nuevas según plantilla actual. */
export async function regenerarTareasClienteMes(opts: {
  empresa_id: string;
  mes: string; // YYYY-MM
  cliente_id: string;
  /** Cliente service role en el schema de datos de la empresa */
  supabaseClient: AppSupabaseClient;
}): Promise<RegenerarResultado> {
  const client = opts.supabaseClient;

  const [anoStr, mesStr] = opts.mes.split("-").map(Number);
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  const primerDia = `${opts.mes}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const ultimoDiaStr = `${opts.mes}-${String(ultimoDia).padStart(2, "0")}`;

  // 1. Obtener suscripción activa del cliente
  const { data: suscripciones } = await client
    .from("suscripciones")
    .select("id, plan_id")
    .eq("empresa_id", opts.empresa_id)
    .eq("cliente_id", opts.cliente_id)
    .eq("estado", "activa")
    .not("plan_id", "is", null)
    .limit(1);

  const susc = suscripciones?.[0];
  if (!susc?.plan_id) {
    return { eliminadas: 0, generadas: 0, errores: ["Cliente sin suscripción activa a plan de marketing"] };
  }

  // 2. Obtener plan con plantilla
  const { data: plan } = await client
    .from("planes")
    .select("id, nombre, es_plan_marketing, plantilla_operativa")
    .eq("id", susc.plan_id)
    .single();

  if (!plan?.es_plan_marketing) {
    return { eliminadas: 0, generadas: 0, errores: ["Plan no es de marketing"] };
  }

  const plantilla = plan.plantilla_operativa as PlanMarketingPlantilla | undefined;
  if (!plantilla?.items?.length) {
    return { eliminadas: 0, generadas: 0, errores: ["Plan sin plantilla operativa"] };
  }

  // 3. Eliminar tareas automáticas del cliente en el mes
  const { data: deleted, error: errDelete } = await client
    .from("marketing_tasks")
    .delete()
    .eq("empresa_id", opts.empresa_id)
    .eq("cliente_id", opts.cliente_id)
    .eq("generada_automaticamente", true)
    .gte("fecha_entrega", primerDia)
    .lte("fecha_entrega", ultimoDiaStr)
    .select("id");

  if (errDelete) {
    return { eliminadas: 0, generadas: 0, errores: [`Error al eliminar: ${errDelete.message}`] };
  }

  const eliminadas = deleted?.length ?? 0;

  // 4. Nombre del cliente para títulos
  const { data: cliente } = await client
    .from("clientes")
    .select("empresa, nombre_contacto")
    .eq("id", opts.cliente_id)
    .single();

  const nombreCliente = (cliente?.empresa ?? cliente?.nombre_contacto ?? "Cliente").trim() || "Cliente";

  // 5. Generar nuevas tareas según plantilla
  const errores: string[] = [];
  let generadas = 0;

  for (const item of plantilla.items) {
    if (!TIPOS_CONTENIDO.includes(item.tipo_contenido as (typeof TIPOS_CONTENIDO)[number])) continue;

    let fechas: string[];
    if (item.periodicidad === "semanal") {
      fechas = fechasParaItemSemanal(ano, mes, item);
    } else {
      fechas = fechasParaItemMensual(ano, mes, item);
    }

    const tipoLabel = item.tipo_contenido.charAt(0).toUpperCase() + item.tipo_contenido.slice(1);

    for (const fecha of fechas) {
      const [, , dd] = fecha.split("-");
      const titulo = `${tipoLabel} - ${nombreCliente} - ${dd}/${String(mes).padStart(2, "0")}`;

      const { error } = await client.from("marketing_tasks").insert({
        empresa_id: opts.empresa_id,
        cliente_id: opts.cliente_id,
        suscripcion_id: susc.id,
        plan_id: plan.id,
        generada_automaticamente: true,
        titulo,
        tipo_contenido: item.tipo_contenido,
        fecha_entrega: fecha,
        estado: "pendiente",
      });

      if (error) {
        errores.push(`${fecha}-${item.tipo_contenido}: ${error.message}`);
      } else {
        generadas++;
      }
    }
  }

  return { eliminadas, generadas, errores };
}

export interface RegenerarMesCompletoResultado {
  eliminadas: number;
  generadas: number;
  omitidas: number;
  errores: string[];
}

/** Regenera TODAS las tareas automáticas del mes para TODOS los clientes marketing activos de la empresa. */
export async function regenerarMesCompleto(opts: {
  empresa_id: string;
  mes: string; // YYYY-MM
  /** Cliente service role en el schema de datos de la empresa */
  supabaseClient: AppSupabaseClient;
}): Promise<RegenerarMesCompletoResultado> {
  const client = opts.supabaseClient;

  const [anoStr, mesStr] = opts.mes.split("-").map(Number);
  const mes = Number(mesStr);
  const primerDia = `${opts.mes}-01`;
  const ultimoDia = new Date(anoStr, mes, 0).getDate();
  const ultimoDiaStr = `${opts.mes}-${String(ultimoDia).padStart(2, "0")}`;

  // 1. Eliminar TODAS las tareas automáticas del mes (empresa)
  const { data: deleted, error: errDelete } = await client
    .from("marketing_tasks")
    .delete()
    .eq("empresa_id", opts.empresa_id)
    .eq("generada_automaticamente", true)
    .gte("fecha_entrega", primerDia)
    .lte("fecha_entrega", ultimoDiaStr)
    .select("id");

  if (errDelete) {
    return { eliminadas: 0, generadas: 0, omitidas: 0, errores: [`Error al eliminar: ${errDelete.message}`] };
  }

  const eliminadas = deleted?.length ?? 0;

  // 2. Regenerar con la lógica normal (generarTareasMarketing)
  const resultado = await generarTareasMarketing({
    empresa_id: opts.empresa_id,
    mes: opts.mes,
    skipAuthCheck: true,
    supabaseClient: client,
  });

  return {
    eliminadas,
    generadas: resultado.generadas,
    omitidas: resultado.omitidas,
    errores: resultado.errores,
  };
}

export { DIAS_SEMANA };
