import { NextResponse } from "next/server";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  countActiveProjectsForEstado,
  ensurePatchHasChanges,
  getProyectoEstadoConfigById,
  listProyectoEstadosConfig,
  parseProyectoEstadoConfigPatch,
  validateEstadoFunctionalRules,
} from "@/lib/proyectos/proyecto-estados-config";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    const auth = await requireProyectosApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    if (!esRolAdminEmpresaOGlobal(auth.rol)) {
      return NextResponse.json(errorResponse("Sin permiso para editar Configuración Proyectos"), { status: 403 });
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const patch = parseProyectoEstadoConfigPatch(body);
    ensurePatchHasChanges(patch);

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const current = await getProyectoEstadoConfigById(supabase, auth.empresaId, id);
    if (!current) {
      return NextResponse.json(errorResponse("Columna Kanban no encontrada"), { status: 404 });
    }

    const next = {
      ...current,
      ...patch,
    };

    if (current.activo && patch.activo === false) {
      const activeProjects = await countActiveProjectsForEstado(supabase, auth.empresaId, id);
      if (activeProjects > 0) {
        return NextResponse.json(
          errorResponse(
            "Este estado tiene proyectos activos. Mové esos proyectos a otra columna antes de desactivarlo."
          ),
          { status: 409 }
        );
      }
    }

    const estados = await listProyectoEstadosConfig(supabase, auth.empresaId);
    validateEstadoFunctionalRules(estados, id, {
      id,
      activo: next.activo,
      es_estado_inicial: next.es_estado_inicial,
    });

    const { data, error } = await supabase
      .from("proyecto_estados")
      .update(patch)
      .eq("empresa_id", auth.empresaId)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(errorResponse(error.message), { status: 400 });
    }

    return NextResponse.json(successResponse({ estado: data }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo actualizar la columna Kanban";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
