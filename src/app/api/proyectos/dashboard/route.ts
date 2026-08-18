import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";

export async function GET(request: Request) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const emp = auth.empresaId;
    const now = new Date();
    const nowIso = now.toISOString();
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const twoDays = new Date(now.getTime() + 2 * 86400000).toISOString();

    const { data: estCliente } = await sb
      .from("proyecto_estados")
      .select("id")
      .eq("empresa_id", emp)
      .eq("activo", true)
      .eq("tipo_sla", "cliente");

    const { data: estFinal } = await sb
      .from("proyecto_estados")
      .select("id")
      .eq("empresa_id", emp)
      .eq("activo", true)
      .eq("es_estado_final", true);

    const clienteEstadoIds = (estCliente ?? []).map((r: { id: string }) => r.id);
    const finalEstadoIds = (estFinal ?? []).map((r: { id: string }) => r.id);

    const activos = await sb
      .from("proyectos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", emp)
      .eq("archivado", false);

    const vencidos = await sb
      .from("proyectos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", emp)
      .eq("archivado", false)
      .not("fecha_prometida", "is", null)
      .lt("fecha_prometida", nowIso);

    const porVencer = await sb
      .from("proyectos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", emp)
      .eq("archivado", false)
      .not("fecha_prometida", "is", null)
      .gte("fecha_prometida", nowIso)
      .lte("fecha_prometida", twoDays);

    let esperandoCliente = { count: 0 as number | null };
    if (clienteEstadoIds.length > 0) {
      esperandoCliente = await sb
        .from("proyectos")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", emp)
        .eq("archivado", false)
        .in("estado_id", clienteEstadoIds);
    }

    let entregadosMes = { count: 0 as number | null };
    if (finalEstadoIds.length > 0) {
      entregadosMes = await sb
        .from("proyectos")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", emp)
        .eq("archivado", false)
        .in("estado_id", finalEstadoIds)
        .gte("updated_at", startMonth);
    }

    const { data: allEstados, error: eEst } = await sb
      .from("proyecto_estados")
      .select("id, nombre, codigo, color, sort_order")
      .eq("empresa_id", emp)
      .eq("activo", true)
      .order("sort_order", { ascending: true });

    if (eEst) return NextResponse.json(errorResponse(eEst.message), { status: 400 });

    const por_estado: { estado_id: string; nombre: string; codigo: string; color: string; cantidad: number }[] = [];
    for (const e of allEstados ?? []) {
      const row = e as { id: string; nombre: string; codigo: string; color: string };
      const c = await sb
        .from("proyectos")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", emp)
        .eq("archivado", false)
        .eq("estado_id", row.id);
      por_estado.push({
        estado_id: row.id,
        nombre: row.nombre,
        codigo: row.codigo,
        color: row.color,
        cantidad: c.count ?? 0,
      });
    }

    const { data: prSample } = await sb
      .from("proyectos")
      .select("responsable_comercial_id, responsable_tecnico_id")
      .eq("empresa_id", emp)
      .eq("archivado", false)
      .limit(5000);

    const por_responsable: { usuario_id: string; rol: "comercial" | "tecnico"; cantidad: number }[] = [];
    const mapCom = new Map<string, number>();
    const mapTec = new Map<string, number>();
    for (const p of prSample ?? []) {
      const r = p as { responsable_comercial_id?: string | null; responsable_tecnico_id?: string | null };
      if (r.responsable_comercial_id) {
        mapCom.set(r.responsable_comercial_id, (mapCom.get(r.responsable_comercial_id) ?? 0) + 1);
      }
      if (r.responsable_tecnico_id) {
        mapTec.set(r.responsable_tecnico_id, (mapTec.get(r.responsable_tecnico_id) ?? 0) + 1);
      }
    }
    for (const [uid, n] of mapCom) {
      por_responsable.push({ usuario_id: uid, rol: "comercial", cantidad: n });
    }
    for (const [uid, n] of mapTec) {
      por_responsable.push({ usuario_id: uid, rol: "tecnico", cantidad: n });
    }

    let tiempo_promedio_produccion_dias: number | null = null;
    if (finalEstadoIds.length > 0) {
      const { data: hechos } = await sb
        .from("proyectos")
        .select("fecha_ingreso, fecha_entrega, updated_at")
        .eq("empresa_id", emp)
        .in("estado_id", finalEstadoIds)
        .not("fecha_ingreso", "is", null)
        .limit(500);
      const dias: number[] = [];
      for (const h of hechos ?? []) {
        const r = h as { fecha_ingreso: string; fecha_entrega: string | null; updated_at: string | null };
        const fin = r.fecha_entrega ? Date.parse(r.fecha_entrega) : Date.parse(r.updated_at ?? "");
        const ini = Date.parse(r.fecha_ingreso);
        if (Number.isFinite(fin) && Number.isFinite(ini) && fin >= ini) {
          dias.push((fin - ini) / 86400000);
        }
      }
      if (dias.length > 0) {
        tiempo_promedio_produccion_dias =
          Math.round((dias.reduce((a, b) => a + b, 0) / dias.length) * 10) / 10;
      }
    }

    return NextResponse.json(
      successResponse({
        activos: activos.count ?? 0,
        vencidos: vencidos.count ?? 0,
        por_vencer: porVencer.count ?? 0,
        esperando_cliente: esperandoCliente.count ?? 0,
        entregados_este_mes: entregadosMes.count ?? 0,
        tiempo_promedio_produccion_dias,
        por_estado,
        por_responsable,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
