import { NextResponse } from "next/server";
import { getChatServiceClientForEmpresa } from "@/app/api/chat/_chat-service-client";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";

const ESTADOS_TAREA = new Set(["pendiente", "en_proceso", "completada", "bloqueada"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const sb = await getChatServiceClientForEmpresa(auth.empresaId);
    const { data, error } = await sb
      .from("proyecto_tareas")
      .select("*")
      .eq("empresa_id", auth.empresaId)
      .eq("proyecto_id", pid)
      .order("sort_order", { ascending: true });

    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });
    return NextResponse.json(successResponse(data ?? []));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireProyectosApiAccess(request);
  if (!auth.ok) {
    return NextResponse.json(errorResponse(auth.message), { status: auth.status });
  }

  const { id } = await params;
  const pid = id?.trim() ?? "";
  if (!pid) return NextResponse.json(errorResponse("id obligatorio"), { status: 400 });

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const titulo = typeof body?.titulo === "string" ? body.titulo.trim() : "";
    if (!titulo) return NextResponse.json(errorResponse("titulo obligatorio"), { status: 400 });

    const estadoRaw = typeof body?.estado === "string" ? body.estado : "pendiente";
    const estado = ESTADOS_TAREA.has(estadoRaw) ? estadoRaw : "pendiente";

    const sb = await getChatServiceClientForEmpresa(auth.empresaId);

    const insert: Record<string, unknown> = {
      empresa_id: auth.empresaId,
      proyecto_id: pid,
      titulo,
      descripcion: typeof body?.descripcion === "string" ? body.descripcion : null,
      estado,
      responsable_id:
        typeof body?.responsable_id === "string" && body.responsable_id ? body.responsable_id : null,
      fecha_limite:
        typeof body?.fecha_limite === "string" && body.fecha_limite ? body.fecha_limite : null,
      sort_order: typeof body?.sort_order === "number" ? Math.floor(body.sort_order) : 0,
      created_by: auth.usuarioCatalogId,
    };

    const { data, error } = await sb.from("proyecto_tareas").insert(insert).select("*");
    if (error) return NextResponse.json(errorResponse(error.message), { status: 400 });

    await sb
      .from("proyectos")
      .update({ last_activity_at: new Date().toISOString(), updated_by: auth.usuarioCatalogId })
      .eq("empresa_id", auth.empresaId)
      .eq("id", pid);

    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json(successResponse(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
