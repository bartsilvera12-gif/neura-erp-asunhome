import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";

const ESTADOS_TAREA = new Set(["pendiente", "en_proceso", "completada", "bloqueada"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; tareaId: string }> }
) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id: proyectoId, tareaId } = await params;
  const pid = proyectoId?.trim() ?? "";
  const tid = tareaId?.trim() ?? "";
  if (!pid || !tid) return NextResponse.json(errorResponse("ids obligatorios"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(errorResponse("Body inválido"), { status: 400 });
    }

    const patch: Record<string, unknown> = {};

    if (typeof body.titulo === "string") patch.titulo = body.titulo.trim();
    if (typeof body.descripcion === "string") patch.descripcion = body.descripcion;
    if (typeof body.estado === "string" && ESTADOS_TAREA.has(body.estado)) {
      patch.estado = body.estado;
      if (body.estado === "completada") {
        patch.completed_at = new Date().toISOString();
      } else if ("completed_at" in body && body.completed_at === null) {
        patch.completed_at = null;
      }
    }
    if ("responsable_id" in body) {
      patch.responsable_id =
        typeof body.responsable_id === "string" && body.responsable_id ? body.responsable_id : null;
    }
    if (typeof body.fecha_limite === "string" || body.fecha_limite === null) {
      patch.fecha_limite =
        typeof body.fecha_limite === "string" && body.fecha_limite.trim()
          ? body.fecha_limite
          : null;
    }
    if (typeof body.sort_order === "number") patch.sort_order = Math.floor(body.sort_order);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(errorResponse("Nada para actualizar"), { status: 400 });
    }

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("proyecto_tareas")
      .update(patch)
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .eq("id", tid)
      .select("*");

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return NextResponse.json(errorResponse("No encontrado"), { status: 404 });

    await sb
      .from("proyectos")
      .update({ last_activity_at: new Date().toISOString(), updated_by: auth.usuarioCatalogId })
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid);

    return NextResponse.json(successResponse(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
