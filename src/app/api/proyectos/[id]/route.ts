import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { mergeBriefDataPatch } from "@/lib/proyectos/brief-data";
import { enrichProyectosRows } from "@/lib/proyectos/enrich-proyectos";
import { enrichProyectoHistorialRows } from "@/lib/proyectos/historial-enrich";
import { computeSlaTotales, type HistorialRow } from "@/lib/proyectos/sla-from-historial";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

const PRIORIDADES = new Set(["baja", "normal", "alta", "urgente"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) {
    return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });
  }

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const empresaId = auth.empresaId;

    const { data: proyecto, error: e1 } = await sb
      .from("proyectos")
      .select("*")
      .eq("empresa_id", empresaId)
      .eq("id", pid)
      .maybeSingle();

    if (e1) return NextResponse.json(errorResponse(e1.message), { status: 400 });
    if (!proyecto) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    const [enrichedArr, hist, tareas, comentarios, archivos] = await Promise.all([
      enrichProyectosRows(sb, empresaId, [proyecto as Record<string, unknown>]),
      sb
        .from("proyecto_estado_historial")
        .select(
          "id, estado_anterior_id, estado_nuevo_id, changed_by, changed_at, entered_at, exited_at, duration_seconds, tipo_sla_snapshot"
        )
        .eq("empresa_id", empresaId)
        .eq("proyecto_id", pid)
        .order("entered_at", { ascending: true }),
      sb
        .from("proyecto_tareas")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("proyecto_id", pid)
        .order("sort_order", { ascending: true }),
      sb
        .from("proyecto_comentarios")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("proyecto_id", pid)
        .order("created_at", { ascending: false }),
      sb.from("proyecto_archivos").select("id, nombre, mime_type, size_bytes, created_at").eq("empresa_id", empresaId).eq("proyecto_id", pid),
    ]);

    const histRows = (hist.data ?? []) as HistorialRow[];
    const sla = computeSlaTotales(histRows);
    const historialEnriched = await enrichProyectoHistorialRows(sb, empresaId, hist.data ?? []);

    const comRows = (comentarios.data ?? []) as { usuario_id: string }[];
    const uids = [...new Set(comRows.map((c) => c.usuario_id))];
    const catalog = createServiceRoleClient();
    const { data: names } =
      uids.length > 0
        ? await catalog.from("usuarios").select("id, nombre").eq("empresa_id", empresaId).in("id", uids)
        : { data: [] as { id: string; nombre?: string }[] };
    const nameMap = new Map((names ?? []).map((u) => [u.id, u.nombre ?? ""]));

    const comentariosRich = comRows.map((c) => ({
      ...c,
      usuario_nombre: nameMap.get(c.usuario_id) ?? null,
    }));

    const base = enrichedArr[0] ?? (proyecto as Record<string, unknown>);
    const avance =
      (tareas.data ?? []).length === 0
        ? null
        : Math.round(
            ((tareas.data ?? []).filter((t: { estado?: string }) => t.estado === "completada").length /
              (tareas.data ?? []).length) *
              100
          );

    return NextResponse.json(
      successResponse({
        proyecto: base,
        historial: historialEnriched,
        sla,
        tareas: tareas.data ?? [],
        comentarios: comentariosRich,
        archivos: archivos.data ?? [],
        avance_pct: avance,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) {
    return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(errorResponse("Body inválido"), { status: 400 });
    }

    if ("estado_id" in body) {
      return NextResponse.json(errorResponse("Usá POST /api/proyectos/[id]/cambiar-estado para mover estado"), {
        status: 400,
      });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const patch: Record<string, unknown> = {
      updated_by: auth.usuarioCatalogId,
      last_activity_at: new Date().toISOString(),
    };

    if (typeof body.titulo === "string") patch.titulo = body.titulo.trim();
    if (typeof body.descripcion === "string") patch.descripcion = body.descripcion;
    if (typeof body.prioridad === "string" && PRIORIDADES.has(body.prioridad)) patch.prioridad = body.prioridad;
    if ("cliente_id" in body)
      patch.cliente_id =
        typeof body.cliente_id === "string" && body.cliente_id ? body.cliente_id : null;
    if ("tipo_id" in body && typeof body.tipo_id === "string") patch.tipo_id = body.tipo_id;
    if ("responsable_comercial_id" in body) {
      patch.responsable_comercial_id =
        typeof body.responsable_comercial_id === "string" && body.responsable_comercial_id
          ? body.responsable_comercial_id
          : null;
    }
    if ("responsable_tecnico_id" in body) {
      patch.responsable_tecnico_id =
        typeof body.responsable_tecnico_id === "string" && body.responsable_tecnico_id
          ? body.responsable_tecnico_id
          : null;
    }
    if (typeof body.fecha_prometida === "string" || body.fecha_prometida === null) {
      patch.fecha_prometida =
        typeof body.fecha_prometida === "string" && body.fecha_prometida.trim()
          ? body.fecha_prometida
          : null;
    }
    if (typeof body.fecha_entrega === "string" || body.fecha_entrega === null) {
      patch.fecha_entrega =
        typeof body.fecha_entrega === "string" && body.fecha_entrega.trim()
          ? body.fecha_entrega
          : null;
    }
    if ("monto_vendido" in body) {
      patch.monto_vendido =
        body.monto_vendido === null || body.monto_vendido === ""
          ? null
          : Number(body.monto_vendido);
    }
    if (typeof body.observaciones_comerciales === "string" || body.observaciones_comerciales === null) {
      patch.observaciones_comerciales =
        typeof body.observaciones_comerciales === "string" ? body.observaciones_comerciales : null;
    }
    if (body.brief_data && typeof body.brief_data === "object" && !Array.isArray(body.brief_data)) {
      const { data: curBrief, error: eBrief } = await sb
        .from("proyectos")
        .select("brief_data")
        .eq("empresa_id", auth.empresaId)
        .eq("id", pid)
        .maybeSingle();
      if (eBrief) return NextResponse.json(errorResponse(eBrief.message), { status: 400 });
      const existing = (curBrief as { brief_data?: unknown } | null)?.brief_data;
      patch.brief_data = mergeBriefDataPatch(
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {},
        body.brief_data as Record<string, unknown>
      );
    }
    if (body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) {
      patch.metadata = body.metadata;
    }
    if (typeof body.bloqueado === "boolean") patch.bloqueado = body.bloqueado;
    if (typeof body.bloqueo_motivo === "string" || body.bloqueo_motivo === null) {
      patch.bloqueo_motivo =
        typeof body.bloqueo_motivo === "string" && body.bloqueo_motivo.trim()
          ? body.bloqueo_motivo
          : null;
    }
    if (typeof body.archivado === "boolean") patch.archivado = body.archivado;

    const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
    if (keys.length <= 2) {
      return NextResponse.json(errorResponse("Nada para actualizar"), { status: 400 });
    }

    const { data: updated, error } = await sb
      .from("proyectos")
      .update(patch)
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid)
      .select("*");

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const row = Array.isArray(updated) ? updated[0] : updated;
    if (!row) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    const enriched = await enrichProyectosRows(sb, auth.empresaId, [row as Record<string, unknown>]);
    return NextResponse.json(successResponse(enriched[0] ?? row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
