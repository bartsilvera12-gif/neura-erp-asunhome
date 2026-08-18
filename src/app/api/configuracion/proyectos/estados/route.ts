import { NextResponse } from "next/server";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { errorResponse, successResponse } from "@/lib/api/response";
import { getChatServiceClientForEmpresa } from "@/lib/supabase/chat-service-role-empresa";
import { requireProyectosApiAccess } from "@/lib/proyectos/proyectos-auth";
import {
  listProyectoEstadosConfig,
  parseProyectoEstadoConfigCreate,
  validateEstadoFunctionalRules,
} from "@/lib/proyectos/proyecto-estados-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = await requireProyectosApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }

    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const estados = await listProyectoEstadosConfig(supabase, auth.empresaId);
    const canEdit = esRolAdminEmpresaOGlobal(auth.rol);

    return NextResponse.json(
      successResponse({
        estados,
        meta: {
          can_edit: canEdit,
          role: auth.rol,
          source_table: "proyecto_estados",
        },
      })
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudieron cargar los estados de Proyectos";
    return NextResponse.json(errorResponse(message), { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireProyectosApiAccess(request);
    if (!auth.ok) {
      return NextResponse.json(errorResponse(auth.message), { status: auth.status });
    }
    if (!esRolAdminEmpresaOGlobal(auth.rol)) {
      return NextResponse.json(errorResponse("Sin permiso para editar Configuración Proyectos"), { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const create = parseProyectoEstadoConfigCreate(body);
    const supabase = await getChatServiceClientForEmpresa(auth.empresaId);
    const before = await listProyectoEstadosConfig(supabase, auth.empresaId);

    validateEstadoFunctionalRules(before, null, {
      id: "__new__",
      activo: create.activo ?? true,
      es_estado_inicial: create.es_estado_inicial ?? false,
    });

    const { data, error } = await supabase
      .from("proyecto_estados")
      .insert({
        empresa_id: auth.empresaId,
        codigo: create.codigo,
        nombre: create.nombre,
        color: create.color,
        sort_order: create.sort_order,
        activo: create.activo,
        es_estado_inicial: create.es_estado_inicial,
        es_estado_final: create.es_estado_final,
        cuenta_sla: create.cuenta_sla,
        tipo_sla: create.tipo_sla,
        sla_horas_objetivo: create.sla_horas_objetivo,
      })
      .select("*")
      .single();

    if (error) {
      const status = error.code === "23505" ? 409 : 400;
      return NextResponse.json(errorResponse(error.message), { status });
    }

    return NextResponse.json(successResponse({ estado: data }), { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo crear la columna Kanban";
    return NextResponse.json(errorResponse(message), { status: 400 });
  }
}
