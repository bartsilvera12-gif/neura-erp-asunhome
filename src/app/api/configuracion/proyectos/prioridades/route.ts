import { NextResponse } from "next/server";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { errorResponse, successResponse } from "@/lib/api/response";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import { listProyectoPrioridadesConfig } from "@/lib/proyectos/proyecto-prioridades-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = await requireProyectosApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }

    const result = await listProyectoPrioridadesConfig(auth.empresaId, { ensureDefaults: true });
    const canEdit = esRolAdminEmpresaOGlobal(auth.rol);

    return NextResponse.json(
      successResponse({
        prioridades: result.prioridades,
        meta: {
          can_edit: canEdit,
          role: auth.rol,
          source_table: "proyecto_prioridades_config",
          schema: result.schema,
          source: result.source,
        },
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudieron cargar las prioridades de Proyectos";
    return NextResponse.json(errorResponse(message), { status: 500 });
  }
}
