import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type { PlanMarketingPlantilla } from "@/lib/planes/types";
import type { MarketingTask } from "./types";
import type { TaskRow } from "./storage";
import { rowToTask } from "./storage";

function planMarketingOperativo(p: {
  es_plan_marketing?: boolean | null;
  plantilla_operativa?: unknown;
}): boolean {
  if (!p.es_plan_marketing) return false;
  const items = (p.plantilla_operativa as PlanMarketingPlantilla | undefined)?.items;
  return Array.isArray(items) && items.length > 0;
}

function esCumplidaTask(estado: string): boolean {
  return estado === "aprobado" || estado === "publicado";
}

export interface MarketingOpsClienteResumen {
  id: string;
  empresa: string | null;
  nombre_contacto: string | null;
  nombre: string | null;
  estado: string;
  tipo_servicio_cliente: string | null;
  plan_marketing_nombre: string | null;
  /** Tiene suscripción activa a plan con plantilla marketing */
  por_suscripcion_marketing: boolean;
  tareas_total: number;
  tareas_completadas: number;
  tareas_atrasadas: number;
  tareas_pendientes: number;
  proxima_entrega: string | null;
}

export interface MarketingOpsDashboard {
  mes: string;
  hoy: string;
  clientes: MarketingOpsClienteResumen[];
  tareas: MarketingTask[];
  metricas: { total: number; completadas: number; porcentaje: number };
}

/**
 * Carga Marketing Ops en un solo round-trip (mismo schema tenant que POST /api/marketing/sync).
 * Incluye clientes con suscripción a plan marketing activo aunque `tipo_servicio_cliente` aún no esté sincronizado.
 */
