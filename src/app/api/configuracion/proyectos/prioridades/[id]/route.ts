import { NextResponse } from "next/server";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  ensurePrioridadPatchHasChanges,
  parseProyectoPrioridadConfigPatch,
  updateProyectoPrioridadConfig,
} from "@/lib/proyectos/proyecto-prioridades-config";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireProyectosApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    if (!esRolAdminEmpresaOGlobal(auth.rol)) {
      return NextResponse.json(errorResponse("Sin permiso para editar Configuración Proyectos"), { status: 403 });
    }

    const { id } = await params;
    if (id.startsWith("fallback-")) {
      return NextResponse.json(errorResponse("La tabla de prioridades aún no está disponible para guardar"), {
        status: 409,
      });
    }

    const body = await request.json().catch(() => ({}));
    const patch = parseProyectoPrioridadConfigPatch(body);
    ensurePrioridadPatchHasChanges(patch);

    const updated = await updateProyectoPrioridadConfig(auth.empresaId, id, patch);
    if (!updated) {
      return NextResponse.json(errorResponse("Prioridad no encontrada"), { status: 404 });
    }

    return NextResponse.json(successResponse({ prioridad: updated }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo actualizar la prioridad";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