export async function loadMarketingOpsDashboard(opts: {
  empresa_id: string;
  mes: string;
  supabase: AppSupabaseClient;
}): Promise<MarketingOpsDashboard> {
  const { empresa_id, mes, supabase: sb } = opts;
  const hoy = new Date().toISOString().slice(0, 10);
  const [ano, mesNum] = mes.split("-").map(Number);
  const primerDia = `${mes}-01`;
  const ultimoDia = new Date(ano, mesNum, 0).getDate();
  const ultimoDiaStr = `${mes}-${String(ultimoDia).padStart(2, "0")}`;

  const { data: suscripciones, error: errSusc } = await sb
    .from("suscripciones")
    .select("id, cliente_id, plan_id")
    .eq("empresa_id", empresa_id)
    .eq("estado", "activa")
    .not("plan_id", "is", null);

  if (errSusc) {
    throw new Error(`[marketing ops] suscripciones: ${errSusc.message}`);
  }

  const planIds = [...new Set((suscripciones ?? []).map((s) => s.plan_id).filter(Boolean))] as string[];

  type PlanRow = {
    id: string;
    nombre: string | null;
    es_plan_marketing: boolean | null;
    plantilla_operativa: unknown;
  };

  let planes: PlanRow[] = [];
  if (planIds.length > 0) {
    const { data: planesData, error: errPlanes } = await sb
      .from("planes")
      .select("id, nombre, es_plan_marketing, plantilla_operativa")
      .in("id", planIds);
    if (errPlanes) {
      throw new Error(`[marketing ops] planes: ${errPlanes.message}`);
    }
    planes = (planesData ?? []) as PlanRow[];
  }

  const planMarketingPorId = new Map<string, { nombre: string | null }>();
  for (const p of planes) {
    if (planMarketingOperativo(p)) {
      planMarketingPorId.set(p.id, { nombre: p.nombre });
    }
  }

  const clienteIdsPorSuscripcion = new Set<string>();
  const planNombrePorCliente = new Map<string, string>();

  for (const s of suscripciones ?? []) {
    const pid = s.plan_id as string | null;
    if (!pid || !planMarketingPorId.has(pid)) continue;
    const cid = s.cliente_id as string;
    clienteIdsPorSuscripcion.add(cid);
    const nombrePlan = planMarketingPorId.get(pid)?.nombre?.trim();
    if (nombrePlan && !planNombrePorCliente.has(cid)) {
      planNombrePorCliente.set(cid, nombrePlan);
    }
  }

  const { data: idsTipoMkt, error: errTipo } = await sb
    .from("clientes")
    .select("id, empresa_id")
    .eq("empresa_id", empresa_id)
    .eq("tipo_servicio_cliente", "marketing")
    .eq("estado", "activo")
    .is("deleted_at", null);

  if (errTipo) {
    throw new Error(`[marketing ops] clientes tipo marketing: ${errTipo.message}`);
  }

  const clienteIdsTipoMarketing = new Set<string>();
  for (const r of idsTipoMkt ?? []) {
    clienteIdsTipoMarketing.add(r.id as string);
  }

  const todosIds = new Set<string>([...clienteIdsPorSuscripcion, ...clienteIdsTipoMarketing]);

  if (todosIds.size === 0) {
    return {
      mes,
      hoy,
      clientes: [],
      tareas: [],
      metricas: { total: 0, completadas: 0, porcentaje: 0 },
    };
  }

  const { data: clientesConEmpresa, error: errCli } = await sb
    .from("clientes")
    .select("id, empresa_id, empresa, nombre, nombre_contacto, estado, tipo_servicio_cliente")
    .in("id", [...todosIds])
    .eq("empresa_id", empresa_id)
    .eq("estado", "activo")
    .is("deleted_at", null);

  if (errCli) {
    throw new Error(`[marketing ops] clientes: ${errCli.message}`);
  }

  const conEmpresa = clientesConEmpresa ?? [];
  const idsResueltos = new Set(conEmpresa.map((c) => c.id as string));
  const idsPendientes = [...todosIds].filter((id) => !idsResueltos.has(id));

  let extra: typeof conEmpresa = [];
  if (idsPendientes.length > 0) {
    const { data: porId, error: errExtra } = await sb
      .from("clientes")
      .select("id, empresa_id, empresa, nombre, nombre_contacto, estado, tipo_servicio_cliente")
      .in("id", idsPendientes)
      .eq("estado", "activo")
      .is("deleted_at", null);
    if (errExtra) {
      throw new Error(`[marketing ops] clientes (por id): ${errExtra.message}`);
    }
    extra = (porId ?? []).filter((c) => {
      const eid = (c as { empresa_id?: string | null }).empresa_id;
      return !eid || eid === empresa_id;
    });
  }

  const clientesFiltrados = [...conEmpresa, ...extra];

  const { data: tasksRaw, error: errTasks } = await sb
    .from("marketing_tasks")
    .select("*")
    .eq("empresa_id", empresa_id)
    .gte("fecha_entrega", primerDia)
    .lte("fecha_entrega", ultimoDiaStr)
    .order("fecha_entrega", { ascending: true });

  if (errTasks) {
    throw new Error(`[marketing ops] marketing_tasks: ${errTasks.message}`);
  }

  const tareas = (tasksRaw as TaskRow[]).map(rowToTask);

  const tareasPorCliente = new Map<string, MarketingTask[]>();
  for (const t of tareas) {
    const arr = tareasPorCliente.get(t.cliente_id) ?? [];
    arr.push(t);
    tareasPorCliente.set(t.cliente_id, arr);
  }

  const total = tareas.length;
  const completadas = tareas.filter((t) => esCumplidaTask(t.estado)).length;
  const porcentaje = total > 0 ? Math.round((completadas / total) * 100) : 0;

  const clientes: MarketingOpsClienteResumen[] = clientesFiltrados.map((row) => {
    const id = row.id as string;
    const list = tareasPorCliente.get(id) ?? [];
    const pendNoCumplir = list.filter((t) => !esCumplidaTask(t.estado));
    const atrasadas = pendNoCumplir.filter((t) => t.fecha_entrega < hoy).length;
    const pendientes = pendNoCumplir.length;
    const completadasC = list.filter((t) => esCumplidaTask(t.estado)).length;

    const futuras = pendNoCumplir
      .filter((t) => t.fecha_entrega >= hoy)
      .map((t) => t.fecha_entrega)
      .sort();
    const proxima_entrega = futuras[0] ?? null;

    const porSuscripcion = clienteIdsPorSuscripcion.has(id);
    const planNombre = planNombrePorCliente.get(id) ?? null;

    return {
      id,
      empresa: (row.empresa as string | null) ?? null,
      nombre_contacto: (row.nombre_contacto as string | null) ?? null,
      nombre: (row.nombre as string | null) ?? null,
      estado: String(row.estado ?? "activo"),
      tipo_servicio_cliente: (row.tipo_servicio_cliente as string | null) ?? null,
      plan_marketing_nombre: planNombre,
      por_suscripcion_marketing: porSuscripcion,
      tareas_total: list.length,
      tareas_completadas: completadasC,
      tareas_atrasadas: atrasadas,
      tareas_pendientes: pendientes,
      proxima_entrega,
    };
  });

  clientes.sort((a, b) => {
    const na = (a.empresa ?? a.nombre_contacto ?? a.nombre ?? "").toLowerCase();
    const nb = (b.empresa ?? b.nombre_contacto ?? b.nombre ?? "").toLowerCase();
    return na.localeCompare(nb, "es");
  });

  return {
    mes,
    hoy,
    clientes,
    tareas,
    metricas: { total, completadas, porcentaje },
  };
}
